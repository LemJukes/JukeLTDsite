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
//   rideHidden   optional; objects inside `decorations` to hide while the camera stands on this body
//   spinScale    optional; turns the look faster or slower than the body's own spin (default 1)
//
// Other registry fields: `noDice: true` for a core with no flat faces to number.
//
// To add a look: add an entry to LOOKS below. It appears in the Object menu automatically.

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHAPE_DEFAULT, DICE_MAX, HULL_FROM, stopFor, buildShapeGeometry, diceSegments } from './shapes.js';
import { fbm3 } from './noise.js';

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
  const page = new THREE.Color(theme.fadeTo); // what a fading line fades toward
  const white = new THREE.Color(0xffffff);
  return {
    theme,
    additive: !!theme.additive,
    lit: false, // no shipped style does lighting, so looks skip shadows
    geometry: (key, factory) => tracker.geometry(key, factory),

    /**
     * A tint for things that are not the body itself (a comet's tails, a pulsar's field): `hex` in the
     * light-emitting styles, the body's own ink in the ink styles, which have no colour. `fade` thins
     * the ink toward the page so it dithers to a lighter stipple.
     */
    accent(hex, ink, fade = 0) {
      return theme.additive ? new THREE.Color(hex) : new THREE.Color(ink).lerp(page, fade);
    },

    /** A whiter version of `color` where light adds up (a hot core); the ink as it is elsewhere. */
    hot(color) {
      return theme.additive ? new THREE.Color(color).lerp(white, 0.55) : new THREE.Color(color);
    },

    /** A see-through solid (a beam of light): light added in glowing styles, a thin ink wash in ink styles. */
    beam(geometry, color, opacity) {
      const mesh = new THREE.Mesh(geometry, material(new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
        blending: theme.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      })));
      return mesh;
    },

    /**
     * `lineCount` polylines of `points` points each, rewritten every frame (see the returned `set`) and
     * fading from `color` at their start to the page at their tip, the way the orbit trails do: added
     * light on dark styles, multiplied ink on light ones, mixed in display space so the dithered tip
     * thins out evenly.
     */
    fadingLines(lineCount, points, color, ease = 1) {
      const segs = lineCount * (points - 1);
      const positions = new Float32Array(segs * 6);
      const colors = new Float32Array(segs * 6);
      const gamma = theme.additive ? 1 : 2.2;
      const ig = 1 / gamma;
      const head = [color.r, color.g, color.b].map((c) => Math.pow(c, ig));
      const tip = [page.r, page.g, page.b].map((c) => Math.pow(c, ig));
      const at = (k, out, o) => { // colour of point k of a line
        const f = Math.pow(1 - k / (points - 1), ease);
        for (let c = 0; c < 3; c++) out[o + c] = Math.pow(tip[c] + (head[c] - tip[c]) * f, gamma);
      };
      for (let l = 0; l < lineCount; l++) {
        for (let k = 0; k < points - 1; k++) {
          const o = (l * (points - 1) + k) * 6;
          at(k, colors, o);
          at(k + 1, colors, o + 3);
        }
      }
      const geometry = tracker.own(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const object = new THREE.LineSegments(geometry, material(new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, depthWrite: false,
        blending: theme.additive ? THREE.AdditiveBlending : THREE.MultiplyBlending,
      })));
      object.frustumCulled = false;
      return {
        object,
        /** Write polyline `line` from `pts`, a flat [x, y, z, ...] list of `points` points. */
        set(line, pts) {
          for (let k = 0; k < points - 1; k++) {
            const o = (line * (points - 1) + k) * 6;
            for (let c = 0; c < 3; c++) { positions[o + c] = pts[k * 3 + c]; positions[o + 3 + c] = pts[(k + 1) * 3 + c]; }
          }
        },
        commit() { geometry.attributes.position.needsUpdate = true; },
      };
    },

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
     * `fill` is the colour of the ball itself (the page colour unless a look wants it solid).
     */
    outlined(geometry, color, fill = theme.background) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(geometry, material(new THREE.MeshBasicMaterial({
        color: fill, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      })));
      body.renderOrder = -0.5;
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
      group.add(body, hull);
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
 * `deform` (optional, { key, apply(geometry) }) lumps or dimples the chosen shape; such a core has no
 * flat faces, so it is never numbered.
 */
