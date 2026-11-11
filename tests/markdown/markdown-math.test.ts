import { describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import type { NativeImage } from "@opentui/core"
import { PictureCache, picKey, pictureFiles } from "../../src/app/pictures"
import { spanWidth } from "../../src/lib/text"
import { mathBox, render } from "../../src/markdown/render"
import { ensureMath, mathInfo, mathRequest } from "../../src/math/latex"
import { scanTree } from "../../src/notes/files"
import { brothy as t } from "../helpers/theme"
import { makeTmp } from "../helpers/tmp"

const cell = { w: 10, h: 20 }
/** What pictures.ts answers for a typeset block: the size once the SVG exists, null before. */
const info = (s: string) => (s.startsWith("math:") ? mathInfo(s) : null)
const pix = { picture: { mode: "pixels" as const, cell, info } }
const txt = { picture: { mode: "text" as const, cell, info } }
/** No size known yet: the picture layout answers null, so every formula is still a request. */
const unsized = { picture: { mode: "pixels" as const, cell, info: (_src: string) => null } }
/** The same sizes as `pix`, for a formula `ensureMath` has not typeset: the stub answers without touching the cache. */
const stub = {
  picture: { mode: "pixels" as const, cell, info: (s: string) => (s.startsWith("math:") ? { w: 40, h: 40 } : null) },
}
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
    const src = fence("latex", "\\frac{1}{n+7}")
    const r = render(src, 80, t, pix)
    expect(r.math?.length).toBe(1)
    expect(r.pics?.length).toBe(1)
    const line = r.lines.find((l) => l.pic !== undefined)
    expect(line?.spans.map((s) => s.text).join("")).toContain("typesetting")
  })

  test("typeset once, the block is a picture with reserved rows at its own aspect", async () => {
    const source = "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}"
    const src = fence("latex", source)
    const req = mathRequest(source, t.text)
    await ensureMath([req])
    expect(mathInfo(req.key)).not.toBeNull()

    const second = render(src, 80, t, pix)
    expect(second.math ?? []).toEqual([])
    const pic = second.pics![0]!
    expect(pic.src).toBe(req.key)
    expect(pic.cols * cell.w).toBeLessThanOrEqual(80 * cell.w)
    // the viewer fits pic.size into its body, so the block must carry the typeset size or it draws nothing
    expect(pic.size).toEqual(mathInfo(req.key)!)
    // the box is maths-specific (its own em, zoomed to the measure), not the picture one: 291×94 at measure 80
    expect([pic.cols, pic.rows]).toEqual([28, 5])
    const reserved = second.lines.filter((l) => l.pic === pic.id)
    expect(reserved.length).toBe(pic.rows)
  })

  test("mathBox: the reference em at a cell's height, zoomed to the measure, capped", () => {
    // 291×94: 291 · 1.2 · 20/40 = 174 px = 18 columns of base box, zoomed by the measure but capped at 1.6
    expect(mathBox({ w: 291, h: 94 }, 80, cell)).toEqual({ cols: 28, rows: 5 })
    // the taller derivation: 429×226
    expect(mathBox({ w: 429, h: 226 }, 80, cell)).toEqual({ cols: 42, rows: 11 })
    // a small formula stays small: its base box is already 2 columns, capped zoom has nothing to add
    expect(mathBox({ w: 40, h: 40 }, 80, cell)).toEqual({ cols: 4, rows: 2 })
    // a long thin one zooms to the cap: 600×10 → 36 columns of base box, 1.6 · 36 = 58
    expect(mathBox({ w: 600, h: 10 }, 80, cell)).toEqual({ cols: 58, rows: 1 })
    // a narrow measure leaves no zoom at all: the base box is already wider than it
    expect(mathBox({ w: 40, h: 40 }, 5, cell)).toEqual({ cols: 4, rows: 2 })
    // a pane of a columns page passes zoomMax 1: the formula keeps its em instead of growing into the pane
    expect(mathBox({ w: 291, h: 94 }, 80, cell, 1)).toEqual({ cols: 18, rows: 3 })
    expect(mathBox({ w: 429, h: 226 }, 80, cell, 1)).toEqual({ cols: 26, rows: 7 })
  })

  test("a second pass over the same source asks for nothing", async () => {
    const source = "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}"
    const req = mathRequest(source, t.text)
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
    const dark = mathRequest(source, t.text)
    await ensureMath([dark])
    const tinted = { ...t, text: "#123456" }
    const other = render(fence("latex", source), 80, tinted, pix)
    expect(other.math?.[0]?.key).toBe(mathRequest(source, "#123456").key)
    expect(mathRequest(source, "#123456").key).not.toBe(dark.key)
  })
})

