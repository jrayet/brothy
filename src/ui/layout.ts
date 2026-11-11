// Screen geometry, pure: where the status rows, the panel or drawer, the document column and the minimap go for a
// terminal size and the store's view state.
import { MINI_MIN_W, MINI_W } from "./minimap"
import type { ZenConfig } from "./zen"

/** Reading measure: the document never wraps wider than this. */
export const MEASURE = 80
/** Panel column width: a share of the screen, clamped. */
const PANEL_MIN_W = 24
const PANEL_MAX_W = 40
const PANEL_SHARE = 0.27
/** Drawer width: a share of the screen, clamped, and never wider than the screen minus this margin. */
const DRAWER_MIN_W = 28
const DRAWER_MAX_W = 40
const DRAWER_SHARE = 0.45
const DRAWER_MARGIN = 8
/** The document column never gets narrower than this. */
const MIN_MEASURE = 20
/** Rows of the `/` popup list at most. */
const MAX_LIST_ROWS = 16
/** Blank columns between two panes of zen's columns flow. */
export const COL_GAP = 3
/** The gutter zen keeps left of each pane's text (the typewriter marker). */
const ZEN_GUTTER = 2

/** Below this width the panel is a drawer over the text instead of a column beside it. */
export const DRAWER_BELOW = 100

/** The view state `layout` reads (fields of the app's `UI`). */
export interface LayoutState {
  hidden: boolean
  drawerOpen: boolean
  zen: boolean
  source: boolean
  zenCfg: ZenConfig
  wide: boolean
  minimap: boolean
  openPath: string | null
}

/**
 * Screen rows: top line, gap (H ≥ 28), body (panel + document), ghost line, progress line.
 * At DRAWER_BELOW columns and wider the panel is a column left of the document (unless hidden);
 * below that it is a drawer over the document, and the document lays out as if it were not there.
 * The document wraps at `CW` = min(available, MEASURE), centered (`wide` / zen "full": the
 * area minus a 2-column margin each side). Zen (unless Source is shown) drops the panel.
 */
export function layout(W: number, H: number, s: LayoutState) {
  const zen = s.zen && !s.source
  const mode: "inline" | "drawer" = W < DRAWER_BELOW ? "drawer" : "inline"
  // the welcome page (no note open) has the whole width: no panel, drawer or minimap; the saved sidebar is left alone
  const welcome = !s.openPath
  const shown = !zen && !welcome && (mode === "drawer" ? s.drawerOpen : !s.hidden)
  const SW = Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, Math.round(W * PANEL_SHARE)))
  /** drawer width; its `▏` edge is one more column */
  const DW = Math.min(W - DRAWER_MARGIN, Math.max(DRAWER_MIN_W, Math.min(DRAWER_MAX_W, Math.round(W * DRAWER_SHARE))))
  const inline = shown && mode === "inline"
  const gap = H >= 28 ? 1 : 0
  const bodyH = Math.max(4, H - 3 - gap)
  const areaW = W - 2 - (inline ? SW + 1 : 0)
  const plain = s.wide ? "full" : MEASURE
  const want = zen ? s.zenCfg.measure : plain
  // zen's columns flow: panes side by side, each at least the measure wide, as many as fit
  const avail = areaW - 4
  const columnsFlow = zen && s.zenCfg.flow === "columns"
  // a pane may never be narrower than the measure: a narrower one wraps lines the reader did not ask for
  const minPane = columnsFlow && want !== "full" ? Math.max(MIN_MEASURE, want) : MIN_MEASURE
  // the pane count follows from the width alone: the most panes that still hold a pane at least
  // minPane wide; "full" has no minimum to respect, so it is the one wide column
  const cols =
    !columnsFlow || want === "full" ? 1 : Math.max(1, Math.floor((avail + COL_GAP) / (minPane + ZEN_GUTTER + COL_GAP)))
  // every pane shares the width out, so the band fills the area
  const shared = Math.floor((avail - (cols - 1) * COL_GAP) / cols)
  const paneCap = Math.max(MIN_MEASURE, cols > 1 ? shared - ZEN_GUTTER : shared)
  // in the columns flow every pane fills its share, one pane included, so a lone column reaches the window's edge
  let CW = columnsFlow ? paneCap : Math.max(MIN_MEASURE, Math.min(want === "full" ? avail : want, paneCap))
  const band = cols * (CW + ZEN_GUTTER) + (cols - 1) * COL_GAP
  let padL = cols > 1 ? Math.max(0, Math.floor((areaW - band) / 2)) : Math.max(0, Math.floor((areaW - CW) / 2))
  // the minimap takes the last MINI_W columns (the right margin and padding): the text keeps its
  // column while it fits left of the minimap's gap, then the measure shrinks (left margin kept)
  const mini = s.minimap && !zen && !welcome && W >= MINI_MIN_W
  if (mini) {
    const room = W - MINI_W - 1 - (inline ? SW + 1 : 0)
    CW = Math.max(MIN_MEASURE, Math.min(CW, room - 2))
    padL = Math.max(0, Math.min(padL, room - CW))
  }
  return {
    zen,
    mode,
    shown,
    inline,
    SW,
    DW,
    /** panel width on screen */
    PNW: mode === "drawer" ? DW : SW,
    gap,
    bodyH,
    areaW,
    CW,
    /** panes side by side (zen's columns flow; 1 elsewhere) */
    cols,
    CH: bodyH,
    /** document left margin inside its area */
    padL,
    /** the braille minimap is drawn at the right edge */
    mini,
    /** visible rows of the `/` popup list: panel padding 2, title, input, two gaps */
    PH: Math.max(1, Math.min(MAX_LIST_ROWS, H - 2 - 6)),
  }
}
