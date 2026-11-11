// Math split: where a wide formula is cut, and how wide pieces are merged back while they still fit.
import { describe, expect, test } from "bun:test"
import { breakPoints, segment } from "../../src/math/split"

/** A width in reference-raster pixels: ten per character, as if it were typeset at the floor. */
const ten = (s: string) => s.length * 10

describe("breakPoints", () => {
  test("top-level commas are cut points, just after the comma", () => {
    expect(breakPoints("a, b, c")).toEqual([
      { at: 2, kind: "," },
      { at: 5, kind: "," },
    ])
  })

  test("spacing commands are cut points, never their backslash alone", () => {
    // `\,` and `\;` are one command each: a break after them is a break after the whole thing
    expect(breakPoints("a \\, b")).toEqual([{ at: 2, kind: "qquad" }])
    expect(breakPoints("a \\; b")).toEqual([{ at: 2, kind: "qquad" }])
    expect(breakPoints("a \\qquad b \\quad c")).toEqual([
      { at: 2, kind: "qquad" },
      { at: 11, kind: "qquad" },
    ])
  })

  test("an equality is cut after it, and only a real one", () => {
    expect(breakPoints("x = y")).toEqual([{ at: 3, kind: "=" }])
    expect(breakPoints("a == b")).toEqual([])
    expect(breakPoints("a \\= b")).toEqual([])
  })

  test("relations are cut points, read as whole commands", () => {
    expect(breakPoints("a \\iff b \\to c")).toEqual([
      { at: 2, kind: "rel" },
      { at: 9, kind: "rel" },
    ])
    // `\leftarrow` is a relation; it must not read as `\left`
    expect(breakPoints("a \\leftarrow b")).toEqual([{ at: 2, kind: "rel" }])
    expect(breakPoints("x \\pm 1 = y")).toEqual([{ at: 9, kind: "=" }])
  })

  test("a comma inside text, a command's arguments or a matrix is not a break", () => {
    expect(breakPoints("\\text{a, b}")).toEqual([])
    expect(breakPoints("\\text{slow, then fast}, x")).toEqual([{ at: 23, kind: "," }])
    expect(breakPoints("\\mathrm{d}x, y")).toEqual([{ at: 12, kind: "," }])
    expect(breakPoints("\\operatorname{arg,max}(x), y")).toEqual([{ at: 26, kind: "," }])
    expect(breakPoints("\\frac{a,b}{c}")).toEqual([])
    expect(breakPoints("\\boxed{a, b}")).toEqual([])
    expect(breakPoints("\\begin{cases}1, & a\\\\ 2, & b\\end{cases}, c")).toEqual([{ at: 40, kind: "," }])
  })

  test("brackets pair, including f(x,y) and \\left…\\right", () => {
    expect(breakPoints("f(x,y)")).toEqual([])
    expect(breakPoints("f(x, y) + g, h")).toEqual([{ at: 12, kind: "," }])
    expect(breakPoints("(a, b), c")).toEqual([{ at: 7, kind: "," }])
    // \left( and \right) are one bracket each, so the depth comes back to 0 and the comma after is a break
    expect(breakPoints("\\left( a, b \\right)")).toEqual([])
    expect(breakPoints("\\left( a, b \\right), c")).toEqual([{ at: 20, kind: "," }])
  })

  test("a split environment is read like the formula around it", () => {
    expect(breakPoints("\\begin{split} a, b \\end{split} c, d")).toEqual([
      { at: 16, kind: "," },
      { at: 33, kind: "," },
    ])
  })
})