describe("inline maths", () => {
  test("a known size makes the formula a placeholder as wide as its drawing", () => {
    // 40×40 is one cell row tall at 40·20/40 = 20 px = 2 columns
    const r = render("a $x^2$ b\n", 80, t, stub)
    const spans = r.lines[0]!.spans
    expect(spans.map((s) => s.text)).toEqual(["a ", "  ", " b"])
    expect(spans[1]!.math).toEqual({ src: mathRequest("x^2", t.text).key, cols: 2 })
    expect(spans[0]!.math).toBeUndefined()
    expect(spanWidth(spans)).toBe(6)
    expect(r.math ?? []).toEqual([])
  })

  test("no size yet leaves the text as written and asks once per distinct formula", () => {
    const r = render("a $x^2$ b, $x^2$ again, $y$\n", 80, t, unsized)
    expect(r.lines[0]!.spans.map((s) => s.text)).toEqual(["a $x^2$ b, $x^2$ again, $y$"])
    expect(r.lines[0]!.spans[0]!.math).toBeUndefined()
    expect((r.math ?? []).map((q) => q.key)).toEqual([mathRequest("x^2", t.text).key, mathRequest("y", t.text).key])
    expect(r.math?.[0]?.source).toBe("x^2")
  })

  test("text mode has no place to draw a formula, so it is not one", () => {
    const r = render("a $x^2$ b\n", 80, t, txt)
    expect(r.lines[0]!.spans.map((s) => s.text)).toEqual(["a $x^2$ b"])
    expect(r.math ?? []).toEqual([])
  })

  test("currency, escaped dollars, display pairs and spaced dollars stay plain text", () => {
    const src = "$5 and $10, \\$y\\$, $$z$$, $ w $\n"
    const r = render(src, 80, t, unsized)
    expect(r.lines[0]!.spans.map((s) => s.text)).toEqual(["$5 and $10, $y$, $$z$$, $ w $"])
    expect(r.lines[0]!.spans.every((s) => s.math === undefined)).toBe(true)
    expect(r.math ?? []).toEqual([])
  })

  test("code spans are untouched, and a formula in a link is the link's text", () => {
    const r = render("a `$x$` and [b $y$](http://example.com) c\n", 80, t, unsized)
    expect(r.lines[0]!.spans.map((s) => s.text)).toEqual(["a ", "$x$", " and ", "b $y$", " c"])
    expect(r.lines[0]!.spans.every((s) => s.math === undefined)).toBe(true)
    expect(r.lines[0]!.spans[3]!.link).toBe(0)
    expect(r.links).toEqual([{ kind: "url", href: "http://example.com" }])
    expect((r.math ?? []).map((q) => q.source)).toEqual(["y"])
  })

  test("a placeholder wraps as one block and never splits its columns", () => {
    const r = render(`${"word ".repeat(20)}$x^2$ tail\n`, 40, t, stub)
    for (const l of r.lines) expect(spanWidth(l.spans)).toBeLessThanOrEqual(40)
    const marked = r.lines.flatMap((l) => l.spans.filter((s) => s.math))
    expect(marked.length).toBe(1)
    expect(marked[0]!.text).toBe(" ".repeat(marked[0]!.math!.cols))
  })
})
