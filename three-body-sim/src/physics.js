// physics.js — N-body gravitational simulation core.
//
// Pure simulation state and integration. No rendering here. Uses THREE.Vector3
// for vector math so we don't reinvent one. Units are normalised/tuned (not SI):
// G is a free parameter (default 1), masses ~1-10, positions ~tens of units.
//
// The integrator is Velocity Verlet — a symplectic scheme whose energy error
// stays bounded over long runs, which is exactly what an orbital simulation
// needs. A softening length epsilon removes the 1/r^2 singularity so that close
// encounters slingshot instead of exploding to infinite velocity.

import * as THREE from 'three';

let nextId = 0;

export class Body {
  /** @param {{mass:number, radius:number, pos:THREE.Vector3, vel:THREE.Vector3, color:number, name?:string}} cfg */
  constructor(cfg) {
    this.id = nextId++;
    this.name = cfg.name ?? `Body ${this.id}`;
    this.mass = cfg.mass;
    this.radius = cfg.radius;
    this.color = cfg.color;
    this.pos = cfg.pos.clone();
    this.vel = cfg.vel.clone();
    this.acc = new THREE.Vector3();
    this.ejected = false;
  }
}

export class NBodySystem {
  constructor({ G = 1, softening = 0.5 } = {}) {
    this.G = G;
    this.softening = softening;
    this.bodies = [];
    this.time = 0;
    this.initialEnergy = 0;
    // Contact handling. 'off' keeps the pure point-mass model (bodies pass
    // through each other); 'merge' coalesces them inelastically; 'bounce' treats
    // them as solid spheres with the given coefficient of restitution.
    this.collisionMode = 'off';
    this.restitution = 0.5;
    // Called once per detected impact with a descriptive event (see _impactEvent).
    // The renderer/UI subscribe here; physics itself never reaches into them.
    this.onCollision = null;
    this.ejectionRadius = 5000; // flag bodies that escape past this distance

    // scratch vectors reused every step to avoid per-frame allocations
    this._d = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._rel = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._cp = new THREE.Vector3();
  }

  /**
   * Replace all bodies from an array of plain configs. By default the system is
   * normalised — net momentum zeroed and centre of mass recentred on the origin,
   * so it can't drift out of frame. Custom/user setups pass {normalize:false} to
   * keep the entered positions and velocities literal.
   * @param {Array} configs
   * @param {{normalize?:boolean}} [opts]
   */
  setBodies(configs, { normalize = true } = {}) {
    this.bodies = configs.map((c) => new Body(c));
    this.time = 0;
    if (normalize) {
      this.zeroMomentum();
      this.recenter();
    }
    this.computeAccelerations();
    this.initialEnergy = this.totalEnergy();
  }

  /** Capture the current state of every body for later restore() (used by reset). */
  snapshot() {
    return this.bodies.map((b) => ({
      name: b.name, mass: b.mass, radius: b.radius, color: b.color,
      pos: b.pos.clone(), vel: b.vel.clone(),
    }));
  }

  /** Restore body states captured by snapshot(), in place. */
  restore(snap) {
    for (let i = 0; i < snap.length; i++) {
      const b = this.bodies[i];
      const s = snap[i];
      b.mass = s.mass; b.radius = s.radius;
      b.pos.copy(s.pos); b.vel.copy(s.vel);
      b.ejected = false;
    }
    this.time = 0;
    this.computeAccelerations();
    this.initialEnergy = this.totalEnergy();
  }

  get totalMass() {
    let m = 0;
    for (const b of this.bodies) m += b.mass;
    return m;
  }

  centerOfMass(out = new THREE.Vector3()) {
    out.set(0, 0, 0);
    let m = 0;
    for (const b of this.bodies) {
      out.addScaledVector(b.pos, b.mass);
      m += b.mass;
    }
    return m > 0 ? out.divideScalar(m) : out;
  }

  centerOfMassVelocity(out = new THREE.Vector3()) {
    out.set(0, 0, 0);
    let m = 0;
    for (const b of this.bodies) {
      out.addScaledVector(b.vel, b.mass);
      m += b.mass;
    }
    return m > 0 ? out.divideScalar(m) : out;
  }

  /** Subtract the centre-of-mass velocity so total momentum is zero. */
  zeroMomentum() {
    const vcm = this.centerOfMassVelocity();
    for (const b of this.bodies) b.vel.sub(vcm);
  }

