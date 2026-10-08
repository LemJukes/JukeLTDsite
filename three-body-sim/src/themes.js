// themes.js — UI style registry.
//
// A UI style has two halves that switch together:
//   * CSS   — selectors scoped to html[data-theme='<id>'] (styles.css for the
//             default CRT look, themes/<id>.css for the rest) skin the panels,
//             buttons, fonts and window chrome.
//   * scene — the numbers below, which tell the Three.js scene how to draw
//             itself (background, ink colours, blending, post-processing) so
//             the 3D view matches the surrounding UI.
//
// To add a style: add an entry here, add themes/<id>.css (linked from
// index.html) scoped to html[data-theme='<id>'], and it appears in the UI STYLE
// section automatically.
//
// Scene fields
//   background  clear colour
//   fadeTo      colour a trail fades toward at its tail (match the background)
//   additive    true = light-emitting look (additive blending, bloom-friendly);
//               false = ink-on-paper look (multiply-blended trails, normal-blended FX)
//   ink         null = each body keeps its own colour; a number = every body,
//               trail and burst is drawn in that single colour
//   grid        [centre-line colour, other-line colour], gridOpacity, and gridMinPx (null, or the
//               closest pixel spacing grid lines may reach before the grid coarsens; ink styles
//               draw solid lines, because dithered grey ones crawl and flicker as the view moves)
//   com/select  centre-of-mass marker and selection-cage colours (+ comOpacity/selectOpacity)
//   zOpacity   opacity of the dashed z-height drop lines (keep partial alpha off
//               anything that must stay solid when dithering: it breaks into dots)
//   trailEase   exponent shaping a trail's fade (higher = tail fades out sooner)
//   starColors  [faint field, bright stars] colours of the background star field
//   starDensity fraction of the stars drawn (sparser on a white page, where dots read as dirt)
//   bloom       bloom strength; 0 disables the pass
//   dither      true = finish with a 1-bit ordered-dither pass (pure black/white)
//   pixelRatio  render resolution multiplier; null = device pixel ratio (max 2);
//               'unit' = match the style's screen-pixel grid (see pixelUnit below)
//   inverse     true if the finished page is shown in inverse video (CSS inverts it), so a look that
//               wants to *appear* black (a black hole) has to be drawn white here. Optional.
//
// Lab Notebook extras (all optional; the other styles leave them out)
//   stroke      'pencil' = bodies, trails and the grid are hand-drawn graphite pencil lines with a real
//               width (pencil.js) instead of 1-pixel lines
//   paper       true = the background is a procedural sheet of graph paper (screen-fixed ruling and grain)
//               instead of a flat colour; `background` is then the paper colour
//   annot       colour of the red-pen annotations: the selection circle, centre-of-mass note, body labels,
//               velocity arrows and z-height lines
//   notes       true = hand-written annotations are drawn over the scene as an SVG overlay (notes.js)
//   fx          'scribble' = collisions are a red scribbled starburst plus a short note, not a glowing burst
//   gridDefault false = the 3D reference grid starts switched off in this style (the paper already is a
//               grid); the Grid toggle / G key still turns it on. Absent = on, like the other styles.

// Shared by 'mac' and 'mac-dark': the same 1-bit frame, which the dark style inverts with CSS.
const MAC_SCENE = {
  background: 0xffffff,
  fadeTo: 0xffffff,
  additive: false,
  ink: 0x000000,
  grid: [0x000000, 0x000000],
  gridOpacity: 1,
  gridMinPx: 28,
  com: 0x000000,
  comOpacity: 1,
  select: 0x000000,
  selectOpacity: 1,
  zOpacity: 1,
  trailEase: 1.3,
  starColors: [0x000000, 0x000000],
  starDensity: 0.5,
  bloom: 0,
  dither: true,
  pixelRatio: 'unit',
};

