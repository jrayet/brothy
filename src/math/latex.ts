// LaTeX fences: typeset once with MathJax (through opentui-math), kept as an SVG in the cache, then read like any other
// picture. The typeset itself is async, so the first render reserves the rows and asks via `rendered.math`; the effect in
// app/effects.ts typesets, writes the file and re-renders, and from then on `mathInfo` answers synchronously.

import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/** Fence languages that mean LaTeX. */
const MATH_LANGS = new Set(["latex", "tex", "math", "katex"])

export const isMathLang = (lang: string) => MATH_LANGS.has(lang.trim().toLowerCase())

/** One em of the reference raster: the SVG is written at this size, and layout scales it to the measure. */
export const MATH_REF_EM = 40
/** MathJax's viewBox is in 1/1000 em, whatever the ex-based width/height attributes say. */
const UNITS_PER_EM = 1000

/** A maths block the renderer is still waiting on. */
export interface MathRequest {
  key: string
  source: string
  color: string
}

/** What the note says about one maths block: its key plus what typesetting needs. */
export const mathRequest = (source: string, color: string): MathRequest => ({
  key: mathKey(source, color),
  source,
  color,
})

/** The cache key: the colour is part of the drawing (`currentColor`), the source is the rest. */
function mathKey(source: string, color: string): string {
  const digest = createHash("sha1").update(`${color}\n${source}`).digest("hex")
  return `math:${digest.slice(0, 16)}`
}

/** Intrinsic size in pixels of what a key rendered to; undefined until it has been typeset. */
const sizes = new Map<string, { w: number; h: number }>()
/** Where a key's SVG lives on disk, so pictures.ts can read and decode it like a file in the note's folder. */
const files = new Map<string, string>()

export const mathInfo = (key: string) => sizes.get(key) ?? null
export const mathFile = (key: string) => files.get(key) ?? null

const cacheDir = () => join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "brothy", "math")

/**
 * Typeset every request that is not cached yet and write it to the cache folder. Returns whether anything new landed,
 * which is the effect's cue to re-render: the blocks that were placeholders now have an image.
 */
export async function ensureMath(requests: MathRequest[]): Promise<boolean> {
  // a block typeset by an earlier run counts as landed: the caller re-renders and draws it
  let gained = false
  const todo: MathRequest[] = []
  for (const req of requests) {
    if (sizes.has(req.key)) continue
    if (hydrate(req.key)) gained = true
    else todo.push(req)
  }
  if (!todo.length) return gained
  const { renderLatexToSvg } = await import("opentui-math/graphics")
  for (const req of todo) {
    try {
      const svg = await renderLatexToSvg(req.source, {
        displayMode: true,
        foregroundColor: req.color,
      })
      const sized = withPixels(svg, req.color)
      if (!sized) continue
      const dir = cacheDir()
      mkdirSync(dir, { recursive: true })
      const path = join(dir, `${req.key.slice("math:".length)}.svg`)
      writeFileSync(path, sized.svg)
      sizes.set(req.key, { w: sized.w, h: sized.h })
      files.set(req.key, path)
      gained = true
    } catch {
      // a formula MathJax refuses keeps its placeholder row; the source is still readable in Source mode
    }
  }
  return gained
}

/** Picks up a block typeset by an earlier run: the cache folder outlives the process, the maps do not. */
function hydrate(key: string): boolean {
  const path = join(cacheDir(), `${key.slice("math:".length)}.svg`)
  try {
    const svg = readFileSync(path, "utf8")
    const open = /<svg\b[^>]*>/i.exec(svg)?.[0]
    const w = open ? Number(/\bwidth="(\d+)"/i.exec(open)?.[1]) : Number.NaN
    const h = open ? Number(/\bheight="(\d+)"/i.exec(open)?.[1]) : Number.NaN
    if (!(w > 0) || !(h > 0)) return false
    sizes.set(key, { w, h })
    files.set(key, path)
    return true
  } catch {
    return false
  }
}

/** The MathJax document with pixel width/height (the ex-based ones are unreadable to the sizer) and the theme colour. */
function withPixels(svg: string, color: string): { svg: string; w: number; h: number } | null {
  const open = /<svg\b[^>]*>/i.exec(svg)?.[0]
  const viewBox = open ? /\bviewBox="([^"]+)"/i.exec(open)?.[1] : undefined
  const box = viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (box?.length !== 4 || box.some((n) => !Number.isFinite(n))) return null
  const w = Math.max(1, Math.round(((box[2] ?? 0) / UNITS_PER_EM) * MATH_REF_EM))
  const h = Math.max(1, Math.round(((box[3] ?? 0) / UNITS_PER_EM) * MATH_REF_EM))
  const stamped = open
    ? svg
        .replace(open, (tag) => tag.replace(/\swidth="[^"]*"/i, "").replace(/\sheight="[^"]*"/i, ""))
        .replace(/<svg\b/i, `<svg width="${w}" height="${h}"`)
        .replace(/<svg\b([^>]*)>/i, (tag, attrs: string) =>
          /\bcolor="/i.test(attrs)
            ? tag.replace(/\bcolor="[^"]*"/i, `color="${color}"`)
            : `<svg${attrs} color="${color}">`,
        )
    : undefined
  return stamped ? { svg: stamped, w, h } : null
}
