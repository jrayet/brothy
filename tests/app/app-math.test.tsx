// App: inline maths in Preview: the typeset drawing over the cells its placeholder holds, one row tall.
import { afterAll, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { NativeImage } from "@opentui/core"
import { mathRequest } from "../../src/math/latex"
import { solidPng } from "../helpers/png"
import { brothy as t } from "../helpers/theme"
import { imagesOf, keys, kittyTerminal, type Setup, setResolution, useAppHarness, waitFor, waitFrame } from "./helpers"

const { tmp, cacheDir, mount } = useAppHarness()

/** A cell of the 100 × 30 terminal this file mounts, in pixels: 10 × 20. */
const RES = { width: 1000, height: 600 }

/**
 * The formula typeset the way `ensureMath` would, in the cache folder it reads: a `body × 1000` em box at
 * `MATH_REF_EM` 40 comes out `Math.max(1, round(body · 1000 / 1000 · 40))` pixels each way.
 */
async function typeset(source: string, body: number) {
  const key = mathRequest(source, t.text).key
  const dir = join(cacheDir, "brothy", "math")
  mkdirSync(dir, { recursive: true })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${body}" height="${body}" viewBox="0 0 ${body * 1000} ${body * 1000}" color="${t.text}"><rect width="100%" height="100%" fill="currentColor"/></svg>`
  writeFileSync(join(dir, `${key.slice("math:".length)}.svg`), svg)
  return { key, file: join(dir, `${key.slice("math:".length)}.svg`) }
}

/** A vault holding `note`, a `plan.png` of 20 columns by 5 rows and the formulas it typesets (`source` → body ems). */
async function vault(note: string, formulas: [source: string, body: number][] = [["x^2", 40]]) {
  const d = tmp({ "n.md": note })
  writeFileSync(join(d, "plan.png"), solidPng(200, 100, [200, 100, 50, 255]))
  for (const [source, body] of formulas) await typeset(source, body)
  return d
}

/** The note mounted on a kitty terminal that has said its pixel size. */
async function pictured(root: string) {
  const s = await mount(root, "n.md")
  kittyTerminal(s)
  setResolution(s, RES)
  return s
}

/** Render until the note has `n` images on screen. */
const shown = (s: Setup, n = 1) => waitFor(s, () => imagesOf(s).length === n)

/** The body's text column on the 100-column terminal: inside the panel's 28 and edge, past a 1-column pad and margin. */
const PAD_L = 31
/**
 * The most a formula's image may be wider than its placeholder. The renderer counts a placed image's columns off its
 * pixel box at its own 8 × 16 cell and rounds down, while the preview crops the source to that many cells: a pixel box
 * of `cols · cell.w / 8` columns therefore shows `cols` of them (10 × 20 a cell: 2 cells of a 2-cell formula).
 */
const ROUND_UP_CELLS = 1

afterAll(() => rmSync(join(cacheDir, "brothy", "math"), { recursive: true, force: true }))

test("a formula draws one row tall, its columns wide, at the placeholder's column", async () => {
  const s = await pictured(await vault("This is $x^2$ inline.\n"))
  await shown(s)
  const [img] = imagesOf(s)
  // the placeholder's two cells, within the cell a pixel box of whole cells may add
  expect(img!.height).toBe(1)
  expect(img!.width - 2).toBeLessThanOrEqual(ROUND_UP_CELLS)
  // "This is " is 8 columns of the body's text column, on its first row
  expect([img!.x, img!.y]).toEqual([PAD_L + 8, 2])
  // the decoded drawing is that box in pixels: two cells by one of 10 × 20
  const source = img!.source as NativeImage
  expect([source.width, source.height]).toEqual([20, 20])
  expect(source.raw().data.some((b, i) => i % 4 === 3 && b > 8)).toBe(true)
})

test("two formulas on one line draw side by side, each in its own columns", async () => {
  // x^2 is 2 cells, a cube (its box three times as wide) 6: "a " + 2 + " b " + 6
  const s = await pictured(
    await vault("a $x^2$ b $z$ c\n", [
      ["x^2", 40],
      ["z", 120],
    ]),
  )
  await shown(s, 2)
  const [first, second] = imagesOf(s).sort((a, b) => a.x - b.x)
  expect([first!.x - PAD_L, first!.height]).toEqual([2, 1])
  expect([second!.x - PAD_L, second!.height]).toEqual([7, 1])
  expect(first!.width - 2).toBeLessThanOrEqual(ROUND_UP_CELLS)
  expect(second!.width - 6).toBeLessThanOrEqual(ROUND_UP_CELLS)
  // no overlap: the first ends before the second begins
  expect(first!.x + first!.width).toBeLessThanOrEqual(second!.x)
  expect([first!.y, second!.y]).toEqual([2, 2])
})

test("text mode draws no formula, and the note reads as before", async () => {
  const s = await mount(await vault("This is $x^2$ inline.\n"), "n.md")
  await waitFrame(s, (f) => f.includes("This is $x^2$ inline."))
  expect(imagesOf(s)).toHaveLength(0)
})

test("a picture in the same note is unaffected", async () => {
  const s = await pictured(await vault("Before $x^2$ here.\n\n![Plan](plan.png)\n\nAfter $x^2$ here.\n"))
  const pictures = () => imagesOf(s).filter((r) => r.height > 1)
  await waitFor(s, () => pictures().length === 1 && imagesOf(s).length === 3)
  const plan = pictures()[0]!
  expect([plan.width, plan.height]).toEqual([20, 5])
  // the block sits under the heading-less paragraph, its blank row and the caption's row
  expect(imagesOf(s).filter((r) => r.height === 1)).toHaveLength(2)
  const f = s.captureCharFrame()
  expect(f).toContain("Plan")
})

test("in zen's columns the formula draws once, in the pane its row is in, and no more with more panes", async () => {
  const rest = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n\n")
  const s = await pictured(await vault(`This is $x^2$ inline.\n\n${rest}\n`))
  await shown(s)
  await keys(s, "z", "|")
  // two panes read the whole band at once, so the first pane has the row: still one drawing of it
  await waitFor(s, () => imagesOf(s).length === 1)
  const [img] = imagesOf(s)
  expect([img!.x, img!.y, img!.height]).toEqual([11, 2, 1])
  expect(img!.width - 2).toBeLessThanOrEqual(ROUND_UP_CELLS)
})

test("the same formula twice on a line is one image placed twice", async () => {
  const s = await pictured(await vault("a $x^2$ b $x^2$ c\n"))
  await shown(s, 2)
  const [first, second] = imagesOf(s).sort((a, b) => a.x - b.x)
  // one cache entry, drawn at both columns: "a " then " b " between them
  expect(first!.source).toBe(second!.source)
  expect([first!.x - PAD_L, second!.x - PAD_L]).toEqual([2, 7])
})