export const THEMES = {
  crt: {
    id: 'crt',
    label: 'CRT Terminal',
    tip: 'Green-phosphor vector terminal with a glow and scanlines',
    scene: {
      background: 0x02040a,
      fadeTo: 0x000000,
      additive: true,
      ink: null,
      grid: [0x0c4a2a, 0x0a3a22],
      gridOpacity: 0.4,
      gridMinPx: null,
      com: 0x5b8cff,
      comOpacity: 0.9,
      select: 0xffffff,
      selectOpacity: 0.85,
      zOpacity: 0.5,
      trailEase: 2,
      starColors: [0x2e5a47, 0xb8ffd9],
      starDensity: 1,
      bloom: 0.35,
      dither: false,
      pixelRatio: null,
    },
  },

  mac: {
    id: 'mac',
    label: 'Classic Mac',
    tip: 'Black-and-white System 6/7 desktop: windows, menu bar, 1-bit dithering',
    scene: MAC_SCENE,
  },

  // The same desktop in inverse video. The page is drawn exactly as in 'mac' and themes/mac.css
  // inverts the whole thing (filter: invert), which for a pure black/white bitmap is exact: white
  // ink on black, black-on-white buttons become white-on-black, and so on. So the 3D scene is
  // the unchanged light one, flagged `inverse` for the few things that must end up black.
  'mac-dark': {
    id: 'mac-dark',
    label: 'Classic Mac (Dark)',
    tip: 'The same Mac desktop in inverse video: white on black',
    scene: { ...MAC_SCENE, inverse: true },
  },

  // A physics lab notebook: graph paper, graphite pencil for the drawing, red ballpoint for the notes.
  notebook: {
    id: 'notebook',
    label: 'Lab Notebook',
    tip: 'Graph paper, graphite pencil and red-pen notes: a physics lab notebook',
    scene: {
      background: 0xf4f0e2,       // the paper
      fadeTo: 0xffffff,           // trails fade by multiplying toward white: cream paper would be stained
      additive: false,
      ink: 0x3a3c42,             // graphite
      grid: [0xa9aaa4, 0xc3c4be], // a lighter pencil than the bodies, so it does not fight the paper ruling
      gridOpacity: 1,
      gridMinPx: 46,
      com: 0xc4262e,
      comOpacity: 1,
      select: 0xc4262e,
      selectOpacity: 1,
      zOpacity: 1,
      trailEase: 1.2,
      starColors: [0xb4b4ac, 0x8d8d86],
      starDensity: 0.3,
      bloom: 0,
      dither: false,
      pixelRatio: null,
      stroke: 'pencil',
      paper: true,
      annot: 0xc4262e,            // red ballpoint
      notes: true,
      fx: 'scribble',
      gridDefault: false,
    },
  },
};

// Also the order of the UI Style buttons (two columns) and of the U key: the two Mac styles stay side by side.
export const themeOrder = ['crt', 'notebook', 'mac', 'mac-dark'];
export const DEFAULT_THEME = 'crt';

// Must match the key read by the inline script in index.html's <head>, which
// applies the saved style before first paint so there is no flash of the wrong one.
const STORAGE_KEY = 'three-body-sim:ui-style';

export function resolveTheme(id) {
  return THEMES[id] || THEMES[DEFAULT_THEME];
}

// Initial style: ?theme=<id> in the URL wins, then the saved choice, then the default.
export function initialTheme() {
  let id = null;
  try { id = new URLSearchParams(location.search).get('theme'); } catch { /* ignore */ }
  if (!THEMES[id]) {
    try { id = localStorage.getItem(STORAGE_KEY); } catch { /* storage blocked */ }
  }
  return resolveTheme(id);
}

export function saveTheme(id) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* storage blocked */ }
}

// ---- screen pixel unit ----
// Pixel-font styles size everything in "screen pixels" (CSS var --px) and render the 3D view at
// the same pixel grid. A screen pixel is k whole device pixels (k = display scale, rounded), so
// bitmap type, 1px rules and dither patterns stay crisp at 125% scaling, on retina, and under
// browser zoom, instead of blurring across fractional pixel boundaries. The same formula is
// inlined in index.html's <head> so the first paint is already correct.

/** Size of one screen pixel: `css` CSS px = `k` device px. */
export function pixelUnit() {
  const dpr = window.devicePixelRatio || 1;
  const k = Math.max(1, Math.round(dpr));
  return { dpr, k, css: k / dpr };
}

/** Publish the unit as --px on <html>; call again when the display scale changes. */
export function applyPixelUnit() {
  document.documentElement.style.setProperty('--px', pixelUnit().css + 'px');
}
