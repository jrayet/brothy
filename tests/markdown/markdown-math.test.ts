import { describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import type { NativeImage } from "@opentui/core"
import { PictureCache, picKey, pictureFiles } from "../../src/app/pictures"
import { render } from "../../src/markdown/render"
import { ensureMath, mathInfo } from "../../src/math/latex"
import { scanTree } from "../../src/notes/files"
import { brothy as t } from "../helpers/theme"
import { makeTmp } from "../helpers/tmp"

const cell = { w: 10, h: 20 }
/** What pictures.ts answers for a typeset block: the size once the SVG exists, null before. */
const info = (s: string) => (s.startsWith("math:") ? mathInfo(s) : null)
const pix = { picture: { mode: "pixels" as const, cell, info } }
const txt = { picture: { mode: "text" as const, cell, info } }
const fence = (lang: string, code: string) => `${lang} fence\n\n\`\`\`${lang}\n${code}\n\`\`\`\n`

/** Poll for a condition (a decode lands a macrotask or more later), bounded. */
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 400 && !cond(); i++) await Bun.sleep(5)
  expect(cond()).toBe(true)
}

describe("latex fences", () => {
  test("without picture layout the source stays a code fence", () => {
    const r = render(fence("latex", "a^2 + b^2"), 80, t)
    expect(r.math ?? []).toEqual([])
    expect(r.pics ?? []).toEqual([])
    expect(r.lines.some((l) => l.spans.some((s) => s.text.includes("a^2 + b^2")))).toBe(true)
  })

  test("a first render reserves a placeholder row and asks for the typeset", () => {
    const src = fence("latex", "\\frac{1}{n}")
    const r = render(src, 80, t, pix)
    expect(r.math?.length).toBe(1)
    expect(r.pics?.length).toBe(1)
    const line = r.lines.find((l) => l.pic !== undefined)
    expect(line?.spans.map((s) => s.text).join("")).toContain("typesetting")
  })

  test("typeset once, the block is a picture with reserved rows at its own aspect", async () => {
    const source = "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}"
    const src = fence("latex", source)
    const first = render(src, 80, t, pix)
    const req = first.math![0]!
    expect(await ensureMath([req])).toBe(true)
    expect(mathInfo(req.key)).not.toBeNull()

    const second = render(src, 80, t, pix)
    expect(second.math ?? []).toEqual([])
    const pic = second.pics![0]!
    expect(pic.src).toBe(req.key)
    expect(pic.cols * cell.w).toBeLessThanOrEqual(80 * cell.w)
    // rows follow the aspect of what was typeset, so the image is never squashed
    const size = mathInfo(req.key)!
    expect(Math.abs(pic.rows * cell.h - (pic.cols * cell.w * size.h) / size.w)).toBeLessThanOrEqual(cell.h)
    const reserved = second.lines.filter((l) => l.pic === pic.id)
    expect(reserved.length).toBe(pic.rows)
  })

  test("a second pass over the same source asks for nothing", async () => {
    const source = "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}"
    const first = render(fence("tex", source), 80, t, pix)
    const req = first.math![0]!
    await ensureMath([req])
    const fresh = render(fence("tex", source), 80, t, pix)
    expect(fresh.math ?? []).toEqual([])
  })

  test("text mode names the size and points at the viewer", async () => {
    const source = "\\int_0^1 x^2\\,dx"
    const first = render(fence("math", source), 80, t, txt)
    await ensureMath(first.math ?? [])
    const second = render(fence("math", source), 80, t, txt)
    const text = second.lines.flatMap((l) => l.spans.map((s) => s.text)).join(" ")
    expect(text).toContain("maths ·")
    expect(text).toContain("⏎ view")
  })

  test("a typeset block decodes: the picture pipeline finds its file and makes a real image", async () => {
    // the app wires render to pictureFiles.info, whose file lookup is what PictureLayer and the sheet decode from:
    // reading mathInfo in its place left that lookup empty, so a real terminal drew the "unreadable" row
    const d = makeTmp("brothy-math-")
    const files = pictureFiles(null, d, scanTree(d))
    const opts = { picture: { mode: "pixels" as const, cell, info: files.info } }
    const source = "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}"
    const src = fence("latex", source)

    const first = render(src, 80, t, opts)
    // a formula an earlier run left on disk is already typeset; either way it ends up a picture
    await ensureMath(first.math ?? [])
    const second = render(src, 80, t, opts)
    const pic = second.pics![0]!
    expect(second.math ?? []).toEqual([])

    const file = files.file(pic.src)
    expect(file).not.toBeNull()
    expect(file!).toEndWith(".svg")

    const cache = new PictureCache()
    const key = picKey(file!, pic, cell, t.name, false)
    cache.frame()
    cache.want(key, file!, pic.cols * cell.w, pic.rows * cell.h, null, () => {})
    await until(() => cache.get(key) !== undefined)

    const img = cache.get(key) as NativeImage | null
    expect(img).not.toBeNull()
    expect([img!.width, img!.height]).toEqual([pic.cols * cell.w, pic.rows * cell.h])
    // typeset ink landed, not just the right size of empty bitmap
    expect(img!.raw().data.some((b, i) => i % 4 === 3 && b > 8)).toBe(true)
    img!.dispose()
    rmSync(d, { recursive: true })
  })

  test("the colour is part of the key, so a theme change typesets again", async () => {
    const source = "\\alpha + \\beta"
    const dark = render(fence("latex", source), 80, t, pix).math![0]!
    await ensureMath([dark])
    const tinted = { ...t, text: "#123456" }
    const other = render(fence("latex", source), 80, tinted, pix)
    expect(other.math?.[0]?.key).not.toBe(dark.key)
  })
})