export function roundCore({ kit, color, settings, spinAxis }, deform = null) {
  const stop = stopFor(settings.shape);
  const geometry = kit.geometry(
    deform ? `shape:${stop.value}:${deform.key}` : `shape:${stop.value}`,
    () => (deform ? deform.apply(buildShapeGeometry(stop.value)) : buildShapeGeometry(stop.value)),
  );

  if (stop.value >= HULL_FROM) {
    const group = new THREE.Group();
    group.add(kit.outlined(geometry, color), kit.lines(contourLines(spinAxis), color));
    return group;
  }
  if (stop.value > DICE_MAX) return kit.wire(geometry, color); // 60 is the original body, bit for bit

  const edges = kit.edges(geometry, color);
  if (!settings.dice || deform) return edges;
  const group = new THREE.Group();
  group.add(kit.occluder(geometry), edges, kit.lines(diceSegments(stop.value, geometry), color));
  return group;
}

// ---- shared helpers for the looks below -------------------------------------

const Z_AXIS = new THREE.Vector3(0, 0, 1);

// any unit vector perpendicular to `axis`
function anyPerpendicular(axis) {
  const p = Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  return p.addScaledVector(axis, -p.dot(axis)).normalize();
}

// Merge a shape's vertices so its surface is one connected skin with smooth normals (the outline hull
// and any displacement need that), then run `move(vertex)` over every vertex and re-normalise so the
// farthest one sits at radius 1.
function reshape(base, move) {
  base.deleteAttribute('uv');
  base.deleteAttribute('normal');
  const g = mergeVertices(base, 1e-4);
  base.dispose();
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  let max = 0;
  for (let i = 0; i < p.count; i++) {
    move(v.fromBufferAttribute(p, i));
    p.setXYZ(i, v.x, v.y, v.z);
    max = Math.max(max, v.length());
  }
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) / max, p.getY(i) / max, p.getZ(i) / max);
  g.computeVertexNormals();
  return g;
}

// ---- neutron star -----------------------------------------------------------

const PULSAR_TILT = (30 * Math.PI) / 180;   // magnetic axis off the spin axis
const FIELD_SHELLS = [2.2, 3.4];            // dipole L values: where each loop crosses the equator (in radii)
const BEAM_LENGTH = 7;                      // in radii
const BEAM_HALF_ANGLE = (5 * Math.PI) / 180;

// Dipole field lines r = L sin^2(theta), in a frame whose +z is the magnetic axis. Each shell gets four
// loops round the axis, the outer shell turned 45 degrees against the inner. Segment pairs for LineSegments.
function dipoleLines() {
  const out = [];
  const N = 40;
  FIELD_SHELLS.forEach((L, s) => {
    const theta0 = Math.asin(Math.sqrt(1 / L));          // where the loop meets the surface (r = 1)
    for (let a = 0; a < 4; a++) {
      const phi = (a * Math.PI) / 2 + (s * Math.PI) / 4;
      const point = (k) => {
        const th = theta0 + ((Math.PI - 2 * theta0) * k) / N;
        const r = L * Math.sin(th) ** 2;
        return [r * Math.sin(th) * Math.cos(phi), r * Math.sin(th) * Math.sin(phi), r * Math.cos(th)];
      };
      for (let k = 0; k < N; k++) out.push(...point(k), ...point(k + 1));
    }
  });
  return new Float32Array(out);
}

// One beam: a hollow cone with its tip on the star's surface (+z), as triangles for a faint wash plus
// edge lines (generators and two cross-sections) so it reads as a cone in every style.
function beamGeometry() {
  const tip = [0, 0, 1];
  const far = 1 + BEAM_LENGTH;
  const R = BEAM_LENGTH * Math.tan(BEAM_HALF_ANGLE);
  const SIDES = 14;
  const ring = (z, r, k) => [r * Math.cos((k / SIDES) * Math.PI * 2), r * Math.sin((k / SIDES) * Math.PI * 2), z];
  const tris = [];
  const lines = [];
  for (let k = 0; k < SIDES; k++) {
    tris.push(...tip, ...ring(far, R, k), ...ring(far, R, k + 1));
    if (k % 2 === 0) lines.push(...tip, ...ring(far, R, k));
    lines.push(...ring(far, R, k), ...ring(far, R, k + 1));
    lines.push(...ring(1 + BEAM_LENGTH * 0.5, R * 0.5, k), ...ring(1 + BEAM_LENGTH * 0.5, R * 0.5, k + 1));
  }
  return { tris: new Float32Array(tris), lines: new Float32Array(lines) };
}

