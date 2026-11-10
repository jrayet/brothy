// SVG pictures through resvg's WebAssembly build, loaded once on first use (the .wasm is embedded in the compiled binary).
import { NativeImage } from "@opentui/core"
import { initWasm, Resvg } from "@resvg/resvg-wasm"
import wasmPath from "@resvg/resvg-wasm/index_bg.wasm" with { type: "file" }

let ready = false
let loading: Promise<void> | null = null

/** Loads resvg once; every caller shares the one promise, so a failed load stays failed (an SVG then reads as unreadable). */
export const ensureSvg = (): Promise<void> =>
  // Bun.file, not node:fs: in the compiled binary the path lives in Bun's embedded filesystem.
  (loading ??= Bun.file(wasmPath)
    .arrayBuffer()
    .then((wasm) => initWasm(wasm))
    .then(() => {
      ready = true
    }))

/**
 * An SVG drawn `h` pixels high below its `w` width; without `h`, at `w` pixels wide and the height the aspect gives.
 * Needs `ensureSvg()` first. Fonts: none loaded, so text in SVGs may not show.
 */
export function svgRaster(bytes: Uint8Array, w: number, h?: number): NativeImage {
  if (!ready) throw new Error("svg renderer not loaded")
  return h === undefined ? draw(bytes, w) : drawFitted(bytes, w, h)
}

/** The single-argument form: resvg's own fit to the width, exactly as before a target height existed. */
function draw(bytes: Uint8Array, w: number): NativeImage {
  const svg = new Resvg(new TextDecoder().decode(bytes), { fitTo: { mode: "width", value: w } })
  try {
    const out = svg.render()
    try {
      return NativeImage.fromRgba(out.pixels.slice(), out.width, out.height)
    } finally {
      out.free()
    }
  } finally {
    svg.free()
  }
}

/**
 * Exactly `w × h` with the drawing centred and its aspect kept: the tighter of the two fits decides, so a wide target
 * gets transparent rows above and below (what a caller wants when the box is the text's lines, not the picture's shape).
 */
function drawFitted(bytes: Uint8Array, w: number, h: number): NativeImage {
  // resvg fits through the constructor alone (there is no setter), so the box needs two drawings of the same bytes:
  // one bare, for the root width and height the fit is judged on, and one fitted into the box
  const bare = new Resvg(new TextDecoder().decode(bytes))
  const aspect = bare.height > 0 ? bare.width / bare.height : 1
  bare.free()
  const tall = w / h > aspect
  const svg = new Resvg(new TextDecoder().decode(bytes), {
    fitTo: { mode: tall ? "height" : "width", value: tall ? h : w },
  })
  try {
    const out = svg.render()
    try {
      const dw = Math.min(w, out.width)
      const dh = Math.min(h, out.height)
      const left = Math.floor((w - dw) / 2)
      const top = Math.floor((h - dh) / 2)
      const px = new Uint8Array(w * h * 4) // transparent margins: a new buffer starts zeroed
      for (let y = 0; y < dh; y++)
        px.set(out.pixels.subarray(y * out.width * 4, (y * out.width + dw) * 4), ((top + y) * w + left) * 4)
      return NativeImage.fromRgba(px, w, h)
    } finally {
      out.free()
    }
  } finally {
    svg.free()
  }
}
