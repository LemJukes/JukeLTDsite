// effects.js — cheap, on-brand impact pyrotechnics for collisions.
//
// When two bodies collide the physics emits an impact event; this turns that
// into a short-lived visual burst at the contact point: an expanding wireframe
// shockwave shell, a fast additive flash, and a spray of debris particles. It is
// deliberately *cosmetic* — the particles carry no physics and feed nothing back
// into the simulation, so a blast costs only a few hundred additive points and
// rides the existing bloom pass to read as "destructive" for next to nothing.
//
// Everything is pre-allocated into a small pool of reusable slots, so spawning a
// burst allocates nothing and the GC stays quiet during chaotic, collision-heavy
// runs.

import * as THREE from 'three';
import { pencilMesh } from './pencil.js';
import { mulberry32 } from './noise.js';

const POOL = 8;         // max simultaneous bursts
const PARTICLES = 140;   // debris points per burst
const MAX_DT = 0.05;     // clamp so a long pause doesn't fast-forward a burst
const WHITE = new THREE.Color(0xffffff);

// A soft radial glow, shared by the flash sprite and the debris points so both
// read as light rather than hard dots — exactly what the bloom pass wants.
function glowTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ImpactFX {
  /** @param theme scene half of a UI style (see themes.js): `additive` and `ink` matter here */
  constructor(parentScene, theme) {
    this.group = new THREE.Group();
    parentScene.add(this.group);
    this._tex = glowTexture();
    this._clock = new THREE.Clock();
    this._slots = [];
    this.setTheme(theme);
    for (let i = 0; i < POOL; i++) this._slots.push(this._makeSlot());
    this._ensureStars();
  }

  /**
   * Light-emitting styles blend additively and tint each burst from the bodies'
   * colours; ink styles (`theme.ink` set) draw every burst in that one colour
   * with ordinary alpha blending, since additive light vanishes on a white page.
   * A style with fx 'scribble' (the Lab Notebook) draws a red-pen starburst instead.
   */
  setTheme(theme) {
    this.ink = theme.ink ?? null;
    this.blending = theme.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.scribble = theme.fx === 'scribble';
    this.annot = theme.annot ?? 0xc4262e;
    for (const slot of this._slots) {
      for (const part of [slot.shell, slot.flash, slot.points]) {
        part.material.blending = this.blending;
        part.material.needsUpdate = true;
      }
      if (slot.star) { slot.star.visible = false; slot.star.material.color.set(this.annot); }
    }
    this._ensureStars();
  }

  // The scribble burst: spokes of uneven length round a small scribbled loop, drawn once as a unit-radius
  // pencil mesh and then scaled and faded per burst. Built only when a style asks for it.
  _ensureStars() {
    if (!this.scribble) return;
    for (const slot of this._slots) {
      if (slot.star) continue;
      const rand = mulberry32(slot.index * 131 + 9);
      const seg = [];
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + (rand() - 0.5) * 0.25;
        const r0 = 0.26 + rand() * 0.12;
        const r1 = 0.78 + rand() * 0.4;
        seg.push(r0 * Math.cos(a), r0 * Math.sin(a), 0, r1 * Math.cos(a), r1 * Math.sin(a), 0);
      }
      let prev = null;
      for (let k = 0; k <= 22; k++) {            // a loose scribbled ring inside the spokes
        const a = (k / 22) * Math.PI * 2 * 1.15;
        const r = 0.2 + (rand() - 0.5) * 0.1;
        const p = [r * Math.cos(a), r * Math.sin(a), 0];
        if (prev) seg.push(...prev, ...p);
        prev = p;
      }
      const { mesh, material } = pencilMesh(new Float32Array(seg), this.annot, 2.2, { transparent: true });
      material.depthWrite = false;
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      slot.star = mesh;
    }
  }

  _makeSlot() {
    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 2),
      new THREE.MeshBasicMaterial({
        wireframe: true, transparent: true,
        blending: this.blending, depthWrite: false,
      })
    );

    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._tex, transparent: true,
      blending: this.blending, depthWrite: false,
    }));

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
      map: this._tex, size: 1.2, sizeAttenuation: true, transparent: true,
      blending: this.blending, depthWrite: false,
    }));
    points.frustumCulled = false;

    shell.visible = flash.visible = points.visible = false;
    this.group.add(shell, flash, points);
    return { index: this._slots.length, star: null, shell, flash, points, vel: new Float32Array(PARTICLES * 3), active: false, life: 0, maxLife: 1, shellR: 1, flashR: 1 };
  }

  /**
   * Fire a burst at `point`. `severity` (impact energy / binding energy) scales
   * the size and reach; `color` (a THREE.Color) tints it.
   */
  spawn(point, { severity = 0, color } = {}) {
    const slot = this._slots.find((s) => !s.active) || this._slots[0];
    const scale = 1 + Math.cbrt(Math.max(0, Math.min(severity, 50))); // ~1 .. 4.7
    const inked = this.ink != null;
    const col = inked ? new THREE.Color(this.ink)
      : color instanceof THREE.Color ? color : new THREE.Color(color ?? 0xffffff);

    slot.active = true;
    slot.maxLife = 0.7 + 0.25 * Math.min(scale, 4);
    slot.life = slot.maxLife;
    slot.shellR = 3 * scale;
    slot.flashR = (inked ? 4 : 6) * scale; // a black flash blots out more than a light one

    if (this.scribble && slot.star) {      // a red-pen starburst: nothing else of the burst is drawn
      slot.star.position.copy(point);
      slot.star.scale.setScalar(0.01);
      slot.star.material.opacity = 1;
      slot.star.visible = true;
      return;
    }

    slot.shell.position.copy(point);
    slot.shell.scale.setScalar(0.01);
    slot.shell.material.color.copy(col);
    slot.shell.material.opacity = 1;
    slot.shell.visible = true;

    slot.flash.position.copy(point);
    slot.flash.scale.setScalar(slot.flashR * 0.4);
    slot.flash.material.color.copy(col);
    if (!inked) slot.flash.material.color.lerp(WHITE, 0.5);
    slot.flash.material.opacity = 1;
    slot.flash.visible = true;

    const pos = slot.points.geometry.attributes.position.array;
    const vel = slot.vel;
    const speed = 6 * scale;
    for (let k = 0; k < PARTICLES; k++) {
      const o = k * 3;
      pos[o] = point.x; pos[o + 1] = point.y; pos[o + 2] = point.z;
      // uniform random direction on the unit sphere, varied speed
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = speed * (0.4 + Math.random() * 0.6);
      vel[o] = r * Math.cos(a) * sp;
      vel[o + 1] = r * Math.sin(a) * sp;
      vel[o + 2] = u * sp;
    }
    slot.points.geometry.attributes.position.needsUpdate = true;
    slot.points.material.color.copy(col);
    slot.points.material.opacity = 1;
    slot.points.material.size = 0.8 + 0.5 * scale;
    slot.points.visible = true;
  }

  // Advance every active burst. Driven off its own clock so bursts animate even
  // while the simulation is paused (you get to watch the blast settle).
  update(camera = null) {
    const dt = Math.min(this._clock.getDelta(), MAX_DT);
    for (const slot of this._slots) {
      if (!slot.active) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.active = false;
        slot.shell.visible = slot.flash.visible = slot.points.visible = false;
        if (slot.star) slot.star.visible = false;
        continue;
      }
      const t = 1 - slot.life / slot.maxLife;  // 0 -> 1 over the lifetime
      const ease = 1 - (1 - t) * (1 - t);      // easeOutQuad

      if (slot.star && slot.star.visible) {    // scribble: grows, then the pen lifts
        slot.star.scale.setScalar(Math.max(0.01, slot.shellR * ease));
        slot.star.material.opacity = Math.min(1, (1 - t) * 1.6);
        if (camera) slot.star.quaternion.copy(camera.quaternion); // faces the page
        continue;
      }

      slot.shell.scale.setScalar(Math.max(0.01, slot.shellR * ease));
      slot.shell.material.opacity = (1 - t) * 0.9;
      slot.shell.rotation.x += dt * 0.8;
      slot.shell.rotation.y += dt * 1.1;

      const pop = t < 0.25 ? t / 0.25 : 1;     // flash blooms then fades fast
      slot.flash.scale.setScalar(slot.flashR * (0.4 + 0.6 * pop));
      slot.flash.material.opacity = Math.max(0, 1 - t * 1.6);

      const pos = slot.points.geometry.attributes.position.array;
      const vel = slot.vel;
      const drag = Math.pow(0.12, dt);         // gentle outward slowdown
      for (let k = 0; k < PARTICLES; k++) {
        const o = k * 3;
        pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt;
        vel[o] *= drag; vel[o + 1] *= drag; vel[o + 2] *= drag;
      }
      slot.points.geometry.attributes.position.needsUpdate = true;
      slot.points.material.opacity = 1 - t;
    }
  }

  // Snuff out any in-flight bursts (used on reset / config change) and swallow
  // the elapsed time so the next spawn starts from a clean clock.
  clear() {
    for (const slot of this._slots) {
      slot.active = false;
      slot.shell.visible = slot.flash.visible = slot.points.visible = false;
      if (slot.star) slot.star.visible = false;
    }
    this._clock.getDelta();
  }
}
