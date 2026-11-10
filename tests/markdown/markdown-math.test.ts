import { describe, expect, test } from "bun:test"
import { render } from "../../src/markdown/render"
import { ensureMath, mathInfo } from "../../src/math/latex"
import { brothy as t } from "../helpers/theme"

const cell = { w: 10, h: 20 }
/** What pictures.ts answers for a typeset block: the size once the SVG exists, null before. */
const info = (s: string) => (s.startsWith("math:") ? mathInfo(s) : null)
const pix = { picture: { mode: "pixels" as const, cell, info } }
const txt = { picture: { mode: "text" as const, cell, info } }
const fence = (lang: string, code: string) => `${lang} fence\n\n\`\`\`${lang}\n${code}\n\`\`\`\n`

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

  test("the colour is part of the key, so a theme change typesets again", async () => {
    const source = "\\alpha + \\beta"
    const dark = render(fence("latex", source), 80, t, pix).math![0]!
    await ensureMath([dark])
    const tinted = { ...t, text: "#123456" }
    const other = render(fence("latex", source), 80, tinted, pix)
    expect(other.math?.[0]?.key).not.toBe(dark.key)
  })
})
