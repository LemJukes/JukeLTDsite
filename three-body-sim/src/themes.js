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
    scene: {
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
    },
  },

  // The same desktop in inverse video. The page is drawn exactly as in 'mac' and themes/mac.css
  // inverts the whole thing (filter: invert), which for a pure black/white bitmap is exact: white
  // ink on black, black-on-white buttons become white-on-black, and so on. So the 3D scene is
  // deliberately the unchanged light one.
  'mac-dark': {
    id: 'mac-dark',
    label: 'Classic Mac (Dark)',
    tip: 'The same Mac desktop in inverse video: white on black',
    get scene() { return THEMES.mac.scene; },
  },
};

export const themeOrder = ['crt', 'mac', 'mac-dark'];
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
