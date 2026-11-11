// A display formula too wide to be drawn legibly is cut at its top-level breaks and laid out as a stack of pieces, one
// picture each, drawn at no less than the floor (MATHS_EM_CELLS of an em to the text row). One with no break point at
// all has nothing to cut and is still drawn smaller than the floor.
import { describe, expect, test } from "bun:test"
import { MATHS_EM_CELLS, render } from "../../src/markdown/render"
import { ensureMath, MATH_REF_EM, mathInfo, mathRequest } from "../../src/math/latex"
import { brothy as t } from "../helpers/theme"

const cell = { w: 19, h: 42 }
/** What pictures.ts answers for a typeset block: the size once the SVG exists, null before. */
const info = (s: string) => (s.startsWith("math:") ? mathInfo(s) : null)
const pix = { picture: { mode: "pixels" as const, cell, info } }
const fence = (code: string) => `latex fence\n\n\`\`\`latex\n${code}\n\`\`\`\n`

/** The formula the stack is read on: two top-level commas, a `\qquad` between them, no break inside a group. */
const WIDE = "v_s' = \\left(\\operatorname{grad} v_s\\right) v_s, \\qquad P = f^{-1}, \\qquad X = F^{T}F"
/** Wide under any narrow measure, and with no top-level break to cut at: nothing to stack. */
const UNBREAKABLE = "\\frac{a}{b}\\frac{a}{b}\\frac{a}{b}\\frac{a}{b}\\frac{a}{b}\\frac{a}{b}"

/** The drawn width of a piece in pixels, at the floor the block refuses to go under. */
const floorPx = (w: number) => (w * MATHS_EM_CELLS * cell.h) / MATH_REF_EM

/**
 * Render, typeset whatever was asked for, render again, until nothing is left to ask (a cut is discovered one pass at a
 * time: the pieces are only known once the whole formula has a width). Bounded, and every block ends up a picture.
 */
const drawn = async (source: string, measure: number) => {
  const src = fence(source)
  const asked = new Set<string>()
  let r = render(src, measure, t, pix)
  for (let i = 0; i < 6; i++) {
    const todo = (r.math ?? []).filter((req) => !asked.has(req.key))
    if (!todo.length) break
    for (const req of todo) asked.add(req.key)
    await ensureMath(todo)
    r = render(src, measure, t, pix)
  }
  expect(r.math ?? []).toEqual([])
  return r
}

describe("a display formula cut at its top-level breaks", () => {
  test("a wide formula is stacked, every piece inside the measure and drawn at the floor", async () => {
    const r = await drawn(WIDE, 30)
    expect(r.pics!.length).toBeGreaterThanOrEqual(2)
    for (const pic of r.pics!) {
      // never wider than the measure it sits in
      expect(pic.cols).toBeLessThanOrEqual(30)
      // drawn at 0.85 em or more: no smaller than the floor the whole formula could not hold
      expect(floorPx(pic.size!.w)).toBeLessThanOrEqual(pic.cols * cell.w + 1)
      // the rows reserved for it are its own height
      expect(r.lines.filter((line) => line.pic === pic.id).length).toBe(pic.rows)
    }
  })

  test("a measure wide enough for the whole formula draws it as one picture", async () => {
    const r = await drawn(WIDE, 120)
    expect(r.pics?.length).toBe(1)
    expect(r.pics![0]!.src).toBe(mathRequest(WIDE, t.text).key)
  })

  test("a formula with no break point at all is still shrunk, not stacked", async () => {
    const r = await drawn(UNBREAKABLE, 8)
    expect(r.pics?.length).toBe(1)
    const pic = r.pics![0]!
    expect(pic.src).toBe(mathRequest(UNBREAKABLE, t.text).key)
    // it could not be cut, so it is drawn under the floor instead: what 0.85 em would give it is wider than the
    // picture, and no row of it is more than the measure wide
    expect(floorPx(pic.size!.w)).toBeGreaterThan(pic.cols * cell.w)
    expect(pic.cols).toBeLessThanOrEqual(10)
  })

  test("each piece is its own picture, so the sheet opens the piece that was clicked on", async () => {
    const r = await drawn(WIDE, 30)
    expect(new Set(r.pics!.map((pic) => pic.src)).size).toBe(r.pics!.length)
    for (const pic of r.pics!) {
      // the piece's own drawing, not the whole formula's
      expect(pic.size).toEqual(mathInfo(pic.src)!)
      expect(pic.src).not.toBe(mathRequest(WIDE, t.text).key)
    }
  })

  test("pieces are left-aligned under the first, not centred in the measure", async () => {
    const r = await drawn(WIDE, 30)
    // the frame's own indent: a stack at the left of the text, so a continuation line lies under the first
    expect(r.pics![0]!.left).toBe(0)
    for (const pic of r.pics!) expect(pic.left).toBe(0)
  })
})
