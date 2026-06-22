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
- **Live telemetry** — total energy, energy-drift %, centre-of-mass offset, per-body speed.
- **3D camera** — orbit (drag), zoom (scroll), pan (right-drag); auto-frame; plus two
  centre-of-mass camera modes that work alone or together: **follow** (stay put, keep aiming
  at the COM) and **track** (travel with the COM at a locked distance — a dolly shot).
- **Save / load setups** — export the current bodies and parameters to a small JSON text file
  and import it back. Imports are fully validated and sanitised before they touch the sim.
- **CRT terminal aesthetic** — early-CG low-poly wireframe bodies, a phosphor glow (bloom),
  scanlines, and a blue centre-of-mass crosshair on a faint infinite grid.

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

## Controls

| Action             | Mouse / UI                  | Key |
|--------------------|-----------------------------|-----|
| Play / pause       | START / PAUSE               | `Space` |
| Single step        | STEP                        | `S` |
| Reset to start     | RESET                       | `R` |
| New random system  | RANDOM                      | `N` |
| Frame all bodies   | FRAME ALL                   | `F` |
| Select / edit body | click a body, or CUSTOM     |     |
| Deselect           |                             | `Esc` |
| Toggle trails      | trails                      | `T` |
| Toggle grid        | grid                        | `G` |
| Toggle velocity    | velocity                    | `V` |
| Orbit / zoom / pan | drag / scroll / right-drag  |     |

**Parameters:** `speed` (time scale), `quality` (integration sub-steps), `gravity G`,
`softening`, and `trail` length.

## Host it on your site

No build, no install — these are plain static files that use only relative paths (Three.js
comes from a CDN via the import map), so the folder works at any URL. Just copy this whole
folder onto your site and link to it:

```
your-site/
  three-body-sim/      ← this folder
    index.html
    styles.css
    src/...
```

It will be live at `https://your-site.com/three-body-sim/`. Rename the folder to anything you
like — nothing depends on the name. (On GitHub Pages it works the same way: drop the folder in
and visit `https://<user>.github.io/<repo>/three-body-sim/`.)

## Project layout

```
index.html        markup + Three.js import map
styles.css        CRT terminal styling
src/
  main.js         bootstrap, controller, fixed-step animation loop
  physics.js      NBodySystem: Velocity-Verlet integrator, energy, centre of mass
  presets.js      named initial conditions
  scene.js        Three.js scene, bodies, trails, grid, picking, bloom post-processing
  ui.js           CRT terminal control panel and telemetry
  io.js           export / import of setups, with validation + sanitisation
```

## A note on units

Units are normalised, not SI: `G` defaults to `1`, masses are ~1–10 and distances ~tens of
units, tuned so things orbit nicely on screen. `G` is exposed as a slider — the real-world
`6.674×10⁻¹¹` would just force awkward scaling without changing the dynamics.
