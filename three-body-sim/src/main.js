// main.js — bootstrap, the controller (`app`) the UI talks to, and the loop.
//
// Physics runs on a fixed-step accumulator that is decoupled from the render
// rate: "speed" sets how much simulation time passes per real second, while
// "quality" sets the integration step size (smaller = more accurate). Trails are
// sampled at a fixed simulation-time cadence so they look the same at any speed
// or frame rate.

import * as THREE from 'three';
import { NBodySystem } from './physics.js';
import { SimScene } from './scene.js';
import { createUI } from './ui.js';
import { presets } from './presets.js';
import { serializeSetup, parseSetup } from './io.js';
import { themeOrder, initialTheme, resolveTheme, saveTheme, applyPixelUnit } from './themes.js';

const BASE_DT = 0.05;       // step size at quality = 1
const TIME_SCALE = 15;      // simulation-seconds per real second at speed = 1
const TRAIL_SAMPLE = 0.12;  // simulation-time between trail samples
const MAX_STEPS_PER_FRAME = 2000; // guard against the spiral of death
const WHITE = new THREE.Color(0xffffff);

const container = document.getElementById('scene');
const startTheme = initialTheme();
const scene = new SimScene(container, startTheme.scene);
const system = new NBodySystem({ G: 1, softening: 0.4 });

function cloneCfg(c) {
  return { name: c.name, mass: c.mass, radius: c.radius, color: c.color, pos: c.pos.clone(), vel: c.vel.clone() };
}

