# 3bsim — Three-Body Simulator

An interactive, real-physics three-body gravity simulator with a 1980s CRT-terminal
look. Watch three "stars" pull on each other and dissolve into the famous chaos of
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
- **Save / load setups** — export the current bodies and parameters to a small JSON text file
  and import it back; imports are fully validated and sanitised before they touch the sim.
- **Selectable UI styles** — pick one in the **UI STYLE** section of the panel (or press `U` to
  cycle); the choice is remembered, and `?theme=mac` / `?theme=crt` in the URL overrides it:
  - **CRT Terminal** (default) — early-CG low-poly wireframe bodies, a phosphor glow (bloom),
    scanlines, dashed z-height drop lines, and a blue centre-of-mass crosshair on a faint grid.
  - **Classic Mac** and **Classic Mac Dark** (the same desktop in inverse video) — a 1-bit
    black-and-white System 6/7 desktop: menu bar, a striped-title-bar
    scene window and a closable Controls palette with a classic scrollbar, rounded push buttons
    with a heavy default ring, tick-mark sliders, Balloon-Help tooltips, and the dithered grey
    desktop. The 3D view is rendered as black ink on white and finished with an ordered dither,
    so fading trails, the grid and impact bursts become stippled MacPaint-style patterns.

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

**Parameters:** `speed` (time scale), `quality` (integration sub-steps), `gravity G`,
`softening`, and `trail` length.

## Project layout

```
index.html        markup + Three.js import map
styles.css        shared layout + the default CRT terminal style
themes/
  mac.css         Classic Mac (System 6/7) styles, scoped to html[data-theme^='mac']
src/
  main.js         bootstrap, controller, fixed-step animation loop
  physics.js      NBodySystem: Velocity-Verlet integrator, energy, centre of mass
  presets.js      named initial conditions
  scene.js        Three.js scene, bodies, trails, grid, picking, bloom / 1-bit dither post-processing
  ui.js           control panel and telemetry
  themes.js       UI style registry (3D scene look per style) + saved choice
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

Styles only change how things look; they never touch the simulation. The Classic Mac style sizes
everything in "screen pixels" (`--px`), chosen as a whole number of device pixels so the bitmap
type and dither patterns stay crisp at 125% scaling, on retina displays and under browser zoom.

## A note on units

Units are normalised, not SI: `G` defaults to `1`, masses are ~1–10 and distances ~tens of
units, tuned so things orbit nicely on screen. `G` is exposed as a slider — the real-world
`6.674×10⁻¹¹` would just force awkward scaling without changing the dynamics.
