// shapes.js — the Shape slider's fixed stops, their geometry, and dice numbering.
//
// Every shape is built with circumradius 1 (all vertices on the unit sphere), so the scene can scale it
// by the body's physics radius and it never pokes out of that sphere.
//
//   0-50    the dice solids, drawn as true polyhedron edges (no triangle diagonals across the faces)
//   60-90   geodesic spheres (an icosahedron with each edge split into detail+1); 60 is the original body
//   100     a smooth, high-detail sphere
//   80-100  drawn as an outline plus a few contour lines, not a wireframe (see bodyLooks.js)

import * as THREE from 'three';
import { textSegments } from './numerals.js';

export const SHAPE_STOPS = [
  { value: 0, id: 'tetra', label: 'Tetrahedron', short: 'Tetrahedron', die: 'd4', faces: '4 faces' },
  { value: 10, id: 'cube', label: 'Cube', short: 'Cube', die: 'd6', faces: '6 faces' },
  { value: 20, id: 'octa', label: 'Octahedron', short: 'Octahedron', die: 'd8', faces: '8 faces' },
  { value: 30, id: 'trapezohedron', label: 'Pentagonal trapezohedron', short: 'Trapezohedron', die: 'd10', faces: '10 faces' },
  { value: 40, id: 'dodeca', label: 'Dodecahedron', short: 'Dodecahedron', die: 'd12', faces: '12 faces' },
  { value: 50, id: 'icosa', label: 'Icosahedron', short: 'Icosahedron', die: 'd20', faces: '20 faces' },
  { value: 60, id: 'geo1', label: 'Geodesic, detail 1', short: 'Geodesic 1', die: null, faces: '80 faces', detail: 1 },
  { value: 70, id: 'geo2', label: 'Geodesic, detail 2', short: 'Geodesic 2', die: null, faces: '180 faces', detail: 2 },
  { value: 80, id: 'geo4', label: 'Geodesic, detail 4', short: 'Geodesic 4', die: null, faces: '500 faces', detail: 4 },
  { value: 90, id: 'geo8', label: 'Geodesic, detail 8', short: 'Geodesic 8', die: null, faces: '1620 faces', detail: 8 },
  { value: 100, id: 'smooth', label: 'Smooth sphere', short: 'Smooth', die: null, faces: 'high-detail sphere', detail: 16 },
];

export const SHAPE_DEFAULT = 60;   // geodesic, detail 1: the body as it has always looked
export const DICE_MAX = 50;        // dice numerals only make sense on the flat-faced stops
export const HULL_FROM = 80;       // from here a wireframe is a solid mass of lines: outline instead

/** The stop for a slider value (snapped to the nearest). */
export function stopFor(value) {
  return SHAPE_STOPS[Math.min(SHAPE_STOPS.length - 1, Math.max(0, Math.round(value / 10)))];
}

// Pentagonal trapezohedron (the d10): two apexes on the polar axis and two staggered rings of five. The
// ten kite faces are planar when the rings sit at z = tan^2(18deg) of the apex height, and every
// vertex then lies on the unit sphere.
function trapezohedron() {
  const z0 = Math.tan(Math.PI / 10) ** 2;
  const rho = Math.sqrt(1 - z0 * z0);
  const ring = (k, z, phase) => {
    const a = (k * 2 * Math.PI) / 5 + phase;
    return new THREE.Vector3(rho * Math.cos(a), rho * Math.sin(a), z);
  };
  const top = new THREE.Vector3(0, 0, 1);
  const bottom = new THREE.Vector3(0, 0, -1);
  const U = [0, 1, 2, 3, 4].map((k) => ring(k, z0, 0));
  const L = [0, 1, 2, 3, 4].map((k) => ring(k, -z0, Math.PI / 5));

  const pts = [];
  const tri = (a, b, c) => { // wound so the face points outward
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const out = n.dot(a.clone().add(b).add(c)) >= 0;
    pts.push(a, out ? b : c, out ? c : b);
  };
  const kite = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
  for (let k = 0; k < 5; k++) {
    const n = (k + 1) % 5;
    kite(top, U[k], L[k], U[n]);
    kite(bottom, L[k], U[n], L[n]);
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(pts);
  geometry.computeVertexNormals();
  return geometry;
}

/** Unit-circumradius geometry for a slider value. */
export function buildShapeGeometry(value) {
  const stop = stopFor(value);
  switch (stop.id) {
    case 'tetra': return new THREE.TetrahedronGeometry(1, 0);
    case 'cube': { const s = 2 / Math.sqrt(3); return new THREE.BoxGeometry(s, s, s); }
    case 'octa': return new THREE.OctahedronGeometry(1, 0);
    case 'trapezohedron': return trapezohedron();
    case 'dodeca': return new THREE.DodecahedronGeometry(1, 0);
    case 'icosa': return new THREE.IcosahedronGeometry(1, 0);
    default: return new THREE.IcosahedronGeometry(1, stop.detail);
  }
}

// ---- dice -------------------------------------------------------------------

const EPS = 1e-4;
const LIFT = 0.006; // numerals float this far (in unit radii) above their face

// Ordering used to pick numbers and orientations deterministically: z first, then y, then x.
// Negative when `a` ranks above `b`.
const higher = (a, b) => (Math.abs(a.z - b.z) > EPS ? b.z - a.z : Math.abs(a.y - b.y) > EPS ? b.y - a.y : b.x - a.x);

// The planar faces of a convex solid centred on the origin: triangles are grouped by plane, and each
// face gets its corners in order around it, its centre, and its inradius.
function facesOf(geometry) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const count = idx ? idx.count : pos.count;
  const at = (i) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i);
  const faces = [];
  for (let t = 0; t < count; t += 3) {
    const a = at(t), b = at(t + 1), c = at(t + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    let d = n.dot(a);
    if (d < 0) { n.negate(); d = -d; }
    let f = faces.find((g) => g.n.dot(n) > 1 - EPS && Math.abs(g.d - d) < EPS);
    if (!f) { f = { n, d, pts: [] }; faces.push(f); }
    for (const p of [a, b, c]) if (!f.pts.some((q) => q.distanceToSquared(p) < 1e-8)) f.pts.push(p);
  }
  for (const f of faces) {
    f.c = f.pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(f.pts.length);
    const e1 = f.pts[0].clone().sub(f.c).normalize();
    const e2 = new THREE.Vector3().crossVectors(f.n, e1);
    const angle = (p) => { const r = p.clone().sub(f.c); return Math.atan2(r.dot(e2), r.dot(e1)); };
    f.verts = f.pts.slice().sort((p, q) => angle(p) - angle(q));
    f.inradius = Infinity;
    for (let i = 0; i < f.verts.length; i++) {
      const p = f.verts[i], q = f.verts[(i + 1) % f.verts.length];
      const edge = q.clone().sub(p).normalize();
      const rel = f.c.clone().sub(p);
      f.inradius = Math.min(f.inradius, rel.addScaledVector(edge, -rel.dot(edge)).length());
    }
  }
  return faces;
}

