import { expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { join } from "node:path"
import { pictureSheet } from "../../src/app/derive/steps"
import { firstPicIn, picAt } from "../../src/app/picture-sheet"
import { pictureFiles } from "../../src/app/pictures"
import type { UI } from "../../src/app/store"
import { type Rendered, render } from "../../src/markdown/render"
import { ensureMath, mathInfo } from "../../src/math/latex"
import { scanTree } from "../../src/notes/files"
import { brothy as t } from "../helpers/theme"
import { makeTmp } from "../helpers/tmp"

const cell = { w: 10, h: 20 }

/** 20 lines; picture 0 on lines 3-5 (two rows and its caption), picture 1 on line 12 (a placeholder). */
const picOf = (n: number) => {
  if (n >= 3 && n <= 5) return 0
  return n === 12 ? 1 : undefined
}
const view = {
  lines: Array.from({ length: 20 }, (_, n) => ({ spans: [], pic: picOf(n) })),
  pics: [
    { id: 0, line: 3, rows: 2 },
    { id: 1, line: 12, rows: 0 },
  ],
} as unknown as Rendered

test("picAt: any line of a picture (rows, caption, placeholder) gives it; others none", () => {
  expect(picAt(view, 4)?.id).toBe(0)
  expect(picAt(view, 5)?.id).toBe(0)
  expect(picAt(view, 12)?.id).toBe(1)
  expect(picAt(view, 6)).toBeUndefined()
  expect(picAt(view, 99)).toBeUndefined()
})

test("firstPicIn, Preview: the first picture whose lines meet the window", () => {
  const all = { lo: 0, hi: 20 }
  expect(firstPicIn(view, { first: 0, ...all }, 10)?.id).toBe(0)
  expect(firstPicIn(view, { first: 5, ...all }, 10)?.id).toBe(0) // only its caption row is in view
  expect(firstPicIn(view, { first: 6, ...all }, 10)?.id).toBe(1)
  expect(firstPicIn(view, { first: 6, ...all }, 6)).toBeUndefined()
  expect(firstPicIn(view, { first: 13, ...all }, 7)).toBeUndefined()
})

test("firstPicIn, zen: the window is the page or the reading line's rows, not `top`", () => {
  // Typewriter: the first row shown may be above the note (negative), rows before `lo` are blank
  expect(firstPicIn(view, { first: -4, lo: 0, hi: 20 }, 10)?.id).toBe(0)
  expect(firstPicIn(view, { first: -4, lo: 0, hi: 20 }, 6)).toBeUndefined()
  // Pages: the page holds lines 6-19 (padded above): picture 0 is on another page, picture 1 is on this one
  expect(firstPicIn(view, { first: 0, lo: 6, hi: 20 }, 20)?.id).toBe(1)
  // the page ends before picture 1
  expect(firstPicIn(view, { first: 6, lo: 6, hi: 12 }, 20)).toBeUndefined()
})

// The B1 regression: a typeset block reached the sheet without `pic.size`, the sheet bailed on it and the viewer read
// "unreadable" for a formula that had drawn fine in the note.
test("pictureSheet: a typeset maths picture draws, and its title names the size, not the cache path", async () => {
  const d = makeTmp("brothy-sheet-")
  const files = pictureFiles(null, d, scanTree(d))
  const opts = { picture: { mode: "pixels" as const, cell, info: files.info } }
  const src = "latex fence\n\n```latex\n\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n```\n"
  const first = render(src, 80, t, opts)
  await ensureMath(first.math ?? [])
  const doc = render(src, 80, t, opts)
  const pic = doc.pics![0]!
  expect(pic.size).toEqual(mathInfo(pic.src)!)

  const ui = { picture: { id: pic.id }, openPath: join(d, "n.md"), root: d, cell } as unknown as UI
  const sheet = pictureSheet(ui, 120, 40, doc, files, "pixels", cell, t.name)
  expect(sheet).not.toBeNull()
  expect(sheet!.draw).not.toBeNull()
  expect(sheet!.title).toStartWith("maths · ")
  expect(sheet!.title).not.toContain(d) // the cache folder says nothing to the reader
  rmSync(d, { recursive: true })
})