function neutronStar(ctx) {
  const { kit, tracker, color, spinAxis, seed } = ctx;
  const core = roundCore({ ...ctx, color: kit.hot(color) });

  // the magnetic axis: the spin axis tilted 30 degrees, carried round by the spin so the field wobbles
  const axis = spinAxis.clone().normalize();
  const tilted = axis.clone().multiplyScalar(Math.cos(PULSAR_TILT))
    .addScaledVector(anyPerpendicular(axis).applyAxisAngle(axis, seed * 2.1), Math.sin(PULSAR_TILT));
  const align = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, tilted);

  const field = new THREE.Group();            // its +z is the magnetic axis
  const fieldColor = kit.accent(0x7fd0ff, color);
  field.add(kit.lines(dipoleLines(), fieldColor));
  const beamColor = kit.accent(0xbfe6ff, color);
  const cone = beamGeometry();
  const wash = tracker.own(new THREE.BufferGeometry());
  wash.setAttribute('position', new THREE.BufferAttribute(cone.tris, 3));
  for (const sign of [1, -1]) {
    const beam = new THREE.Group();
    beam.scale.z = sign;
    beam.add(kit.beam(wash, beamColor, kit.additive ? 0.18 : 0.12), kit.lines(cone.lines, beamColor));
    field.add(beam);
  }
  field.quaternion.copy(align);

  return {
    core,
    decorations: field,
    update(dt, ctx2) { field.quaternion.copy(ctx2.spinQ).multiply(align); },
    rideHidden: [field],     // the beams and loops start at the centre: not drawn around you on the surface
    spinScale: 3,            // a pulsar turns fast
  };
}

// ---- comet ------------------------------------------------------------------

const ION_POINTS = 24;
const DUST_LINES = 7;
const DUST_POINTS = 18;
const TAIL_MIN = 1.5;       // tail length in radii: never shorter than this...
const TAIL_MAX = 12;        // ...nor longer
const TAIL_REACH = 70;      // ...and 70 / (distance in radii) in between

const NUCLEUS_STRETCH = new THREE.Vector3(1, 0.8, 0.9);

// The lumpy nucleus: the chosen shape pushed in and out by seeded noise, then stretched a little.
function lumpyNucleus(seed) {
  return {
    key: `comet:${seed}`,
    apply: (base) => reshape(base, (v) => {
      const n = fbm3(v.x * 1.7 + seed * 5.3, v.y * 1.7, v.z * 1.7, seed + 1);
      v.multiplyScalar(0.78 + 0.5 * n).multiply(NUCLEUS_STRETCH);
    }),
  };
}

