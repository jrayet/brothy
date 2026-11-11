// App: zen's columns flow: panes side by side, read left to right, and a page is the whole band of the document.
import { describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { columnPages, paneBounds } from "../../src/app/derive/steps"
import { solidPng } from "../helpers/png"
import { imagesOf, keys, kittyTerminal, setResolution, useAppHarness, waitFor, waitFrame } from "./helpers"

const { tmp, mount, zenConfig } = useAppHarness()

/** A tight list: one rendered line per item. */
const items = (n: number) => Array.from({ length: n }, (_, i) => `- item ${i}`).join("\n") + "\n"
const nums = (f: string) => [...f.matchAll(/\bitem (\d+)/g)].map((m) => Number(m[1]))

test("a columns page lays the whole band out at once, panes side by side", async () => {
  zenConfig({ flow: "columns", cols: 2, measure: 60, typewriter: false })
  const s = await mount(tmp({ "a.md": items(200) }), "a.md", { size: { width: 133, height: 30 } })
  const shown = nums(await keys(s, "z"))
  // 26 rows a pane at this size: the first page carries lines 0..51, both panes at once
  expect(Math.min(...shown)).toBe(0)
  expect(Math.max(...shown)).toBe(51)
})

test("space turns the page below the band, not to the next section", async () => {
  zenConfig({ flow: "columns", cols: 2, measure: 60, typewriter: false })
  const s = await mount(tmp({ "a.md": items(200) }), "a.md", { size: { width: 133, height: 30 } })
  await keys(s, "z")
  const second = nums(await keys(s, "space"))
  expect(Math.min(...second)).toBe(52)
  expect(Math.max(...second)).toBe(103)
})

test("`|` adds a pane and the page band grows with it", async () => {
  zenConfig({ flow: "scroll" })
  const s = await mount(tmp({ "a.md": items(200) }), "a.md", { size: { width: 234, height: 30 } })
  // two panes are the default, so one step asks for three: 78 lines a page at this size
  const shown = nums(await keys(s, "z", "|"))
  expect(Math.min(...shown)).toBe(0)
  expect(Math.max(...shown)).toBe(77)
})

describe("panes never cut a picture in half", () => {
  const view = (lines: number, pics: { line: number; rows: number }[]) =>
    ({
      lines: Array.from({ length: lines }, () => ({ spans: [], text: "" })),
      pics: pics.map((p, i) => ({
        id: i,
        line: p.line,
        rows: p.rows,
        cols: 20,
        left: 0,
        src: `math:${i}`,
        alt: "maths",
      })),
    }) as never

  test("a pane stops before a picture that its last row would cut", () => {
    // 26 rows a pane: a 10-row picture on line 20 would spill three rows into the next pane
    expect(paneBounds(view(100, [{ line: 20, rows: 10 }]), 0, 26, 2)).toEqual([0, 20, 46])
    // a picture that fits is left where it is
    expect(paneBounds(view(100, [{ line: 10, rows: 10 }]), 0, 26, 2)).toEqual([0, 26, 52])
  })

  test("a page starts where the last pane stopped, so the picture opens the next one", () => {
    expect(columnPages(view(100, [{ line: 20, rows: 10 }]), 26, 2)).toEqual([0, 46, 98])
  })

  test("a picture taller than a pane is let through rather than stalling the pages", () => {
    expect(columnPages(view(100, [{ line: 5, rows: 40 }]), 26, 2)).toEqual([0, 52])
  })
})

test("a picture that would cross the pane's last row opens the next pane whole", async () => {
  zenConfig({ flow: "columns", cols: 2, measure: 60, typewriter: false })
  // 24 one-line items put the picture's first row on line 25, five rows that would run past row 26 of the pane
  const note = `${Array.from({ length: 24 }, (_, i) => `- item ${i}`).join("\n")}\n\n![Plan](plan.png)\n`
  const root = tmp({ "a.md": note })
  writeFileSync(join(root, "plan.png"), solidPng(200, 100, [200, 100, 50, 255]))
  const s = await mount(root, "a.md", { size: { width: 133, height: 30 }, fetch: undefined })
  kittyTerminal(s)
  setResolution(s, { width: 1330, height: 600 })
  await keys(s, "z")
  await waitFor(s, () => imagesOf(s).length === 1)
  // five rows of ten by twenty pixels: whole in the second pane, not cut to the one row that was left
  expect([imagesOf(s)[0]!.width, imagesOf(s)[0]!.height]).toEqual([20, 5])
})

describe("a column is as tall as the body, and h / l walk the columns", () => {
  test("`l` turns to the next column, `h` comes back to it", async () => {
    zenConfig({ flow: "columns", cols: 2, measure: 60, typewriter: false })
    const s = await mount(tmp({ "a.md": items(200) }), "a.md", { size: { width: 133, height: 30 } })
    // 26 rows a pane: the first two columns hold 0..51, so the next column starts at item 26
    const at = nums(await keys(s, "z"))
    expect(Math.min(...at)).toBe(0)
    const right = nums(await keys(s, "l"))
    expect(Math.min(...right)).toBe(26)
    expect(Math.max(...right)).toBe(77)
    const back = nums(await keys(s, "h"))
    expect(Math.min(...back)).toBe(0)
    expect(Math.max(...back)).toBe(51)
  })

  test("scrolling moves a whole column, never half of one", async () => {
    zenConfig({ flow: "columns", cols: 2, measure: 60, typewriter: false })
    const s = await mount(tmp({ "a.md": items(200) }), "a.md", { size: { width: 133, height: 30 } })
    await keys(s, "z")
    const down = nums(await keys(s, "j"))
    expect(Math.min(...down)).toBe(26)
  })

  test("`G` lands on the last column, which the note ends in", async () => {
    zenConfig({ flow: "columns", cols: 2, measure: 60, typewriter: false })
    const s = await mount(tmp({ "a.md": items(200) }), "a.md", { size: { width: 133, height: 30 } })
    const last = nums(await keys(s, "z", "G"))
    // 200 items over 26-row columns: the last column starts at 182 and holds the rest
    expect(Math.max(...last)).toBe(199)
    expect(Math.min(...last)).toBe(182)
    // and `l` there has nowhere to go
    const again = nums(await keys(s, "l"))
    expect(Math.min(...again)).toBe(182)
  })
})

test("a window too narrow for one pane at the measure asks for the width it needs", async () => {
  zenConfig({ flow: "columns", cols: 2, typewriter: false })
  const s = await mount(tmp({ "a.md": items(200) }), "a.md", { size: { width: 60, height: 30 } })
  await keys(s, "z")
  // measure 72 + a 2-column margin each side: 78 columns is the narrowest this flow can draw
  const frame = await waitFrame(s, (f) => f.includes("need 78×14"))
  expect(frame).toContain("terminal too small (60×30)")
  expect(nums(frame)).toEqual([])
})

test("one column at the measure appears as soon as the window can hold it", async () => {
  zenConfig({ flow: "columns", cols: 2, typewriter: false })
  const s = await mount(tmp({ "a.md": items(200) }), "a.md", { size: { width: 78, height: 30 } })
  const shown = nums(await keys(s, "z"))
  expect(Math.min(...shown)).toBe(0)
  expect(Math.max(...shown)).toBe(25)
})
