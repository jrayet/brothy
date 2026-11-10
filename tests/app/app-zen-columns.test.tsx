// App: zen's columns flow: panes side by side, read left to right, and a page is the whole band of the document.
import { expect, test } from "bun:test"
import { keys, useAppHarness } from "./helpers"

const { tmp, mount, zenConfig } = useAppHarness()

/** A tight list: one rendered line per item. */
const items = (n: number) => Array.from({ length: n }, (_, i) => `- item ${i}`).join("\n") + "\n"
const nums = (f: string) => [...f.matchAll(/\bitem (\d+)/g)].map((m) => Number(m[1]))

test("a columns page lays the whole band out at once, panes side by side", async () => {
  zenConfig({ flow: "columns", cols: 2, measure: 60, typewriter: false })
  const s = await mount(tmp({ "a.md": items(200) }), "a.md")
  const shown = nums(await keys(s, "z"))
  // 26 rows a pane at this size: the first page carries lines 0..51, both panes at once
  expect(Math.min(...shown)).toBe(0)
  expect(Math.max(...shown)).toBe(51)
})

test("space turns the page below the band, not to the next section", async () => {
  zenConfig({ flow: "columns", cols: 2, measure: 60, typewriter: false })
  const s = await mount(tmp({ "a.md": items(200) }), "a.md")
  await keys(s, "z")
  const second = nums(await keys(s, "space"))
  expect(Math.min(...second)).toBe(52)
  expect(Math.max(...second)).toBe(103)
})

test("`|` adds a pane and the page band grows with it", async () => {
  zenConfig({ flow: "scroll" })
  const s = await mount(tmp({ "a.md": items(200) }), "a.md")
  // two panes are the default, so one step asks for three: 78 lines a page at this size
  const shown = nums(await keys(s, "z", "|"))
  expect(Math.min(...shown)).toBe(0)
  expect(Math.max(...shown)).toBe(77)
})