function comet(ctx) {
  const { kit, color, seed } = ctx;
  const core = roundCore(ctx, lumpyNucleus(seed));

  const ionColor = kit.accent(0x7fc8ff, color);
  const dustColor = kit.accent(0xffd27a, color, 0.45);
  const ion = kit.fadingLines(1, ION_POINTS, ionColor, 1.3);
  const dust = kit.fadingLines(DUST_LINES, DUST_POINTS, dustColor, 1.0);
  const tails = new THREE.Group();
  tails.add(dust.object, ion.object);

  const away = new THREE.Vector3();
  const vhat = new THREE.Vector3();
  const vperp = new THREE.Vector3();
  const side = new THREE.Vector3();
  const ionPts = new Float32Array(ION_POINTS * 3);
  const dustPts = new Float32Array(DUST_POINTS * 3);

  return {
    core,
    decorations: tails,
    update(dt, c) {
      const me = c.body;

      // Which body the tails answer to: the heaviest other body, or when this comet is the heaviest,
      // whichever pulls on it hardest. (Ejected bodies do not count.)
      let ref = null;
      let heaviest = null;
      for (const o of c.others) if (!o.ejected && (!heaviest || o.mass > heaviest.mass)) heaviest = o;
      if (heaviest && heaviest.mass >= me.mass) ref = heaviest;
      else {
        let best = 0;
        for (const o of c.others) {
          if (o.ejected) continue;
          const pull = o.mass / Math.max(o.pos.distanceToSquared(me.pos), 1e-6);
          if (pull > best) { best = pull; ref = o; }
        }
      }

      const speed = me.vel.length();
      vhat.copy(me.vel);
      if (speed > 1e-6) vhat.divideScalar(speed); else vhat.set(0, 0, 0);
      let reach = TAIL_MIN;
      if (ref) {
        away.subVectors(me.pos, ref.pos);
        const d = away.length();
        away.divideScalar(Math.max(d, 1e-6));
        reach = Math.min(TAIL_MAX, Math.max(TAIL_MIN, TAIL_REACH / (d / me.radius)));
      } else if (speed > 1e-6) away.copy(vhat).negate();
      else away.set(1, 0, 0);

      // ion tail: a straight line straight away from the reference body
      for (let k = 0; k < ION_POINTS; k++) {
        const s = (reach * k) / (ION_POINTS - 1);
        ionPts[k * 3] = away.x * s; ionPts[k * 3 + 1] = away.y * s; ionPts[k * 3 + 2] = away.z * s;
      }
      ion.set(0, ionPts);

      // dust tail: starts out the same way but the grains are left behind as the comet moves, so it
      // bends back against the velocity; a fan of curves that spreads with distance
      vperp.copy(vhat).addScaledVector(away, -vhat.dot(away));
      if (vperp.lengthSq() > 1e-8) vperp.normalize(); else vperp.set(0, 0, 0);
      side.crossVectors(away, vhat);
      if (side.lengthSq() < 1e-8) side.copy(anyPerpendicular(away)); else side.normalize();
      const Ld = 0.85 * reach;
      const bend = 0.12 + 0.55 * Math.min(1, speed / 0.8);
      for (let i = 0; i < DUST_LINES; i++) {
        const spread = (i - (DUST_LINES - 1) / 2) / ((DUST_LINES - 1) / 2);
        for (let k = 0; k < DUST_POINTS; k++) {
          const t = k / (DUST_POINTS - 1);
          const along = Ld * t;           // out along the ion tail's direction
          const lag = bend * Ld * t * t;  // bent back against the velocity, more the farther out
          const fan = spread * 0.3 * Ld * t;
          dustPts[k * 3] = away.x * along - vperp.x * lag + side.x * fan;
          dustPts[k * 3 + 1] = away.y * along - vperp.y * lag + side.y * fan;
          dustPts[k * 3 + 2] = away.z * along - vperp.z * lag + side.z * fan;
        }
        dust.set(i, dustPts);
      }
      ion.commit();
      dust.commit();
    },
    rideHidden: [tails],
  };
}

// ---- ringed planet ----------------------------------------------------------

// Bands (inner, outer radius in body radii) with gaps between them.
const RING_BANDS = [[1.45, 1.85], [2.0, 2.65], [2.8, 3.05]];
const RING_STEP = 0.07;

function ringedPlanet(ctx) {
  const { kit, color, spinAxis } = ctx;
  const core = roundCore(ctx);

  // concentric circles across each band, lying in the plane perpendicular to the spin axis
  const SEG = 96;
  const out = [];
  for (const [inner, outer] of RING_BANDS) {
    const n = Math.max(1, Math.round((outer - inner) / RING_STEP));
    for (let i = 0; i <= n; i++) {
      const r = inner + ((outer - inner) * i) / n;
      for (let k = 0; k < SEG; k++) {
        const a0 = (k / SEG) * Math.PI * 2;
        const a1 = ((k + 1) / SEG) * Math.PI * 2;
        out.push(r * Math.cos(a0), r * Math.sin(a0), 0, r * Math.cos(a1), r * Math.sin(a1), 0);
      }
    }
  }
  const rings = kit.lines(new Float32Array(out), kit.accent(0xffd68a, color));
  rings.quaternion.setFromUnitVectors(Z_AXIS, spinAxis.clone().normalize()); // ring normal = spin axis
  return { core, decorations: rings };
}

// ---- black hole -------------------------------------------------------------

const DISK_INNER = 1.45;   // accretion disk, in units of the horizon radius
const DISK_OUTER = 4.2;

