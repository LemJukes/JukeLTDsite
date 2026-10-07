// bodyLooks.js — per-body cosmetic looks.
//
// A look decides what one body *looks like*: a round wireframe, a black hole, a teapot... It is
// purely visual. Nothing here reads or writes the simulation: the physics sphere (body.radius) is
// the only size that matters to the sim, and the look is scaled by it.
//
// A look is a registry entry, like a UI style in themes.js:
//
//   id, label, tip   what the UI shows
//   usesDetail       true if the Shape slider drives its round core (otherwise the slider is disabled)
//   build(ctx)       returns { core, decorations, update(dt, ctx), dispose(), coreReach }
//
// build() context: { kit, tracker, color, index, seed, spinAxis, settings, theme }
//   kit        material adapter for the current UI style (see makeKit). Looks make their meshes through
//              it instead of reading theme fields, so one look renders in every style.
//   tracker    owns everything the look allocates; it is all disposed together (see makeTracker)
//   color      THREE.Color ink for this body in the current style
//   seed       stable per-body number (the body slot), for anything randomised
//   spinAxis   the body's cosmetic spin axis (unit vector)
//   settings   the body's look settings ({ object, shape, dice, moonlets, moonletCount })
//
// Returned parts:
//   core         Object3D whose bounding sphere has radius 1, centred on the origin. The scene scales it by
//                body.radius and spins it. It is the only part used for the surface-camera check.
//   decorations  optional Object3D (rings, disks, tails, orbits...). It may extend past radius 1. It is
//                never picked (picking uses an invisible unit sphere) and never limits the surface camera.
//   update       optional; called every frame with the per-frame context (see makeLookContext)
//   dispose      optional; extra clean-up beyond what the tracker already frees
//
// To add a look: add an entry to LOOKS below. It appears in the Object menu automatically.

import * as THREE from 'three';
import { SHAPE_DEFAULT, DICE_MAX, HULL_FROM, stopFor, buildShapeGeometry, diceSegments } from './shapes.js';

// ---- settings ---------------------------------------------------------------

export const MOONLET_MAX = 4;

export const DEFAULT_LOOK = Object.freeze({
  object: 'body',
  shape: SHAPE_DEFAULT,
  dice: false,
  moonlets: false,
  moonletCount: 2,
});

export const defaultLook = () => ({ ...DEFAULT_LOOK });

const asBool = (v) => v === true || v === 1 || v === 'true';

/**
 * Normalise anything (a UI patch, an imported file) into valid look settings: unknown object ids
 * fall back to the default, the shape snaps to the nearest stop, flags are coerced to booleans and
 * the moonlet count is clamped. Always returns a fresh plain object.
 */
export function sanitizeLook(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const object = typeof o.object === 'string' && Object.hasOwn(LOOKS, o.object) ? o.object : DEFAULT_LOOK.object;
  const s = Number(o.shape);
  const shape = Number.isFinite(s) ? Math.min(100, Math.max(0, Math.round(s / 10) * 10)) : DEFAULT_LOOK.shape;
  const c = Number(o.moonletCount);
  const moonletCount = Number.isFinite(c) ? Math.min(MOONLET_MAX, Math.max(1, Math.round(c))) : DEFAULT_LOOK.moonletCount;
  return { object, shape, dice: asBool(o.dice), moonlets: asBool(o.moonlets), moonletCount };
}

// ---- resource ownership -----------------------------------------------------

// Geometries shared between bodies (e.g. every body's unit icosahedron), reference counted so the last
// user frees them.
const geometryCache = new Map(); // key -> { geometry, refs }

function acquireGeometry(key, factory) {
  let entry = geometryCache.get(key);
  if (!entry) {
    entry = { geometry: factory(), refs: 0 };
    geometryCache.set(key, entry);
  }
  entry.refs++;
  return entry.geometry;
}

function releaseGeometry(key) {
  const entry = geometryCache.get(key);
  if (entry && --entry.refs <= 0) {
    entry.geometry.dispose();
    geometryCache.delete(key);
  }
}

/** Collects everything a look allocates (anything with .dispose(), plus cache references). */
export function makeTracker() {
  const items = [];
  return {
    /** Register a geometry / material / texture / render target to be disposed with the look. */
    own(thing) { items.push(thing); return thing; },
    /** Shared, ref-counted geometry. Do not dispose it yourself. */
    geometry(key, factory) {
      const geometry = acquireGeometry(key, factory);
      items.push({ dispose: () => releaseGeometry(key) });
      return geometry;
    },
    disposeAll() {
      while (items.length) items.pop().dispose();
    },
  };
}

