// pencil.js — graphite pencil strokes for the Lab Notebook style.
//
// WebGL ignores `linewidth` on plain lines, so strokes that need a real width are drawn with the
// instanced `Line2` family from three/addons (screen-space quads). On top of that a pencil drawing is
// made to look drawn by hand:
//   * each segment's ends are nudged and overshoot a little, by a seeded random, so it is the same on
//     every frame and every load (never re-rolled, so nothing crawls),
//   * the segments are dealt into three pressures (widths), as a hand never presses evenly.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { mulberry32 } from './noise.js';

export const PENCIL_WIDTHS = [1.2, 1.7, 2.2];   // CSS pixels: light, medium, heavy pressure

/** A pencil line material; `width` is in CSS pixels (see bindPencil for the conversion to buffer pixels). */
export function pencilMaterial({ color, width = 1.5, ...rest }) {
  const material = new LineMaterial({ color, linewidth: width, worldUnits: false, ...rest });
  material.userData.width = width;
  return material;
}

/**
 * Keep a Line2 object's material in step with the render target each time it is drawn: the resolution
 * its quads are computed against, and the width scaled by the pixel ratio so a stroke is the same size
 * on a retina screen as on a plain one.
 */
export function bindPencil(object, material) {
  const size = new THREE.Vector2();
  object.onBeforeRender = (renderer) => {
    const target = renderer.getRenderTarget();
    if (target) size.set(target.width, target.height);
    else renderer.getDrawingBufferSize(size);
    material.resolution.copy(size);
    material.linewidth = material.userData.width * renderer.getPixelRatio();
  };
}

/**
 * Wobble a flat list of xyz segment endpoints: each end moves by up to `amp` and each segment runs
 * `overshoot` (a fraction of its length) past both ends, like pencil strokes that do not stop exactly.
 */
export function jitterSegments(positions, seed, amp, overshoot = 0.03) {
  const out = new Float32Array(positions.length);
  const rand = mulberry32(seed);
  for (let i = 0; i + 5 < positions.length; i += 6) {
    for (let c = 0; c < 3; c++) {
      const a = positions[i + c];
      const b = positions[i + 3 + c];
      const d = b - a;
      out[i + c] = a - overshoot * d + (rand() - 0.5) * 2 * amp;
      out[i + 3 + c] = b + overshoot * d + (rand() - 0.5) * 2 * amp;
    }
  }
  return out;
}

/** One Line2 mesh of a segment list at a single `width` (no wobble): for things that are redrawn or faded. */
export function pencilMesh(positions, color, width, opts = {}) {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  const material = pencilMaterial({ color, width, ...opts });
  const mesh = new LineSegments2(geometry, material);
  bindPencil(mesh, material);
  return { mesh, geometry, material };
}

/**
 * A pencil drawing of a segment list. Returns { object, own }: `object` is a Group of Line2 meshes
 * (one per pressure), `own` is every geometry and material to dispose with it.
 */
export function pencilStrokes(positions, color, { seed = 1, amp = 0.012, widths = PENCIL_WIDTHS } = {}) {
  let drawn = amp > 0 ? jitterSegments(positions, seed, amp) : positions;
  if (drawn !== positions) {
    // the wobble must not push a drawing outside the sphere the original fitted in (a look's core is
    // normalised to radius 1): scale it back if the farthest point moved out
    const farthest = (a) => { let m = 0; for (let i = 0; i + 2 < a.length; i += 3) m = Math.max(m, a[i] * a[i] + a[i + 1] * a[i + 1] + a[i + 2] * a[i + 2]); return Math.sqrt(m); };
    const before = farthest(positions);
    const after = farthest(drawn);
    if (after > before && after > 0) drawn = drawn.map((x) => (x * before) / after);
  }
  const rand = mulberry32(seed * 31 + 7);
  const buckets = widths.map(() => []);
  for (let i = 0; i + 5 < drawn.length; i += 6) {
    const b = buckets[Math.floor(rand() * widths.length)];
    for (let k = 0; k < 6; k++) b.push(drawn[i + k]);
  }
  const object = new THREE.Group();
  const own = [];
  widths.forEach((width, b) => {
    if (!buckets[b].length) return;
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(buckets[b]);
    const material = pencilMaterial({ color, width });
    const mesh = new LineSegments2(geometry, material);
    bindPencil(mesh, material);
    object.add(mesh);
    own.push(geometry, material);
  });
  return { object, own };
}
