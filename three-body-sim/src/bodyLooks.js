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

// ---- settings ---------------------------------------------------------------

export const SHAPE_DEFAULT = 60;   // geodesic, detail 1: the original body
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
  return {
    theme,
    additive: !!theme.additive,
    lit: false, // no shipped style does lighting, so looks skip shadows
    geometry: (key, factory) => tracker.geometry(key, factory),

    /** Wireframe of `geometry` in `color`. */
    wire(geometry, color) {
      const mesh = new THREE.Mesh(geometry, tracker.own(new THREE.MeshBasicMaterial({ color, wireframe: true })));
      return mesh;
    },
  };
}

// ---- registry ---------------------------------------------------------------

export const LOOKS = {
  body: {
    id: 'body',
    label: 'Body',
    tip: 'A round body, drawn the way every body has always looked',
    usesDetail: true,
    build({ kit, color }) {
      // low-poly icosahedron (detail 1) for an early-CG wireframe look
      const core = kit.wire(kit.geometry('ico:1', () => new THREE.IcosahedronGeometry(1, 1)), color);
      return { core };
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