// ---- style kit --------------------------------------------------------------

/**
 * The material adapter for one UI style (the `scene` half of a themes.js entry). A look asks the kit
 * for "a wireframe in this ink" and gets whatever that style draws: today a plain wireframe mesh, in
 * the Lab Notebook style a pencil stroke. Everything it creates is registered with the tracker.
 */
export function makeKit(theme, tracker) {
  const material = (m) => tracker.own(m);
  return {
    theme,
    additive: !!theme.additive,
    lit: false, // no shipped style does lighting, so looks skip shadows
    geometry: (key, factory) => tracker.geometry(key, factory),

    /** Every triangle of `geometry` as a line: the original body look. */
    wire(geometry, color) {
      return new THREE.Mesh(geometry, material(new THREE.MeshBasicMaterial({ color, wireframe: true })));
    },

    /** The true polyhedron edges of `geometry` (no diagonals across flat faces). */
    edges(geometry, color) {
      return new THREE.LineSegments(
        tracker.own(new THREE.EdgesGeometry(geometry, 1)),
        material(new THREE.LineBasicMaterial({ color })),
      );
    },

    /** Loose line segments from a flat [x, y, z, x, y, z, ...] list (every two points make one). */
    lines(positions, color) {
      const geometry = tracker.own(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      return new THREE.LineSegments(geometry, material(new THREE.LineBasicMaterial({ color })));
    },

    /**
     * An invisible solid that still hides whatever is behind it: it writes depth but no colour, so lines
     * on its far side (and the grid, trails and bodies behind it) are cut out. Drawn first, and pushed
     * back a little so lines lying on its surface win.
     */
    occluder(geometry) {
      const mesh = new THREE.Mesh(geometry, material(new THREE.MeshBasicMaterial({
        colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      })));
      mesh.renderOrder = -0.5;
      return mesh;
    },

    /**
     * A solid ball with a crisp outline of constant pixel width: a fill in the page colour with a
     * back-face hull behind it, pushed outward in clip space. Reads as a smooth circle however fine
     * the mesh, and solid ink survives the 1-bit dither where a dense wireframe would clot.
     */
    outlined(geometry, color) {
      const group = new THREE.Group();
      const fill = new THREE.Mesh(geometry, material(new THREE.MeshBasicMaterial({
        color: theme.background, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      })));
      fill.renderOrder = -0.5;
      const hullMat = material(new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { uColor: { value: new THREE.Color(color) }, uPx: { value: 2 }, uViewport: { value: new THREE.Vector2(1, 1) } },
        vertexShader: /* glsl */`
          uniform float uPx;
          uniform vec2 uViewport;
          void main() {
            vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            vec3 n = normalize(normalMatrix * normal);
            vec2 dir = (projectionMatrix * vec4(n, 0.0)).xy;
            dir = length(dir) > 1e-6 ? normalize(dir) : vec2(0.0);
            clip.xy += dir * (uPx * 2.0 / uViewport) * clip.w;
            gl_Position = clip;
          }`,
        fragmentShader: /* glsl */`
          uniform vec3 uColor;
          void main() { gl_FragColor = vec4(uColor, 1.0); }`,
      }));
      const hull = new THREE.Mesh(geometry, hullMat);
      hull.renderOrder = -0.5;
      // line width in buffer pixels: 2 screen pixels in the pixel-grid styles, else 1.5 CSS pixels
      hull.onBeforeRender = (renderer) => {
        const target = renderer.getRenderTarget();
        if (target) hullMat.uniforms.uViewport.value.set(target.width, target.height);
        else renderer.getDrawingBufferSize(hullMat.uniforms.uViewport.value);
        hullMat.uniforms.uPx.value = theme.pixelRatio === 'unit' ? 2 : 1.5 * renderer.getPixelRatio();
      };
      group.add(fill, hull);
      return group;
    },
  };
}

// ---- round cores ------------------------------------------------------------