const DISK_VERTEX = /* glsl */`
  varying vec3 vLocal;
  varying vec3 vWorld;
  void main() {
    vLocal = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

// Brightest at the inner edge, banded gas sliding round faster the closer it is, and relativistic
// beaming (D^3) so the side moving toward the camera is far brighter than the side moving away. The
// bright side follows the camera as you orbit. Light styles add heat-coloured light; ink styles draw
// the same intensity as ink density, which the 1-bit dither turns into stipple.
const DISK_FRAGMENT = /* glsl */`
  uniform float uTime;
  uniform vec3 uCenter;
  uniform vec3 uAxis;
  uniform vec3 uColor;
  uniform float uAdditive;
  uniform float uInner;
  uniform float uOuter;
  varying vec3 vLocal;
  varying vec3 vWorld;
  void main() {
    float r = length(vLocal.xy);
    float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
    float ang = atan(vLocal.y, vLocal.x);
    float kepler = pow(uInner / max(r, 1e-3), 1.5);
    float swirl = 0.5 + 0.5 * sin(3.0 * ang - uTime * 2.4 * kepler + r * 4.0);
    float fine = 0.5 + 0.5 * sin(11.0 * ang - uTime * 3.1 * kepler - r * 9.0);
    float radial = pow(1.0 - t, 1.7);
    float edge = smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.8, 1.0, t));

    vec3 out_ = vWorld - uCenter;
    out_ -= uAxis * dot(out_, uAxis);
    vec3 gas = cross(uAxis, normalize(out_));
    vec3 toCam = normalize(cameraPosition - vWorld);
    float beta = clamp(0.58 * sqrt(uInner / max(r, 1e-3)), 0.0, 0.9);
    float D = sqrt(1.0 - beta * beta) / (1.0 - beta * dot(gas, toCam));
    float I = radial * (0.6 + 0.3 * swirl + 0.1 * fine) * edge * D * D * D;

    if (uAdditive > 0.5) {
      vec3 hot = mix(vec3(1.0, 0.97, 0.88), uColor, smoothstep(0.0, 0.8, t));
      gl_FragColor = vec4(hot, clamp(I * 0.5, 0.0, 1.0));
    } else {
      gl_FragColor = vec4(uColor, clamp(I * 0.9, 0.0, 1.0));
    }
  }`;

function blackHole({ kit, tracker, color, spinAxis }) {
  // the event horizon: a black ball, or white where the page is shown in inverse video
  const sphere = kit.geometry('shape:100', () => buildShapeGeometry(100));
  const core = kit.outlined(sphere, color, kit.theme.inverse ? kit.theme.background : 0x000000);

  const axis = spinAxis.clone().normalize();
  const uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uAxis: { value: axis },
    uColor: { value: new THREE.Color(color) },
    uAdditive: { value: kit.additive ? 1 : 0 },
    uInner: { value: DISK_INNER },
    uOuter: { value: DISK_OUTER },
  };
  const disk = new THREE.Mesh(
    tracker.own(new THREE.RingGeometry(DISK_INNER, DISK_OUTER, 160, 8)),
    tracker.own(new THREE.ShaderMaterial({
      uniforms,
      vertexShader: DISK_VERTEX,
      fragmentShader: DISK_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: kit.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    })),
  );
  disk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis); // ring normal = spin axis
  const decorations = new THREE.Group();
  decorations.add(disk);

  return {
    core,
    decorations,
    update(dt, ctx) {
      uniforms.uTime.value += dt;
      uniforms.uCenter.value.copy(ctx.body.pos);
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
    build(ctx) {
      return { core: roundCore(ctx) };
    },
  },

  blackhole: {
    id: 'blackhole',
    label: 'Black hole',
    tip: 'A black event horizon with a glowing accretion disk, bending the background behind it',
    usesDetail: false,
    build: blackHole,
  },

  neutron: {
    id: 'neutron',
    label: 'Neutron star',
    tip: 'A small hot star with a tilted magnetic field and two pulsar beams that sweep round as it spins',
    usesDetail: true,
    build: neutronStar,
  },

  comet: {
    id: 'comet',
    label: 'Comet',
    tip: 'A lumpy nucleus trailing a straight ion tail and a curved dust tail, both pointing away from the heaviest body',
    usesDetail: true,
    noDice: true,            // lumpy, so no flat faces to number
    build: comet,
  },

  ringed: {
    id: 'ringed',
    label: 'Ringed planet',
    tip: 'A round planet with a ring system lying in its equatorial plane, tilted with its spin axis',
    usesDetail: true,
    build: ringedPlanet,
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
    // parts of the decorations that are not drawn while the camera stands on this body (things that
    // start at its centre: tails, beams, field lines)
    rideHidden: built.rideHidden || [],
    spinScale: built.spinScale ?? 1,   // how fast this look turns, as a multiple of the body's own spin rate
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
