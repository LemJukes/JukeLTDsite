// icons.js — small pixel-art button icons.
//
// Button labels in ui.js start with a symbol ("▶ Start"); this maps each symbol to an inline
// SVG instead of relying on the font having that glyph. Each icon is a 12x12 bitmap (# = ink)
// turned into crisp-edged rectangles filled with `currentColor`, so it takes whatever colour the
// button has (including inverse video in the Classic Mac style) and stays sharp at any
// whole-pixel scale. The CRT style shows them at 12 CSS px; the Mac style sizes them in screen
// pixels.

const ART = {
  // play: right-pointing triangle
  '▶': [
    '...#........',
    '...##.......',
    '...###......',
    '...####.....',
    '...#####....',
    '...######...',
    '...#####....',
    '...####.....',
    '...###......',
    '...##.......',
    '...#........',
  ],
  // pause: two bars
  '⏸': [
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
  ],
  // step: triangle + bar ("advance one frame"), so it can't be mistaken for stop
  '⏭': [
    '.#......###.',
    '.##.....###.',
    '.###....###.',
    '.####...###.',
    '.#####..###.',
    '.######.###.',
    '.#####..###.',
    '.####...###.',
    '.###....###.',
    '.##.....###.',
    '.#......###.',
  ],
  // reset: curved arrow back to the start
  '↺': [
    '............',
    '..#.........',
    '.##.........',
    '##########..',
    '###########.',
    '.##.......##',
    '..#........#',
    '..........##',
    '.........##.',
    '...######...',
  ],
  // save / confirm: check mark
  '✓': [
    '............',
    '..........##',
    '.........##.',
    '........##..',
    '.......##...',
    '##....##....',
    '###..##.....',
    '.#####......',
    '..###.......',
    '...#........',
  ],
  // cancel: cross
  '✕': [
    '.##......##.',
    '..##....##..',
    '...##..##...',
    '....####....',
    '.....##.....',
    '.....##.....',
    '....####....',
    '...##..##...',
    '..##....##..',
    '.##......##.',
  ],
  // import: arrow down into a tray
  '⭳': [
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '...######...',
    '....####....',
    '.....##.....',
    '.#........#.',
    '.#........#.',
    '.##########.',
  ],
  // export: arrow up out of a tray
  '⭱': [
    '.....##.....',
    '....####....',
    '...######...',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.#........#.',
    '.#........#.',
    '.##########.',
  ],
  // frame all: corner brackets
  '⛶': [
    '####....####',
    '#..........#',
    '#..........#',
    '#..........#',
    '............',
    '............',
    '............',
    '............',
    '#..........#',
    '#..........#',
    '#..........#',
    '####....####',
  ],
  // random spot: a die showing five
  '⚄': [
    '.##########.',
    '.#........#.',
    '.#.##..##.#.',
    '.#.##..##.#.',
    '.#........#.',
    '.#...##...#.',
    '.#...##...#.',
    '.#........#.',
    '.#.##..##.#.',
    '.#.##..##.#.',
    '.#........#.',
    '.##########.',
  ],
};

// One rectangle per horizontal run of ink pixels; bitmaps shorter than 12 rows are centred.
function bitmapToPath(rows) {
  const top = (12 - rows.length) >> 1;
  let d = '';
  rows.forEach((row, y) => {
    for (const m of row.matchAll(/#+/g)) d += `M${m.index} ${y + top}h${m[0].length}v1h-${m[0].length}z`;
  });
  return d;
}

const ICONS = Object.fromEntries(Object.entries(ART).map(([sym, rows]) => [sym, bitmapToPath(rows)]));

/** Whether `sym` has an icon. */
export const hasIcon = (sym) => sym in ICONS;

/** Inline SVG markup for `sym` (assumes hasIcon). Static strings only — safe for innerHTML. */
export function iconSvg(sym) {
  return `<svg class="icon" viewBox="0 0 12 12" width="12" height="12" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true" focusable="false"><path d="${ICONS[sym]}"/></svg>`;
}
