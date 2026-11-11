// Cutting a formula too wide to draw legibly into pieces at its top-level break points. Pure: the string is scanned,
// and every width comes from a callback, so the caller typesets (MathJax widths come from elsewhere) and lays out
// again. Nothing here typesets, measures or caches anything.

/** One place a formula may be cut: the index just after the delimiter, and its kind. */
export type BreakKind = "," | "qquad" | "=" | "rel"
export interface Break {
  at: number
  kind: BreakKind
}

/** Width of a typeset piece in reference-raster pixels, or null when it has not been typeset yet. */
export type Width = (latex: string) => number | null

export interface Segmented {
  /** The pieces to draw, in reading order; joining them with "" gives back `source` apart from trimmed whitespace. */
  pieces: string[]
  /** Pieces whose width is not known yet: the caller must typeset these and lay out again. */
  missing: string[]
  /** False when the formula had no usable break point and still has to be drawn smaller than the floor. */
  breakable: boolean
}

/** A source longer than this, or more pieces than `MAX_PIECES`, is drawn whole rather than cut. */
const MAX_SOURCE = 20_000
const MAX_PIECES = 64

/** Where a formula is cut, the finest break first: a comma, a space, an equality, a relation. */
const KINDS: readonly BreakKind[] = [",", "qquad", "=", "rel"]

/** The spaces a break may follow, by the name `commandAt` reads (`\;` has the name ";" and `\,` ","). */
const SPACES: Record<string, true> = { qquad: true, quad: true, ";": true, ",": true }

/** The relations a break may follow, whole names, so `\leftarrow` never reads as `\left`. */
const RELATIONS = new Set(["?", "iff", "Leftrightarrow", "Rightarrow", "Leftarrow", "leftarrow", "to", "rightarrow"])

/** Brackets that group with no command to say so: a comma in `f(x,y)` or `(a, b)` is not a break. */
const BRACKETS: Record<string, string> = { "(": ")", "[": "]", "{": "}" }
const CLOSERS: Record<string, true> = { ")": true, "]": true, "}": true }

/** Environments read like a formula: a break inside one is still a top-level break. */
const FORMULA_ENV: Record<string, true> = { split: true, aligned: true, align: true }

/** The commands whose `{…}` arguments stay atomic: `\frac{a,b}{c}`, `\text{slow, then fast}`, `\boxed{…}`. */
const ATOMIC: Record<string, number> = {
  boxed: 1,
  text: 1,
  textrm: 1,
  textbf: 1,
  textit: 1,
  mathrm: 1,
  mathbf: 1,
  operatorname: 1,
  operatornamewithlimits: 1,
  frac: 2,
  dfrac: 2,
  tfrac: 2,
}

/**
 * Top-level cut points of `source`, left to right: never inside braces, \left…\right, \begin…\end, \text{…}.
 *
 * `at` means "cut here", so the delimiter (and the space after it) stays with the piece on its left.
 */
export function breakPoints(source: string): Break[] {
  const found: Break[] = []
  scan(source, 0, (at, kind) => found.push({ at, kind }))
  return found
}

/**
 * Cut `source` so every piece draws at most `fitsPx` wide at the floor, merging neighbours while they still fit.
 *
 * Greedy left to right: the longest run of chunks that still fits becomes a piece, cut at the preferred kind a break
 * offers. A chunk too wide on its own is cut inside it at the next kind down, and one with no finer break left is
 * drawn smaller. A width that is not known yet stops the call — the pieces it could not measure are reported in
 * `missing`, in the order the layout asked for them, and no piece is guessed.
 */
export function segment(source: string, fitsPx: number, width: Width): Segmented {
  if (source.length > MAX_SOURCE) return one(source)
  const all = breakPoints(source)
  if (!all.length) return one(source)
  const fit = measure(width)
  const fits = (latex: string) => {
    const w = fit(latex)
    return w === null ? null : w <= fitsPx
  }

  const out: string[] = []
  const missing: string[] = []
  /** Takes a piece, and says whether the formula could still go on: a width that is not known yet is noted, untouched. */
  const take = (latex: string) => {
    out.push(latex)
    if (fits(latex) === null) missing.push(latex)
    return out.length <= MAX_PIECES
  }
  // a formula that fits as it stands is never cut
  if (fits(source) === true) return { pieces: [source], missing: [], breakable: true }
  if (!lay(source, 0, all, 0, fits, take)) return one(source)
  if (missing.length) return { pieces: [], missing, breakable: true }
  return { pieces: out, missing: [], breakable: true }
}

/** The one piece a formula too long, or without a break, is drawn as. */
const one = (source: string): Segmented => ({ pieces: [source], missing: [], breakable: false })

/**
 * Cuts the formula from `begin` on: a break of the preferred kind first (`KINDS[kind]`, finest first), the next
 * kind down only when that one cannot help. `take` appends a piece and says whether there may be more.
 *
 * `rest` holds the breaks of the piece still to be cut. A piece is the last of that kind whose piece still fits —
 * commas first, so a list is cut at its commas and only cut at a relation when a comma will not do. When no kind fits
 * even one break, the chunk up to the first break there is becomes a piece and is drawn smaller.
 */