const app = {
  scene,
  system,
  options: scene.options,
  state: { running: false, speed: 1, substeps: 5, G: 1, softening: 0.4, trailLength: 700, presetId: 'default', collisionMode: 'off', restitution: 0.5, theme: startTheme.id, camera: { focus: 'free', view: 'orbit' } },
  // seeded from the default preset; the UI edits these in place
  custom: { bodies: presets.default.build().bodies.map(cloneCfg) },

  _initial: [],
  _accum: 0,
  _lastTrail: 0,
  _lastImpact: null,
  selectedIndex: -1,

  // ---- loading / resetting ----
  // Selecting a configuration loads it paused; only the initial boot autoplays.
  loadPreset(id, { autoplay = false } = {}) {
    const cfg = presets[id].build();
    this.setG(cfg.G ?? this.state.G);
    this.setSoftening(cfg.softening ?? this.state.softening);
    system.setBodies(cfg.bodies);
    scene.buildBodies(system);
    scene.clearTrails();
    this._initial = system.snapshot();
    this._lastImpact = null;
    this.state.presetId = id;
    this._resetClocks();
    this.state.running = autoplay;
    scene.autoFrame(system, cfg.cameraDistance);
    this.deselect();
    ui.setActivePreset(id);
    ui.syncParams();
  },

  random() {
    this.loadPreset('random');
  },

  // ---- export / import ----
  // Serialize the current starting configuration to setup text (see io.js).
  exportSetup() {
    return serializeSetup(this);
  },

  // Validate setup text (throws SetupError on bad input) and load it as a paused
  // custom configuration, exactly like a hand-built setup so RESET returns to it.
  importSetup(text) {
    const cfg = parseSetup(text);
    const bodies = cfg.bodies.map((b) => ({
      name: b.name, mass: b.mass, radius: b.radius, color: b.color,
      pos: new THREE.Vector3(b.pos.x, b.pos.y, b.pos.z),
      vel: new THREE.Vector3(b.vel.x, b.vel.y, b.vel.z),
    }));

    this.setG(cfg.G);
    this.setSoftening(cfg.softening);
    this.setSpeed(cfg.speed);
    this.setSubsteps(cfg.substeps);
    this.setTrailLength(cfg.trailLength);
    this.setCollisionMode(cfg.collisionMode);
    this.setRestitution(cfg.restitution);

    this.custom.bodies = bodies.map(cloneCfg);
    // literal setup — no momentum zeroing / recentre — so positions are exactly
    // as entered, matching the custom editor.
    system.setBodies(bodies, { normalize: false });
    scene.buildBodies(system);
    scene.clearTrails();
    this._initial = system.snapshot();
    this._lastImpact = null;
    this.state.presetId = 'custom';
    this._resetClocks();
    this.state.running = false;
    scene.autoFrame(system);
    this.deselect();
    ui.setActivePreset('custom');
    ui.syncParams();
  },

  // ---- body selection / editing ----
  // Clicking a body (or pressing CUSTOM) pauses and opens a single-body editor.
  // Editing rewrites that body's starting state in place, so RESET returns to
  // the edited configuration.
  selectBody(i) {
    if (i < 0 || i >= system.bodies.length) return this.deselect();
    this.state.running = false; // a single body can only be edited meaningfully when paused
    this._seedCustomFromCurrent();
    this.selectedIndex = i;
    this.state.presetId = 'custom';
    scene.setSelected(i);
    ui.setActivePreset('custom');
    ui.showBodyEditor(i, this.custom.bodies[i]);
  },

  deselect() {
    this.selectedIndex = -1;
    scene.setSelected(-1);
    ui.hideBodyEditor();
  },

  enterCustom() {
    this.selectBody(0);
  },

  _seedCustomFromCurrent() {
    this.custom.bodies = system.bodies.map((b) => ({
      name: b.name, mass: b.mass, radius: b.radius, color: b.color, pos: b.pos.clone(), vel: b.vel.clone(),
    }));
  },

  editCustom(i, key, v) {
    const c = this.custom.bodies[i];
    if (key === 'mass') c.mass = v;
    else if (key === 'radius') c.radius = v;
    else if (key === 'px') c.pos.x = v;
    else if (key === 'py') c.pos.y = v;
    else if (key === 'pz') c.pos.z = v;
    else if (key === 'vx') c.vel.x = v;
    else if (key === 'vy') c.vel.y = v;
    else if (key === 'vz') c.vel.z = v;
    this._applyCustomInPlace();
  },

  // Apply the editable config onto the existing bodies without rebuilding the
  // meshes (body count never changes), so selection and editing stay smooth.
  // Literal setup — no momentum zeroing / recentre — so sliders mean what they say.
  _applyCustomInPlace() {
    for (let i = 0; i < system.bodies.length; i++) {
      const b = system.bodies[i];
      const c = this.custom.bodies[i];
      b.mass = c.mass; b.radius = c.radius;
      b.pos.copy(c.pos); b.vel.copy(c.vel);
      b.ejected = false;
    }
    system.time = 0;
    system.computeAccelerations();
    system.initialEnergy = system.totalEnergy();
    this._initial = system.snapshot();
    scene.clearTrails();
    scene.clearEffects();
    this._lastImpact = null;
    this._resetClocks();
    this.state.running = false;
  },

  reset() {
    system.restore(this._initial);
    scene.clearTrails();
    scene.clearEffects();
    this._lastImpact = null;
    this._resetClocks();
    this.state.running = false;
  },

  _resetClocks() {
    this._accum = 0;
    this._lastTrail = system.time;
  },

  // ---- transport ----
  toggle() { this.state.running = !this.state.running; },
  step() {
    const dt = BASE_DT / this.state.substeps;
    const steps = Math.max(1, Math.round((BASE_DT * this.state.speed) / dt));
    for (let i = 0; i < steps; i++) this._advance(dt);
    scene.recordTrails(system);
  },

  // ---- parameters ----
  setSpeed(v) { this.state.speed = v; },
  setSubsteps(v) { this.state.substeps = Math.max(1, Math.round(v)); },
  setG(v) { this.state.G = v; system.G = v; system.initialEnergy = system.totalEnergy(); },
  setSoftening(v) { this.state.softening = v; system.softening = v; system.initialEnergy = system.totalEnergy(); },
  setTrailLength(v) { this.state.trailLength = v; scene.setTrailLength(v); },
  setCollisionMode(m) { this.state.collisionMode = m; system.collisionMode = m; ui.setCollisionMode(m); },
  setRestitution(v) { this.state.restitution = v; system.restitution = v; },
  cycleCollisionMode() {
    const order = ['off', 'merge', 'bounce'];
    const i = order.indexOf(this.state.collisionMode);
    this.setCollisionMode(order[(i + 1) % order.length]);
  },

  // Turn an impact event from the physics into a burst + a UI report entry. The
  // blast colour blends the two bodies, shifting white-hot as severity climbs.
  _onCollision(ev) {
    const col = new THREE.Color(ev.aColor).lerp(new THREE.Color(ev.bColor), 0.5);
    if (ev.severity >= 1) col.lerp(WHITE, Math.min(0.8, 0.2 + ev.severity / 20));
    scene.spawnImpact(ev.point, { severity: ev.severity, color: col });
    this._lastImpact = ev;
  },

  // ---- UI style ----
  // Switches the CSS skin (via html[data-theme]) and the 3D scene's look
  // together. Display-only: nothing here touches the simulation state.
  setTheme(id, { persist = true } = {}) {
    const theme = resolveTheme(id);
    this.state.theme = theme.id;
    document.documentElement.dataset.theme = theme.id;
    scene.setTheme(theme.scene);
    ui.setTheme(theme.id);
    if (persist) saveTheme(theme.id);
  },
  cycleTheme() {
    const i = themeOrder.indexOf(this.state.theme);
    this.setTheme(themeOrder[(i + 1) % themeOrder.length]);
  },

  setOption(name, val) {
    scene.options[name] = val;
  },
  toggleOption(name) {
    this.setOption(name, !scene.options[name]);
    ui.syncToggles();
  },
  frameAll() {
    // framing the whole system is an outside view: step off a body's surface first
    const { focus, view } = this.state.camera;
    if (view === 'surface') this.setCamera(focus, 'orbit');
    scene.autoFrame(system);
  },

  // ---- camera focus ----
  // focus: 'free' | 'com' | body index; view: 'orbit' | 'surface' (bodies only).
  // See SimScene.setCamera in scene.js for exactly what each combination does.
  setCamera(focus, view = 'orbit') {
    if (Number.isInteger(focus)) {
      const b = system.bodies[focus];
      if (!b || b.ejected) return; // nothing there to look at
    } else {
      view = 'orbit';
    }
    this.state.camera = { focus, view };
    scene.setCamera(focus, view);
    ui.setCamera(this.state.camera);
  },
  // choosing a new focus keeps a surface view if you were already standing on a body
  setCameraFocus(focus) {
    const keepSurface = Number.isInteger(focus) && this.state.camera.view === 'surface';
    this.setCamera(focus, keepSurface ? 'surface' : 'orbit');
  },
  setCameraView(view) {
    const { focus } = this.state.camera;
    if (Number.isInteger(focus)) this.setCamera(focus, view);
  },
  // P: ride the focused body, or the selected / first body when nothing is focused
  toggleSurface() {
    const { focus, view } = this.state.camera;
    if (Number.isInteger(focus)) return this.setCamera(focus, view === 'surface' ? 'orbit' : 'surface');
    this.setCamera(this.selectedIndex >= 0 ? this.selectedIndex : 0, 'surface');
  },
  newSurfaceSpot() {
    if (this.state.camera.view === 'surface') scene.newSurfaceSpot();
  },

  _advance(dt) {
    system.step(dt);
    if (system.time - this._lastTrail >= TRAIL_SAMPLE) {
      scene.recordTrails(system);
      this._lastTrail = system.time;
    }
  },

  // ---- telemetry for the UI ----
  getReadouts() {
    return {
      running: this.state.running,
      fps: this._fps,
      time: system.time,
      ke: system.kineticEnergy(),
      pe: system.potentialEnergy(),
      energy: system.totalEnergy(),
      drift: system.energyDrift(),
      minSep: system.minSeparation(),
      speeds: system.bodies.map((b) => b.vel.length()),
      ejected: system.bodies.map((b) => b.ejected),
      collisionMode: this.state.collisionMode,
      lastImpact: this._lastImpact,
    };
  },

  _fps: 0,
};