describe("segment", () => {
  test("a formula that fits is never split", () => {
    const s = segment("f(x) + g(y)", 1000, ten)
    // there is a break in it (`+` is not one), so it is breakable even though it was not cut
    expect(s).toEqual({ pieces: ["f(x) + g(y)"], missing: [], breakable: false })
  })

  test("neighbours are merged while they still fit", () => {
    // "a, b," is 50 wide: the first piece takes both chunks, the second the rest
    expect(segment("a, b, c", 50, ten).pieces).toEqual(["a, b,", " c"])
  })

  test("a break keeps its delimiter on the left piece", () => {
    expect(segment("x = y = z", 60, ten).pieces).toEqual(["x =", " y =", " z"])
  })

  test("commas are preferred to an equality when either could cut", () => {
    // "aaaa, bbbb" (100) does not fit: the comma comes first, so `aaaa,` is the piece rather than `aaaa =`
    expect(segment("aaaa, bbbb = c", 60, ten).pieces).toEqual(["aaaa,", " bbbb =", " c"])
    expect(segment("aaaa = bbbb, c", 60, ten).pieces).toEqual(["aaaa =", " bbbb,", " c"])
  })

  test("a chunk too wide on its own is cut finer, not left whole", () => {
    // "a &= b + c, d &= e": the comma piece does not fit, so the chunk is cut at its `=`
    expect(segment("a &= b + c, d &= e", 70, ten).pieces).toEqual(["a &=", " b + c,", " d &=", " e"])
  })

  test("an atomic group is one chunk, cut only at the break after it", () => {
    expect(segment("\\begin{bmatrix}a & b \\\\ c & d\\end{bmatrix}, e", 60, ten).pieces).toEqual([
      "\\begin{bmatrix}a & b \\\\ c & d\\end{bmatrix},",
      " e",
    ])
    expect(segment("\\text{slow, then fast}, x", 60, ten).pieces).toEqual(["\\text{slow, then fast},", " x"])
  })

  test("pieces put the source back together", () => {
    for (const source of ["a, b, c, d", "x = y = z", "a &= b + c, d &= e", "alpha, beta, gamma"]) {
      expect(segment(source, 30, ten).pieces.join("")).toBe(source)
    }
  })

  test("a width that is not known yet stops the call with the pieces to typeset", () => {
    // " c," has not been typeset yet: the call says so instead of guessing where " c," would end
    const unknown = new Set([" c,"])
    const ask = (s: string) => (unknown.has(s) ? null : s.length * 10)
    expect(segment("a, b, c, d", 60, ask)).toEqual({ pieces: [], missing: [" c,"], breakable: true })

    // once that width is known the same call gives the final pieces, and it asked for nothing else
    unknown.clear()
    const asked: string[] = []
    const width = (s: string) => {
      asked.push(s)
      return s.length * 10
    }
    expect(segment("a, b, c, d", 60, width)).toEqual({
      pieces: ["a, b,", " c,", " d"],
      missing: [],
      breakable: true,
    })
    // the same inputs ask the same questions, in the same order: the callback is never asked twice for one piece
    expect(asked).toEqual([...new Set(asked)])
  })

  test("a formula with no break point is drawn whole and reported unbreakable", () => {
    expect(segment("f(x,y)", 10, ten)).toEqual({ pieces: ["f(x,y)"], missing: [], breakable: false })
    expect(segment("\\text{a, b}", 10, ten)).toEqual({ pieces: ["\\text{a, b}"], missing: [], breakable: false })
  })

  test("a chunk too wide even with no break inside it is one piece, smaller than the floor", () => {
    const s = segment("a, bbbbbbbbbbbbbbbbbbbbbbbbbbbb", 50, ten)
    expect(s.pieces).toEqual(["a,", " bbbbbbbbbbbbbbbbbbbbbbbbbbbb"])
    expect(s.breakable).toBe(true)
  })

  test("a source past 20 000 characters is left whole", () => {
    const long = Array.from({ length: 12_000 }, () => "x").join(",")
    expect(long.length).toBeGreaterThan(20_000)
    expect(segment(long, 10, ten).pieces).toEqual([long])
  })

  test("more than 64 pieces is left whole", () => {
    const many = Array.from({ length: 100 }, () => "ab").join(",")
    expect(segment(many, 1, ten).pieces).toEqual([many])
  })
})
