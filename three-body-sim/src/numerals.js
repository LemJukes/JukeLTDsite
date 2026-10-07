// numerals.js — a tiny single-stroke vector font for dice numerals.
//
// Each digit is a few polylines in a box 0.6 wide and 1 tall (y up). The numerals are drawn as plain
// line segments rather than a canvas texture, so they stay crisp under bloom and survive the 1-bit
// dither: a texture would blur or break into dots, a one-pixel line does neither.

const W = 0.6;       // glyph width
const GAP = 0.22;    // space between glyphs

const rot180 = (poly) => poly.map(([x, y]) => [W - x, 1 - y]);
const SIX = [[0.55, 0.95], [0.3, 1], [0.1, 0.85], [0, 0.55], [0, 0.15], [0.15, 0], [0.45, 0], [0.6, 0.15],
  [0.6, 0.4], [0.45, 0.55], [0.15, 0.55], [0, 0.4]];

const GLYPHS = {
  0: [[[0.15, 0], [0.45, 0], [0.6, 0.15], [0.6, 0.85], [0.45, 1], [0.15, 1], [0, 0.85], [0, 0.15], [0.15, 0]]],
  1: [[[0.1, 0.78], [0.32, 1], [0.32, 0]], [[0.1, 0], [0.54, 0]]],
  2: [[[0, 0.82], [0.15, 1], [0.45, 1], [0.6, 0.85], [0.6, 0.65], [0, 0], [0.6, 0]]],
  3: [[[0, 0.9], [0.12, 1], [0.48, 1], [0.6, 0.88], [0.6, 0.62], [0.45, 0.5], [0.2, 0.5]],
    [[0.45, 0.5], [0.6, 0.38], [0.6, 0.12], [0.48, 0], [0.12, 0], [0, 0.1]]],
  4: [[[0.45, 0], [0.45, 1], [0, 0.3], [0.6, 0.3]]],
  5: [[[0.58, 1], [0.05, 1], [0, 0.55], [0.4, 0.6], [0.58, 0.48], [0.6, 0.15], [0.45, 0], [0.12, 0], [0, 0.1]]],
  6: [SIX],
  7: [[[0, 1], [0.6, 1], [0.2, 0]]],
  8: [[[0.15, 0.5], [0.02, 0.38], [0.02, 0.12], [0.15, 0], [0.45, 0], [0.58, 0.12], [0.58, 0.38], [0.45, 0.5], [0.15, 0.5]],
    [[0.15, 0.5], [0.04, 0.62], [0.04, 0.88], [0.15, 1], [0.45, 1], [0.56, 0.88], [0.56, 0.62], [0.45, 0.5]]],
  9: [rot180(SIX)],
};

// 6 and 9 are the same shape upside down, so dice that have both underline them
const UNDERLINE = [[0, -0.2], [W, -0.2]];

/**
 * Line segments for `text` (digits only), centred on the origin, as a flat [x1, y1, x2, y2, ...] list
 * in glyph units (a digit is 1 tall). `underline` underlines 6 and 9.
 */
export function textSegments(text, underline = false) {
  const chars = [...String(text)].filter((c) => c in GLYPHS);
  const width = chars.length * W + Math.max(0, chars.length - 1) * GAP;
  const out = [];
  chars.forEach((ch, k) => {
    const x0 = -width / 2 + k * (W + GAP);
    const polys = GLYPHS[ch].slice();
    if (underline && (ch === '6' || ch === '9')) polys.push(UNDERLINE);
    for (const poly of polys) {
      for (let i = 0; i + 1 < poly.length; i++) {
        out.push(x0 + poly[i][0], poly[i][1] - 0.5, x0 + poly[i + 1][0], poly[i + 1][1] - 0.5);
      }
    }
  });
  return out;
}
