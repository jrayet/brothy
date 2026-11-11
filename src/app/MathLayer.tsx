// Inline formulas over the cells their placeholders hold: one <image> per `Span.math` on screen, one row tall and as many
// columns wide as the placeholder. Not pure: asks the cache for what isn't decoded yet. Inside a picture's reserved rows,
// where the note draws an empty box and the picture's own image covers them, it draws nothing.
import type { Span } from "../lib/spans"
import { width } from "../lib/text"
import type { Rendered } from "../markdown/render"
import type { AppCtx } from "./ctx"
import type { Derived } from "./derive"
import { askPicture, pixelsFailed, type Window } from "./PictureLayer"
import { type Cell, picKey } from "./pictures"

/** The cell the renderer counts a placed image's rows and columns off, in pixels (`DEFAULT_CELL`): 8 × 16. */
const PX: Cell = { w: 8, h: 16 }

/** A formula on screen: the row from `first`, the columns from the row's left edge, its width in cells and what to draw. */
interface MathSpot {
  row: number
  col: number
  cols: number
  src: string
  /** the box in pixels OpenTUI lays the image out by: `cols` of this terminal's cells by one row of them */
  px: { w: number; h: number }
}

/**
 * The formulas in the `rows` rows from `first`, in reading order: each at the columns the spans before it fill (its
 * placeholder, `cols` of them), one row tall. Rows `lo`..`hi` are zen's; a row a picture reserves is the picture's (an
 * opaque image under a transparent one leaves no room to draw it), so the formula on it is left out.
 */
function mathSpots(view: Rendered, first: number, rows: number, cell: Cell, lo = 0, hi = Number.POSITIVE_INFINITY) {
  const out: MathSpot[] = []
  const pics = view.pics ?? []
  for (let row = Math.max(first, lo); row < Math.min(first + rows, hi, view.lines.length); row++) {
    if (pics.some((p) => row >= p.line && row < p.line + p.rows)) continue
    const spans: Span[] = view.lines[row]!.spans
    let col = 0
    for (const s of spans) {
      if (s.math) out.push({ row, col, cols: s.math.cols, src: s.math.src, px: pixelBox(s.math.cols, cell) })
      col += width(s.text)
    }
  }
  return out
}

/**
 * The pixel box OpenTUI lays a formula's image out by: it counts a placed image's columns and rows off the box at its
 * own cell size (8 × 16), and works in whole columns, so the box is that many default cells, a touch or so over.
 */
const pixelBox = (cols: number, cell: Cell) => ({ w: (cols * cell.w) / PX.w, h: cell.h / PX.h })

/**
 * The images of the formulas in `rows` rows on screen: each over its placeholder's cells, `cols` cells by one row, keyed
 * like a picture (same source and colour reuse one drawing, another colour or source gets its own). `win` is zen's window.
 */
export function mathLayer(c: AppCtx, d: Derived, rows: number, win?: Window) {
  const { s, t, picMode, picFiles } = d
  const cell = s.cell
  const { first, lo, hi, dx } = win ?? { first: d.top, lo: 0, hi: Number.POSITIVE_INFINITY, dx: 0 }
  if (picMode !== "pixels" || !cell) return null
  const spots = mathSpots(d.view, first, rows, cell, lo, hi)
  // every decode is asked for before anything draws: a render asks nothing after it
  const draw = spots.map((m) => {
    const file = picFiles.file(m.src)
    const key = file && mathKey(file, m, cell, t.name, s.transparent)
    return { m, file, key, img: key ? c.pics.get(key) : null }
  })
  for (const { m, file, key, img } of draw) {
    if (file && key && img === undefined) askPicture(c, d, key, file, { alt: m.src, cols: m.cols, rows: 1 }, cell)
  }
  const place = (m: MathSpot) =>
    ({
      position: "absolute",
      left: m.col + dx,
      top: m.row - first,
      width: m.px.w,
      height: m.px.h,
    }) as const
  return draw.flatMap(({ m, key, img }) => {
    // nothing on the row it would cover yet: an image on an absolute node must not overflow its box, and a box of the
    // formula's own cells keeps its columns out of its neighbours' (a word after it, a second formula beside it)
    if (!key || img === undefined) return <box key={`math-${m.row}-${m.col}-slot`} style={place(m)} />
    // one that did not decode stays the gap its placeholder makes: a row of text has no room for a note
    if (!img) return null
    return (
      <box key={`math-${m.row}-${m.col}`} style={place(m)}>
        <image
          key={key}
          source={img}
          fit="fill"
          onError={() => pixelsFailed(c)}
          style={{ position: "absolute", left: 0, top: 0, width: m.px.w, height: m.px.h }}
        />
      </box>
    )
  })
}

/** The cache key of a formula on screen: a picture's key for a one-row box, which no file of its own can take (the key says `math:`). */
const mathKey = (file: string, m: MathSpot, cell: Cell, theme: string, transparent: boolean) =>
  picKey(
    file,
    { id: 0, line: m.row, left: m.col, cols: m.cols, rows: 1, src: m.src, alt: m.src },
    cell,
    theme,
    transparent,
  )