  /** Translate the system so the centre of mass sits at the origin. */
  recenter() {
    const com = this.centerOfMass();
    for (const b of this.bodies) b.pos.sub(com);
  }

  /** Newtonian gravity with Plummer softening, written into each body's acc. */
  computeAccelerations() {
    const eps2 = this.softening * this.softening;
    const bodies = this.bodies;
    for (const b of bodies) b.acc.set(0, 0, 0);

    for (let i = 0; i < bodies.length; i++) {
      const bi = bodies[i];
      if (bi.ejected) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const bj = bodies[j];
        if (bj.ejected) continue;

        // d = bj.pos - bi.pos
        this._d.subVectors(bj.pos, bi.pos);
        const r2 = this._d.lengthSq() + eps2;
        const invR3 = 1 / (r2 * Math.sqrt(r2));
        const s = this.G * invR3;

        // symmetric pair contribution
        bi.acc.addScaledVector(this._d, s * bj.mass);
        bj.acc.addScaledVector(this._d, -s * bi.mass);
      }
    }
  }

  /**
   * Advance the system by dt using Velocity Verlet.
   *   x += v*dt + 0.5*a*dt^2
   *   recompute a
   *   v += 0.5*(a_old + a_new)*dt
   */
  step(dt) {
    const bodies = this.bodies;

    // half-kick already folded into the position update via stored acc(t)
    for (const b of bodies) {
      if (b.ejected) continue;
      // x += v*dt + 0.5*a*dt^2
      b.pos.addScaledVector(b.vel, dt);
      b.pos.addScaledVector(b.acc, 0.5 * dt * dt);
      // stash a(t) into vel as a partial kick: v += 0.5*a_old*dt
      b.vel.addScaledVector(b.acc, 0.5 * dt);
    }

    // a(t+dt)
    this.computeAccelerations();

    // second half-kick: v += 0.5*a_new*dt
    for (const b of bodies) {
      if (b.ejected) continue;
      b.vel.addScaledVector(b.acc, 0.5 * dt);
    }

    this.time += dt;

    if (this.collisionMode !== 'off') this._handleCollisions();
    this._flagEjections();
  }

  kineticEnergy() {
    let ke = 0;
    for (const b of this.bodies) {
      if (b.ejected) continue;
      ke += 0.5 * b.mass * b.vel.lengthSq();
    }
    return ke;
  }

  potentialEnergy() {
    const eps2 = this.softening * this.softening;
    let pe = 0;
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      if (bodies[i].ejected) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        if (bodies[j].ejected) continue;
        const r = Math.sqrt(bodies[i].pos.distanceToSquared(bodies[j].pos) + eps2);
        pe -= (this.G * bodies[i].mass * bodies[j].mass) / r;
      }
    }
    return pe;
  }

  totalEnergy() {
    return this.kineticEnergy() + this.potentialEnergy();
  }

  /** Energy drift relative to the initial state, as a fraction (0 = perfect). */
  energyDrift() {
    if (this.initialEnergy === 0) return 0;
    return (this.totalEnergy() - this.initialEnergy) / Math.abs(this.initialEnergy);
  }

  /** Smallest centre-to-centre distance among active bodies (0 if fewer than 2). */
  minSeparation() {
    const bodies = this.bodies;
    let min = Infinity;
    for (let i = 0; i < bodies.length; i++) {
      if (bodies[i].ejected) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        if (bodies[j].ejected) continue;
        const d = bodies[i].pos.distanceTo(bodies[j].pos);
        if (d < min) min = d;
      }
    }
    return Number.isFinite(min) ? min : 0;
  }

  // Detect every overlapping, *closing* pair and apply the active response
  // (merge or bounce). Each genuine impact is reported through onCollision. The
  // "closing" test (separation currently shrinking) is what stops a freshly
  // bounced — and therefore still-overlapping — pair from re-triggering forever.
  _handleCollisions() {
    const bodies = this.bodies;
    let dirty = false;
    for (let i = 0; i < bodies.length; i++) {
      const bi = bodies[i];
      if (bi.ejected) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const bj = bodies[j];
        if (bj.ejected) continue;

        this._d.subVectors(bj.pos, bi.pos); // points from i to j
        const sumR = bi.radius + bj.radius;
        const dist2 = this._d.lengthSq();
        if (dist2 > sumR * sumR) continue;

        // velocity of j relative to i; d·rel < 0 means the gap is closing
        this._rel.subVectors(bj.vel, bi.vel);
        if (this._d.dot(this._rel) >= 0) continue;

        const dist = Math.sqrt(dist2) || 1e-9;
        this._n.copy(this._d).divideScalar(dist); // unit normal, i -> j

        const event = this._impactEvent(bi, bj, dist);
        if (this.collisionMode === 'merge') this._merge(bi, bj);
        else this._bounce(bi, bj, sumR - dist);
        dirty = true;
        if (this.onCollision) this.onCollision(event);
      }
    }
    // positions and/or velocities changed; refresh forces once for the next step
    if (dirty) this.computeAccelerations();
  }

  /**
   * Describe an impact without altering state. The key number is the kinetic
   * energy of the relative motion in the centre-of-mass frame, E = ½·μ·v_rel²,
   * compared against the gravitational binding energy of the would-be merged
   * body (≈ 3/5·G·M²/R). Their ratio (severity) classifies the event:
   * a gentle touch that would simply accrete, a disruptive graze, or a
   * catastrophic, body-shattering smash.
   */
  _impactEvent(bi, bj, dist) {
    const m1 = bi.mass, m2 = bj.mass;
    const mu = (m1 * m2) / (m1 + m2);
    const vRel = this._rel.length();
    const impactEnergy = 0.5 * mu * vRel * vRel;
    const M = m1 + m2;
    const R = Math.cbrt(bi.radius ** 3 + bj.radius ** 3);
    const bindEnergy = R > 0 ? (0.6 * this.G * M * M) / R : 0;
    const severity = bindEnergy > 0
      ? impactEnergy / bindEnergy
      : (impactEnergy > 1e-9 ? Infinity : 0);
    const category = severity >= 10 ? 'catastrophic'
      : severity >= 1 ? 'disruption'
        : 'merge';
    // radius-weighted contact point on the line joining the two centres
    this._cp.copy(bi.pos).addScaledVector(this._d, bi.radius / (bi.radius + bj.radius));
    return {
      time: this.time,
      a: bi.name, b: bj.name,
      aColor: bi.color, bColor: bj.color,
      point: this._cp.clone(),
      m1, m2, mu, vRel,
      impactEnergy, bindEnergy, severity, category,
      outcome: this.collisionMode,
    };
  }

  // Inelastic merge: conserve momentum and total mass, sum volume for radius.
  // (Accelerations are refreshed once by the caller.)
  _merge(a, b) {
    const m = a.mass + b.mass;
    // momentum-weighted velocity
    a.vel.multiplyScalar(a.mass).addScaledVector(b.vel, b.mass).divideScalar(m);
    // mass-weighted position
    a.pos.multiplyScalar(a.mass).addScaledVector(b.pos, b.mass).divideScalar(m);
    a.radius = Math.cbrt(a.radius ** 3 + b.radius ** 3);
    a.mass = m;
    b.ejected = true; // remove the smaller partner from the simulation
  }

  // Hard-sphere rebound. Applies an equal-and-opposite impulse along the contact
  // normal (restitution e: 0 = sticky, 1 = perfectly elastic), then de-penetrates
  // the pair, splitting the push inversely with mass so the centre of mass holds.
  // Requires this._rel (vj - vi) and this._n (unit i -> j) to be set by the caller.
  _bounce(bi, bj, penetration) {
    const m1 = bi.mass, m2 = bj.mass;
    const mu = (m1 * m2) / (m1 + m2);
    const vn = this._rel.dot(this._n); // < 0 while closing
    const jImp = -(1 + this.restitution) * vn * mu; // impulse magnitude (>= 0)
    bi.vel.addScaledVector(this._n, -jImp / m1);
    bj.vel.addScaledVector(this._n, jImp / m2);

    const wi = m2 / (m1 + m2), wj = m1 / (m1 + m2);
    bi.pos.addScaledVector(this._n, -penetration * wi);
    bj.pos.addScaledVector(this._n, penetration * wj);
  }

  _flagEjections() {
    const r2 = this.ejectionRadius * this.ejectionRadius;
    for (const b of this.bodies) {
      if (!b.ejected && b.pos.lengthSq() > r2) b.ejected = true;
    }
  }

  get activeBodies() {
    return this.bodies.filter((b) => !b.ejected);
  }
}
