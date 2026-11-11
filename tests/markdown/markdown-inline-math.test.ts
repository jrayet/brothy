// Markdown: `$…$` on one line, drawn in text cells by opentui-math's Unicode renderer where it fits a row.
import { describe, expect, test } from "bun:test"
import { plainOf, render } from "../../src/markdown/render"
import { brothy as t } from "../helpers/theme"

/** The note as one string, its rows joined by a visible break. */
const draw = (src: string) =>
  render(src, 80, t)
    .lines.map((l) => plainOf(l.spans))
    .join("⏎")

describe("inline maths", () => {
  test("a formula that fits one row is drawn in cells", () => {
    expect(draw("Squared: $a^2 + b^2 = c^2$ holds.\n")).toBe("Squared: a² + b² = c² holds.")
  })

  test("a taller formula keeps its source: there is no row height to give it", () => {
    expect(draw("A fraction $\\frac{1}{n}$ and a dot $\\dot v_s$.\n")).toBe(
      "A fraction $\\frac{1}{n}$ and a dot $\\dot v_s$.",
    )
  })

  test("a LaTeX spacing command survives marked's escape rule", () => {
    // `\,` is a backslash escape to marked; read as a comma it would change the formula
    expect(draw("The state $\\sigma\\,\\mathbf{e}\\otimes\\mathbf{e}$ holds.\n")).toBe("The state σe ⊗ e holds.")
  })

  test("text that only looks like a formula is left alone", () => {
    expect(draw("Costs $5 and $10, an escape \\$x\\$, display $$y$$.\n")).toBe(
      "Costs $5 and $10, an escape x, display $$y$$.",
    )
    expect(draw("A code span `$x$` stays.\n")).toBe("A code span $x$ stays.")
  })

  test("a formula it cannot lay out, or a lone dollar, reads as written and never throws", () => {
    expect(draw("Broken $\\frac{1}$ here.\n")).toBe("Broken $\\frac{1}$ here.")
    expect(draw("A lone $ sign.\n")).toBe("A lone $ sign.")
  })

  test("a formula inside a mark keeps the mark's colour and weight", () => {
    const line = render("**$a^2$**\n", 80, t).lines[0]!
    expect(plainOf(line.spans)).toBe("a²")
    expect((line.spans[0]!.attr ?? 0) & 1).toBe(1)
  })
})