// Three great circles on the unit sphere as line segments: the equator of the spin and two meridians
// through its poles. The meridians sweep as the body turns, so an outlined sphere still looks like it
// spins.
function contourLines(spinAxis) {
  const a = spinAxis.clone().normalize();
  const p = new THREE.Vector3(1, 0, 0);
  if (Math.abs(a.x) > 0.9) p.set(0, 1, 0);
  p.addScaledVector(a, -p.dot(a)).normalize();
  const q = new THREE.Vector3().crossVectors(a, p);
  const R = 1.006; // just above the surface
  const N = 64;
  const out = [];
  for (const [u, v] of [[p, q], [a, p], [a, q]]) {
    for (let i = 0; i < N; i++) {
      for (const t of [i, i + 1]) {
        const ang = (t / N) * Math.PI * 2;
        out.push(
          (u.x * Math.cos(ang) + v.x * Math.sin(ang)) * R,
          (u.y * Math.cos(ang) + v.y * Math.sin(ang)) * R,
          (u.z * Math.cos(ang) + v.z * Math.sin(ang)) * R,
        );
      }
    }
  }
  return new Float32Array(out);
}

/**
 * The round, slider-driven core shared by every look that has one. The Shape slider picks the stop:
 * dice solids (optionally numbered), geodesic spheres, or an outlined smooth ball.
 */
export function roundCore({ kit, color, settings, spinAxis }) {
  const stop = stopFor(settings.shape);
  const geometry = kit.geometry(`shape:${stop.value}`, () => buildShapeGeometry(stop.value));

  if (stop.value >= HULL_FROM) {
    const group = new THREE.Group();
    group.add(kit.outlined(geometry, color), kit.lines(contourLines(spinAxis), color));
    return group;
  }
  if (stop.value > DICE_MAX) return kit.wire(geometry, color); // 60 is the original body, bit for bit

  const edges = kit.edges(geometry, color);
  if (!settings.dice) return edges;
  const group = new THREE.Group();
  group.add(kit.occluder(geometry), edges, kit.lines(diceSegments(stop.value, geometry), color));
  return group;
}

// ---- registry ---------------------------------------------------------------

export const LOOKS = {
  body: {
    id: 'body',
    label: 'Body',
    tip: 'A round body, drawn the way every body has always looked',
    usesDetail: true,
    build(ctx) {
      return { core: roundCore(ctx) };
    },
  },
};

export const lookOrder = Object.keys(LOOKS);

export function resolveLook(id) {
  return Object.hasOwn(LOOKS, id) ? LOOKS[id] : LOOKS[DEFAULT_LOOK.object];
}

// Distance of the farthest vertex of `root` from its origin. `root` must not be parented yet, so its
// matrices are in core space.
function measureReach(root) {
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let max2 = 0;
  root.traverse((o) => {
    const pos = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      max2 = Math.max(max2, v.lengthSq());
    }
  });
  return Math.sqrt(max2);
}

/**
 * Build one body's look.
 * @param settings  look settings (see sanitizeLook)
 * @param env       { theme, color, index, spinAxis }
 * @returns { def, core, decorations, update, coreReach, dispose }
 */
export function createLook(settings, { theme, color, index, spinAxis }) {
  const def = resolveLook(settings.object);
  const tracker = makeTracker();
  const kit = makeKit(theme, tracker);
  const built = def.build({ kit, tracker, color, index, seed: index, spinAxis, settings, theme });
  return {
    def,
    core: built.core,
    decorations: built.decorations || null,
    update: built.update || null,
    // how far the visible core reaches, in units of the physics radius (the surface camera
    // seats at SURFACE_EYE, so a core reaching past that is hidden while you stand on its body)
    coreReach: built.coreReach ?? measureReach(built.core),
    dispose() {
      if (built.dispose) built.dispose();
      tracker.disposeAll();
    },
  };
}

// ---- per-frame context ------------------------------------------------------

/**
 * The context handed to look.update(dt, ctx), reused every frame. Every vector in it is a copy, so a
 * look can read freely and cannot disturb the simulation. Filled in by the scene.
 *   dt                       seconds on the spin clock (keeps running while the sim is paused)
 *   body                     { index, pos, vel, mass, radius } of this body
 *   spinQ, spinAxis, spinAngle   its current cosmetic spin
 *   others                   [{ index, pos, vel, mass, radius, ejected }] for every other body
 *   theme, camera            the style's scene config, and the live camera (read only)
 */
export function makeLookContext() {
  return {
    dt: 0,
    body: { index: 0, mass: 0, radius: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3() },
    spinQ: new THREE.Quaternion(),
    spinAxis: new THREE.Vector3(),
    spinAngle: 0,
    others: [],
    theme: null,
    camera: null,
  };
}

export function makeOtherSlot() {
  return { index: 0, mass: 0, radius: 0, ejected: false, pos: new THREE.Vector3(), vel: new THREE.Vector3() };
}
