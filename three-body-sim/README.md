# 3bsim — Three-Body Simulator

An interactive, real-physics three-body gravity simulator with selectable styles, from a 1980s CRT
terminal to a pencil-on-graph-paper lab
notebook. Watch three "stars" pull on each other and dissolve into the famous chaos of
the [three-body problem](https://en.wikipedia.org/wiki/Three-body_problem) — or load
one of the rare stable solutions and watch it loop forever.

Built as a **buildless static site**: modern [Three.js](https://threejs.org/) loaded
via an import map, plain ES modules, no install and no build step.

![figure-eight choreography](https://upload.wikimedia.org/wikipedia/commons/9/9e/Three_body_problem_figure-8_orbit_animation.gif)

## Features

- **Real N-body gravity** — Newtonian forces with Plummer softening, integrated with a
  symplectic **Velocity-Verlet** scheme so orbital energy stays stable over long runs.
- **Presets** — Default triangle, the **figure-8 choreography**, the rotating **Lagrange**
  triangle, a **binary + distant third**, and **Random** (auto-framed).
- **Click-to-edit bodies** — click any body (or CUSTOM) to select it and tune its mass, size,
  position (x/y/z) and velocity (x/y/z); the edit becomes the new starting state.
- **Orbital trails** that fade behind each body — the signature view of the chaotic dance.
- **Star field** — a fixed background sky (toggle with `B`) so camera turns read clearly, even
  when no body is in view; each body also spins steadily on its own tilted axis.
- **Collisions & impact bursts** — optionally let close bodies merge, with a cosmetic phosphor
  burst on contact.
- **Live telemetry** — total energy, energy-drift %, centre-of-mass offset, per-body speed.
- **3D camera with a focus** — orbit (drag), zoom (scroll), pan (right-drag), auto-frame, and a
  **Focus** you choose in the CAMERA section (or with `0`–`4`):
  - **Free** — the camera stays where you put it.
  - **Center of Mass** or **Body A / B / C** — the camera locks on and travels with it, keeping
    the distance and angle you give it (drag to orbit, scroll to zoom).
  - **Surface** (any body) — stand on a random spot of that body's surface, looking straight up
    and away from its center. You ride the body's motion *and* its spin about its own axis
    (which keeps turning while the sim is paused), so the ground stays fixed beneath you while
    the stars and other bodies wheel across a wide-angle sky. Drag to look around, **New Spot**
    picks another point. If the body you are
    following is merged away the camera drops back to the center of mass.
  A line under the buttons always says what the current choice does.
- **Body looks** — give each body a different look: a black hole that bends the sky behind it,
  a pulsar, a comet, a ringed planet, an atom, a cherry, an orange, grapes or a teapot, with a
  Shape slider that runs from a d4 to a smooth ball. Purely cosmetic: see [Body looks](#body-looks).
- **Save / load setups** — export the current bodies, parameters and body looks to a small JSON
  text file and import it back; imports are fully validated and sanitised before they touch the sim.
- **Selectable UI styles** — pick one in the **UI STYLE** section of the panel (or press `U` to
  cycle); the choice is remembered, and `?theme=mac` / `?theme=crt` / `?theme=notebook` in the URL
  overrides it:
  - **CRT Terminal** (default) — early-CG low-poly wireframe bodies, a phosphor glow (bloom),
    scanlines, dashed z-height drop lines, and a blue centre-of-mass crosshair on a faint grid.
  - **Classic Mac** and **Classic Mac Dark** (the same desktop in inverse video) — a 1-bit
    black-and-white System 6/7 desktop: menu bar, a striped-title-bar
    scene window and a closable Controls palette with a classic scrollbar, rounded push buttons
    with a heavy default ring, tick-mark sliders, Balloon-Help tooltips, and the dithered grey
    desktop. The 3D view is rendered as black ink on white and finished with an ordered dither,
    so fading trails, the grid and impact bursts become stippled MacPaint-style patterns.
  - **Lab Notebook** — a physics lab notebook: graph paper (screen-fixed ruling, a red margin
    rule, a faint grain), bodies, trails and the grid drawn as hand-wobbled **graphite pencil**,
    and **red-pen annotations** written over the page: a circle round the selected body,
    "c.o.m.", a letter and leader line beside each body, and a note ("impact!", "merge") with a
    scribbled starburst where bodies collide. The panel is an index card taped into the margin,
    with hand-drawn buttons and pencil-mark sliders.

## Run it locally

It's a static site, but ES modules must be served over HTTP (not opened from `file://`).
From the project folder, start any static server:

```bash
# Python (preinstalled on most systems)
python -m http.server 8080

# …or Node
npx serve -l 8080
```

Then open <http://localhost:8080>.

## Host it on your site

No build, no install — these are plain static files that use only relative paths (Three.js
comes from a CDN via the import map), so the folder works at any URL. Copy this whole folder
into your site and link to it:

```
your-site/
  three-body-sim/      ← this folder
    index.html
    styles.css
    src/...
```

It will be live at `https://your-site.com/three-body-sim/`. Rename the folder to anything you
like — nothing depends on the name. One caveat: don't paste a copy that still contains its own
hidden `.git` folder, or Git treats it as a nested repository and won't commit the contents —
this folder is already clean of that.

## Controls

| Action                | Mouse / UI                  | Key |
|-----------------------|-----------------------------|-----|
| Play / pause          | START / PAUSE               | `Space` |
| Single step           | STEP                        | `S` |
| Reset to start        | RESET                       | `R` |
| New random system     | RANDOM                      | `N` |
| Frame all bodies      | FRAME ALL                   | `F` |
| Select / edit body    | click a body, or CUSTOM     |     |
| Deselect              |                             | `Esc` |
| Toggle trails         | trails                      | `T` |
| Toggle grid           | grid                        | `G` |
| Toggle velocity       | velocity                    | `V` |
| Toggle z-height lines | z-height                    | `Z` |
| Toggle stars          | stars                       | `B` |
| Cycle collisions      | collisions                  | `C` |
| Camera focus          | CAMERA › Focus              | `0` free, `1`–`3` body A–C, `4` center of mass |
| Surface view          | CAMERA › View from          | `P` |
| Cycle UI style        | UI STYLE                    | `U` |
| Orbit / zoom / pan    | drag / scroll / right-drag  |     |
| Body look             | SELECTED BODY › LOOK        |     |

**Parameters:** `speed` (time scale), `quality` (integration sub-steps), `gravity G`,
`softening`, and `trail` length.

## Body looks

Select a body (click it, or CUSTOM) and its **Look** box appears under its sliders. A look is only
how a body is drawn: it never changes its mass, size, gravity, collisions or anything the physics
exports. A body is always scaled by its physics radius, and clicks hit an invisible sphere of that
size, so every look is as easy to pick as a plain ball. Looks survive preset loads and Reset (an
import replaces them), and **Apply to All** gives all three bodies the selected body's look.

| Control        | What it does |
|----------------|--------------|
| **Object**     | Body (the original), Black hole, Neutron star, Comet, Ringed planet, Atom, Cherry, Orange, Grapes, Teapot |
| **Shape**      | Eleven fixed stops for the round core: d4 tetrahedron, d6 cube, d8, d10, d12, d20, then geodesic spheres (detail 1 is the original body, 2, 4, 8) and a smooth ball. Stops from detail 4 up are drawn as an outline instead of a wireframe. Greyed out for looks with a fixed shape |
| **Dice faces** | Numbers the faces of the dice stops with line-stroke numerals: opposite faces add up to one more than the face count, the d10 runs 0–9, the d4 is read at the corners |
| **Moonlets**   | 1–4 small decorative moons on tilted circular orbits, for any look. No gravity, no collisions |

- **Black hole** — a black event horizon and a thin accretion disk (Doppler-brightened on the side
  moving toward you). A screen-space lens bends the stars, grid and trails behind it, with a solid
  shadow and a highlight ring; only what lies *behind* the hole is bent, so a body passing in
  front stays sharp. Up to three at once.
- **Neutron star** — a hot core, dipole field lines and two pulsar beams on a magnetic axis tilted
  30° from the spin axis, so they sweep as it turns.
- **Comet** — a lumpy nucleus, a straight ion tail pointing away from the heaviest other body (or,
  if the comet is the heaviest, the body pulling on it hardest) and a curved dust tail that lags
  behind its motion. Tail length grows as it nears that body, within fixed limits.
- **Ringed planet** — rings in the plane perpendicular to the body's own spin axis.
- **Standing on a body** (CAMERA › Surface) works for every look; things that start at its centre
  (tails, beams, field lines) are not drawn around you.
- Merging: the surviving body keeps its own look and the swallowed body's drawing is freed.

Each body's look is saved with the setup as an optional `look` field (a file without one loads
with the default look, and older versions of the app ignore it):

```json
{ "name": "Body A", "mass": 1, "radius": 1.4, "color": "#4dff88",
  "pos": [0, 12, 0], "vel": [-0.06, 0, 0],
  "look": { "object": "teapot", "shape": 60, "dice": false, "moonlets": true, "moonletCount": 2 } }
```

On import an unknown `object` becomes `body`, `shape` snaps to the nearest valid stop, `dice` and
`moonlets` are coerced to booleans and `moonletCount` is clamped to 1–4.

### Adding a body look

Add an entry to `LOOKS` in `src/bodyLooks.js`: `{ id, label, tip, usesDetail, build(ctx) }`, where
`build` returns `{ core, decorations, update, dispose }`. The `core` is normalised to a bounding
sphere of radius 1; `decorations` (rings, tails, orbits) may extend past it and are never picked.
Make things through the style kit (`ctx.kit`: wireframes, edges, lines, fading lines, beams,
outlined balls) rather than reading theme fields, so the look works in every style; whatever the
look allocates is disposed with it. It appears in the Object menu automatically.

## Project layout

```
index.html        markup + Three.js import map
styles.css        shared layout + the default CRT terminal style
themes/
  mac.css         Classic Mac (System 6/7) styles, scoped to html[data-theme^='mac']
  notebook.css    Lab Notebook styles, scoped to html[data-theme='notebook']
src/
  main.js         bootstrap, controller, fixed-step animation loop
  physics.js      NBodySystem: Velocity-Verlet integrator, energy, centre of mass
  presets.js      named initial conditions
  scene.js        Three.js scene, bodies, trails, grid, picking, paper background, post-processing
  ui.js           control panel and telemetry
  themes.js       UI style registry (3D scene look per style) + saved choice
  bodyLooks.js    per-body looks: registry, the per-style material kit, the ten looks
  shapes.js       the Shape slider's stops, their geometry, dice numbering
  numerals.js     single-stroke vector numerals for the dice
  lens.js         gravitational lensing post pass for black holes
  noise.js        seeded noise for lumpy / dimpled looks
  pencil.js       hand-wobbled graphite pencil strokes (Lab Notebook)
  notes.js        red-pen annotation overlay (Lab Notebook)
  icons.js        pixel-art button icons, shared by every style
  io.js           export / import of setups, with validation + sanitisation
  effects.js      cosmetic collision / impact bursts
```

## Adding a UI style

A style is two halves that switch together:

1. **CSS** — `themes/<id>.css`, with every selector scoped to `html[data-theme='<id>']`, linked
   from `index.html`. Markup labels are written in Title Case (the CRT style upper-cases them
   with CSS), and a button's leading symbol (`▶ Start`) becomes a pixel icon from `src/icons.js`
   in an `.ic` span that takes the button's text colour.
2. **Scene** — an entry in `src/themes.js` (background, ink colour or per-body colours, grid,
   blending, bloom, optional 1-bit dither). It then appears in the UI STYLE section automatically.

A style can ask the scene for more than colours (see the header of `src/themes.js`): the Lab
Notebook sets `stroke: 'pencil'` (real-width hand-drawn lines), `paper` (a procedural graph-paper
background), `notes` (the red-pen overlay) and `fx: 'scribble'`, and Classic Mac Dark sets
`inverse` so a black hole is drawn white in a frame that CSS then inverts.

Styles only change how things look; they never touch the simulation. The Classic Mac style sizes
everything in "screen pixels" (`--px`), chosen as a whole number of device pixels so the bitmap
type and dither patterns stay crisp at 125% scaling, on retina displays and under browser zoom.

## A note on units

Units are normalised, not SI: `G` defaults to `1`, masses are ~1–10 and distances ~tens of
units, tuned so things orbit nicely on screen. `G` is exposed as a slider — the real-world
`6.674×10⁻¹¹` would just force awkward scaling without changing the dynamics.

## About this code

The code in this project was generated by an AI language model (an LLM), but every design choice, and all responsibility for the result, lies squarely with the developer.