function lay(
  source: string,
  begin: number,
  rest: readonly Break[],
  kind: number,
  fits: (latex: string) => boolean | null,
  take: (latex: string) => boolean,
): boolean {
  if (kind >= KINDS.length) {
    // nothing fits even at the last kind: cut at the first break there is, if any, or draw the rest as one piece
    const first = rest.find((b) => b.at > begin)
    if (!first) return take(source.slice(begin))
    if (!take(source.slice(begin, first.at))) return false
    return lay(source, first.at, after(rest, first.at), 0, fits, take)
  }
  const line = rest.filter((b) => b.kind === KINDS[kind])
  if (!line.length) return lay(source, begin, rest, kind + 1, fits, take)

  let stop = -1
  for (const b of line) {
    if (fits(source.slice(begin, b.at)) === false) break
    stop = b.at
  }
  if (stop >= 0) {
    if (!take(source.slice(begin, stop))) return false
    // the next piece starts over at the preferred kind
    return lay(source, stop, after(rest, stop), 0, fits, take)
  }
  return lay(source, begin, rest, kind + 1, fits, take)
}

/** The breaks after `at`, where the piece still to be cut begins. */
const after = (rest: readonly Break[], at: number) => rest.filter((b) => b.at > at)

/** The width callback, asked once per distinct piece: the same inputs always ask the same questions. */
function measure(width: Width): Width {
  const known = new Map<string, number | null>()
  return (latex) => {
    if (!known.has(latex)) known.set(latex, width(latex))
    return known.get(latex) ?? null
  }
}

/** Whether a character of a command's name: `\to` is a name, `\,` and `\;` are one character each. */
const isLetter = (ch: string | undefined) => ch !== undefined && /[a-zA-Z]/.test(ch)

/** Reads the name of the command whose backslash is at `i`, and the index just past it. */
function commandAt(source: string, i: number): { name: string; end: number } {
  let j = i + 1
  if (isLetter(source[j])) while (isLetter(source[j])) j++
  else j++
  return { name: source.slice(i + 1, j), end: j }
}

/** The index just past the `{…}` group opening at `i`, or -1 when there is none or it never closes. */
function groupEnd(source: string, i: number): number {
  if (source[i] !== "{") return -1
  let depth = 0
  for (let j = i; j < source.length; j++) {
    const ch = source[j]
    if (ch === "\\") {
      j++
      continue
    }
    if (ch === "{") depth++
    else if (ch === "}" && --depth === 0) return j + 1
  }
  return -1
}

/**
 * Walks `source` from `i`, reporting every break at bracket depth 0. A bracket pushes the closer it waits for and its
 * closer pops it; `\left…\right` is one bracket whatever it wraps; `\begin…\end` of a matrix or cases is one atom
 * while that of a split is read like the formula around it; an atomic argument is skipped whole. An unbalanced closer
 * stops the walk, so a formula that does not parse yields only the breaks before it stopped making sense.
 */
function scan(source: string, i: number, report: (at: number, kind: BreakKind) => void): void {
  const open: string[] = []
  let at = i
  /** Whether `at` follows a command's end, so `\=` and `\!` are never read as delimiters. */
  let command = false
  while (at < source.length) {
    const ch = source[at]!
    if (CLOSERS[ch]) {
      if (open[open.length - 1] === ch) open.pop()
      command = false
      at++
      continue
    }
    if (BRACKETS[ch]) {
      open.push(BRACKETS[ch]!)
      command = false
      at++
      continue
    }
    if (ch === "," && open.length === 0 && !command) {
      report(at + 1, ",")
      at++
      continue
    }
    if (ch === "=" && open.length === 0 && !command && source[at - 1] !== "=" && source[at + 1] !== "=") {
      report(at + 1, "=")
      at++
      continue
    }
    if (ch !== "\\") {
      command = false
      at++
      continue
    }
    const { name, end } = commandAt(source, at)
    command = true
    // \left and \right each take one delimiter with them, so the bracket they name is never counted twice
    if (name === "left" || name === "right") {
      if (name === "left") open.push("right")
      else if (open[open.length - 1] === "right") open.pop()
      at = end + 1
      command = false
      continue
    }
    if (name === "begin" || name === "end") {
      const env = /^\{([^{}]*)\}/.exec(source.slice(end))
      if (!env) {
        at = end
        continue
      }
      const formula = FORMULA_ENV[env[1]!.trim()]
      if (name === "begin" && !formula) open.push("end")
      if (name === "end" && !formula && open[open.length - 1] === "end") open.pop()
      at = end + env[0].length
      command = false
      continue
    }
    if (open.length === 0) {
      if (SPACES[name]) report(at, "qquad")
      else if (RELATIONS.has(name)) report(at, "rel")
    }
    at = end
    const args = ATOMIC[name] ?? 0
    for (let n = 0; n < args && at >= 0; n++) at = groupEnd(source, at)
    if (at < 0) return
    // the arguments are consumed, so a delimiter right after them is one
    command = false
  }
}
