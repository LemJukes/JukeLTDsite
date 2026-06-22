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

const POOL = 8;          // max simultaneous bursts
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
  constructor(parentScene) {
    this.group = new THREE.Group();
    parentScene.add(this.group);
    this._tex = glowTexture();
    this._clock = new THREE.Clock();
    this._slots = [];
    for (let i = 0; i < POOL; i++) this._slots.push(this._makeSlot());
  }

  _makeSlot() {
    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 2),
      new THREE.MeshBasicMaterial({
        wireframe: true, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );

    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._tex, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
      map: this._tex, size: 1.2, sizeAttenuation: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    points.frustumCulled = false;

    shell.visible = flash.visible = points.visible = false;
    this.group.add(shell, flash, points);
    return { shell, flash, points, vel: new Float32Array(PARTICLES * 3), active: false, life: 0, maxLife: 1, shellR: 1, flashR: 1 };
  }

  /**
   * Fire a burst at `point`. `severity` (impact energy / binding energy) scales
   * the size and reach; `color` (a THREE.Color) tints it.
   */
  spawn(point, { severity = 0, color } = {}) {
    const slot = this._slots.find((s) => !s.active) || this._slots[0];
    const scale = 1 + Math.cbrt(Math.max(0, Math.min(severity, 50))); // ~1 .. 4.7
    const col = color instanceof THREE.Color ? color : new THREE.Color(color ?? 0xffffff);

    slot.active = true;
    slot.maxLife = 0.7 + 0.25 * Math.min(scale, 4);
    slot.life = slot.maxLife;
    slot.shellR = 3 * scale;
    slot.flashR = 6 * scale;

    slot.shell.position.copy(point);
    slot.shell.scale.setScalar(0.01);
    slot.shell.material.color.copy(col);
    slot.shell.material.opacity = 1;
    slot.shell.visible = true;

    slot.flash.position.copy(point);
    slot.flash.scale.setScalar(slot.flashR * 0.4);
    slot.flash.material.color.copy(col).lerp(WHITE, 0.5);
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
  update() {
    const dt = Math.min(this._clock.getDelta(), MAX_DT);
    for (const slot of this._slots) {
      if (!slot.active) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.active = false;
        slot.shell.visible = slot.flash.visible = slot.points.visible = false;
        continue;
      }
      const t = 1 - slot.life / slot.maxLife;  // 0 -> 1 over the lifetime
      const ease = 1 - (1 - t) * (1 - t);      // easeOutQuad

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
    }
    this._clock.getDelta();
  }
}