// Which way a numeral's top points on a face: toward a corner on triangles and pentagons (as on real
// d12s and d20s), toward an edge on a square, toward the apex on a kite.
function faceUp(f) {
  const vs = f.verts;
  let target;
  if (vs.length === 4) {
    const len = (i) => vs[i].distanceTo(vs[(i + 1) % 4]);
    if (Math.abs(len(0) - len(1)) < 1e-3 && Math.abs(len(1) - len(2)) < 1e-3) {
      target = vs.map((p, i) => p.clone().add(vs[(i + 1) % 4]).multiplyScalar(0.5)).sort(higher)[0];
    } else {
      target = vs.reduce((a, b) => (Math.abs(b.z) > Math.abs(a.z) ? b : a));
    }
  } else {
    target = vs.slice().sort(higher)[0];
  }
  return target.clone().sub(f.c).normalize();
}

/**
 * Where each numeral of a die goes: [{ text, origin, up, normal, height }], or null when the stop is
 * not a die.
 *   opposite faces sum to n+1 on the d6, d8, d12 and d20, and to 9 on the d10 (numbered 0-9);
 *   the d4 is read at the vertices: each corner's number sits near that corner on all three faces
 *   that meet there, upright when that corner points up.
 */
export function diceItems(value, geometry) {
  const stop = stopFor(value);
  if (!stop.die) return null;
  const faces = facesOf(geometry);
  const items = [];

  if (stop.die === 'd4') {
    const verts = [];
    for (const f of faces) for (const p of f.verts) if (!verts.some((q) => q.distanceToSquared(p) < 1e-8)) verts.push(p);
    verts.sort(higher);
    for (const f of faces) {
      for (const p of f.verts) {
        const num = verts.findIndex((q) => q.distanceToSquared(p) < 1e-8) + 1;
        items.push({
          text: String(num),
          origin: f.c.clone().addScaledVector(p.clone().sub(f.c), 0.62),
          up: p.clone().sub(f.c).normalize(),
          normal: f.n,
          height: f.inradius * 0.5,
        });
      }
    }
  } else {
    const used = new Set();
    const pairs = [];
    for (const f of faces) {
      if (used.has(f)) continue;
      const g = faces.find((h) => h !== f && h.n.dot(f.n) < -1 + EPS);
      used.add(f); used.add(g);
      pairs.push(higher(f.n, g.n) <= 0 ? [f, g] : [g, f]);
    }
    pairs.sort((a, b) => higher(a[0].n, b[0].n));
    const d10 = stop.die === 'd10';
    const first = d10 ? 0 : 1;
    const sum = d10 ? 9 : faces.length + 1;
    pairs.forEach(([a, b], p) => {
      for (const [f, num] of [[a, first + p], [b, sum - (first + p)]]) {
        items.push({ text: String(num), origin: f.c, up: faceUp(f), normal: f.n, height: f.inradius * 0.9 });
      }
    });
  }
  return items;
}

/**
 * The numerals of a die as line segments in the solid's own coordinates (a flat xyz list for
 * LineSegments), or null when the stop is not a die.
 */
export function diceSegments(value, geometry) {
  const items = diceItems(value, geometry);
  if (!items) return null;
  const die = stopFor(value).die;
  const underline = die === 'd10' || die === 'd12' || die === 'd20'; // dice with both a 6 and a 9
  const out = [];
  const right = new THREE.Vector3();
  const put = (item, x, y) => {
    right.crossVectors(item.up, item.normal); // right x up = outward normal, so it reads correctly from outside
    out.push(
      item.origin.x + right.x * x * item.height + item.up.x * y * item.height + item.normal.x * LIFT,
      item.origin.y + right.y * x * item.height + item.up.y * y * item.height + item.normal.y * LIFT,
      item.origin.z + right.z * x * item.height + item.up.z * y * item.height + item.normal.z * LIFT,
    );
  };
  for (const item of items) {
    const seg = textSegments(item.text, underline);
    for (let i = 0; i < seg.length; i += 2) put(item, seg[i], seg[i + 1]);
  }
  return new Float32Array(out);
}