const ui = createUI(app);

// Route physics impacts to the controller, and seed the system with the current
// collision settings (these persist across preset loads — setBodies leaves them).
system.onCollision = (ev) => app._onCollision(ev);
// the scene drops the camera back to the centre of mass if the body it follows is merged away
scene.onCameraChange = (cam) => { app.state.camera = { ...cam }; ui.setCamera(app.state.camera); };
system.collisionMode = app.state.collisionMode;
system.restitution = app.state.restitution;

// ---- click-to-select bodies (distinguish a click from an orbit drag) ----
{
  const dom = scene.renderer.domElement;
  let downX = 0, downY = 0, downT = 0;
  dom.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    downX = e.clientX; downY = e.clientY; downT = performance.now();
  });
  dom.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (moved > 5 || performance.now() - downT > 400) return; // it was a drag
    const rect = dom.getBoundingClientRect();
    const idx = scene.pickBody(e.clientX - rect.left, e.clientY - rect.top);
    if (idx >= 0) app.selectBody(idx);
    else app.deselect();
  });
}

// ---- animation loop ----
const clock = new THREE.Clock();
let fpsEMA = 60;

function frame() {
  requestAnimationFrame(frame);
  const dtReal = Math.min(clock.getDelta(), 0.1);
  if (dtReal > 0) fpsEMA += ((1 / dtReal) - fpsEMA) * 0.1;
  app._fps = fpsEMA;

  if (app.state.running) {
    const dt = BASE_DT / app.state.substeps;
    app._accum += dtReal * TIME_SCALE * app.state.speed;
    let n = 0;
    while (app._accum >= dt && n < MAX_STEPS_PER_FRAME) {
      app._advance(dt);
      app._accum -= dt;
      n++;
    }
    if (n >= MAX_STEPS_PER_FRAME) app._accum = 0; // dropped behind; resync
  }

  scene.syncVisuals(system);
  scene.render();
  ui.update();
}

// Track the container rather than the window: some UI styles lay the scene out
// in a window beside the control panel, so its size changes when the panel is
// shown/hidden or the style is switched, not just when the browser is resized.
new ResizeObserver(() => scene.resize()).observe(container);

// Display-scale / browser-zoom changes fire `resize`: re-publish the screen-pixel unit
// (pixel-font styles size everything from it) and re-derive the render resolution.
window.addEventListener('resize', () => { applyPixelUnit(); scene.resize(); });

// boot
applyPixelUnit();
document.documentElement.dataset.theme = startTheme.id;
ui.setTheme(startTheme.id);
ui.setCamera(app.state.camera);
app.loadPreset('default', { autoplay: true });
ui.syncToggles();
ui.setCollisionMode(app.state.collisionMode);
frame();
