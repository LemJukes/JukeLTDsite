// io.js — export / import of simulation setups as a small, safe JSON text format.
//
// An exported setup is the *starting* configuration (the state RESET returns to)
// plus the global parameters, written as indented JSON so it opens cleanly in any
// text editor.
//
// SECURITY — importing means parsing a file the user supplies, so every byte is
// treated as hostile. The rules followed throughout this module:
//   * Parse with JSON.parse only. Never eval / new Function / innerHTML, so an
//     imported file can carry no executable code.
//   * Never spread, merge or iterate the parsed object. We read a fixed whitelist
//     of keys *by name*, so any extra keys — including "__proto__" / "constructor"
//     — are simply ignored. (JSON.parse also assigns "__proto__" as a plain own
//     property rather than touching the prototype chain, so there is no
//     prototype-pollution vector here either.)
//   * Coerce every value to the type we expect; reject NaN / Infinity and clamp
//     numbers to the same ranges the on-screen sliders allow, so an import can
//     never push the simulation or the UI into an invalid state.
//   * Cap the input size and require exactly three bodies.
// The output is a plain, normalised config object that holds only numbers and
// short sanitised strings — nothing that can be executed or injected.

import { COLORS } from './presets.js';

export const SETUP_FORMAT = '3bsim';
export const SETUP_VERSION = 1;

const BODY_COUNT = 3;
const MAX_BYTES = 64 * 1024; // generous for 3 bodies; rejects pathological input

// Inclusive numeric ranges, matched to the UI sliders so every imported value
// stays representable by the editor (and so all built-in presets round-trip
// losslessly — they already live inside these bounds).
const RANGES = {
  G: [0, 4],
  softening: [0.01, 3],
  speed: [0.05, 4],
  substeps: [1, 16],
  trailLength: [0, 2000],
  mass: [0.1, 12],
  radius: [0.4, 6],
  pos: [-40, 40],
  vel: [-1.5, 1.5],
};

/** A validation failure carrying a short, user-facing message. */
export class SetupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SetupError';
  }
}

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

// Coerce to a finite number then clamp into range; fall back when not a real
// number (rejects NaN, Infinity, null, strings that don't parse, etc.).
function num(value, range, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, range);
}

// Trim floating-point noise for readable exports without losing real precision
// (8 decimals preserves e.g. the figure-eight's 0.97000436 initial conditions).
const tidy = (v) => Math.round(v * 1e8) / 1e8;

function colorToHex(c) {
  const n = typeof c === 'number' && Number.isFinite(c) ? c & 0xffffff : 0;
  return '#' + n.toString(16).padStart(6, '0');
}

// Accept "#rrggbb", "rrggbb" or a plain integer; anything else -> fallback.
function parseColor(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clamp(Math.floor(value), [0, 0xffffff]);
  }
  if (typeof value === 'string') {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
    if (m) return parseInt(m[1], 16);
  }
  return fallback;
}

// Names are decorative. Keep only printable ASCII (and never angle brackets, so
// the value is safe even if some future code path renders it as HTML), cap the
// length, and fall back to the default label when nothing usable remains.
function parseName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[^\x20-\x7E]/g, '').replace(/[<>]/g, '').trim().slice(0, 24);
  return cleaned || fallback;
}

function readTriple(value, range) {
  const a = Array.isArray(value) ? value : [];
  return { x: num(a[0], range, 0), y: num(a[1], range, 0), z: num(a[2], range, 0) };
}

/**
 * Serialize the app's current starting configuration to JSON setup text.
 * Reads `app._initial` (the snapshot RESET restores) so the export is the
 * reproducible setup rather than any mid-flight evolved state.
 * @param {object} app
 * @returns {string}
 */
export function serializeSetup(app) {
  const snap = Array.isArray(app._initial) && app._initial.length === BODY_COUNT
    ? app._initial
    : app.system.bodies;

  const bodies = snap.map((b) => ({
    name: b.name,
    mass: tidy(b.mass),
    radius: tidy(b.radius),
    color: colorToHex(b.color),
    pos: [tidy(b.pos.x), tidy(b.pos.y), tidy(b.pos.z)],
    vel: [tidy(b.vel.x), tidy(b.vel.y), tidy(b.vel.z)],
  }));

  const setup = {
    format: SETUP_FORMAT,
    version: SETUP_VERSION,
    G: tidy(app.state.G),
    softening: tidy(app.state.softening),
    speed: tidy(app.state.speed),
    substeps: app.state.substeps,
    trailLength: app.state.trailLength,
    bodies,
  };

  return JSON.stringify(setup, null, 2) + '\n';
}

/**
 * Parse and validate setup text into a normalised config object.
 * Throws {@link SetupError} with a friendly message on anything malformed.
 * Missing optional fields fall back to sensible defaults; only `bodies` (exactly
 * three) is required.
 * @param {string} text
 * @returns {{G:number, softening:number, speed:number, substeps:number,
 *            trailLength:number, bodies:Array<object>}}
 */
export function parseSetup(text) {
  if (typeof text !== 'string') throw new SetupError('That does not look like a text file.');
  if (text.length === 0) throw new SetupError('The file is empty.');
  if (text.length > MAX_BYTES) throw new SetupError('That file is too large to be a setup.');

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SetupError('Not valid setup text (expected JSON).');
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SetupError('A setup must be a JSON object.');
  }
  if (raw.format !== undefined && raw.format !== SETUP_FORMAT) {
    throw new SetupError('Unrecognised file — not a three-body setup.');
  }

  const bodiesIn = raw.bodies;
  if (!Array.isArray(bodiesIn) || bodiesIn.length !== BODY_COUNT) {
    throw new SetupError(`A setup needs exactly ${BODY_COUNT} bodies.`);
  }

  const bodies = bodiesIn.map((b, i) => {
    const o = b && typeof b === 'object' && !Array.isArray(b) ? b : {};
    return {
      name: parseName(o.name, `Body ${'ABC'[i]}`),
      mass: num(o.mass, RANGES.mass, 1),
      radius: num(o.radius, RANGES.radius, 1.4),
      color: parseColor(o.color, COLORS[i]),
      pos: readTriple(o.pos, RANGES.pos),
      vel: readTriple(o.vel, RANGES.vel),
    };
  });

  return {
    G: num(raw.G, RANGES.G, 1),
    softening: num(raw.softening, RANGES.softening, 0.4),
    speed: num(raw.speed, RANGES.speed, 1),
    substeps: Math.round(num(raw.substeps, RANGES.substeps, 5)),
    trailLength: Math.round(num(raw.trailLength, RANGES.trailLength, 700)),
    bodies,
  };
}
