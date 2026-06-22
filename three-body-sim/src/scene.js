// scene.js — all the Three.js rendering for the simulator.
//
// Owns the renderer, camera, orbit controls, the per-body visuals (low-poly
// wireframe sphere + fading trail + optional velocity arrow), the centre-of-mass
// crosshair, the "infinite" backdrop grid, body picking/selection, and a subtle
// bloom pass. It reads state from an NBodySystem each frame but never mutates it.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ImpactFX } from './effects.js';

const GRID_CELL = 10;
const TRAIL_CAPACITY = 4000; // max points buffered per trail
const COM_COLOR = 0x5b8cff;
const SELECT_COLOR = 0xffffff;

export class SimScene {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02040a);

    this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 50000);
    this.camera.position.set(0, 0, 60);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.bodyVisuals = [];
    this.trailLength = 600;
    this.selectedIndex = -1;

    this.raycaster = new THREE.Raycaster();

    this._buildGrid();
    this._buildCOM();
    this._buildSelection();

    this.arrowGroup = new THREE.Group();
    this.scene.add(this.arrowGroup);
    this.arrows = [];

    this._buildComposer();

    // collision pyrotechnics (cosmetic; reads nothing back into the physics)
    this.fx = new ImpactFX(this.scene);

    // option state mirrored by the UI
    this.options = {
      showGrid: true,
      showCOM: true,
      showTrails: true,
      showVectors: false,
      showZLines: true,
      followCOM: false,
      trackCOM: false,
    };

    this._com = new THREE.Vector3();
    this._comPrev = new THREE.Vector3(); // COM last frame, for tracking deltas
    this._tracking = false;              // whether a tracking lock is active
    this._tmp = new THREE.Vector3();
    this._proj = new THREE.Vector3();
  }

  _buildGrid() {
    this.grid = new THREE.GridHelper(2000, 2000 / GRID_CELL, 0x0c4a2a, 0x0a3a22);
    // GridHelper lies in the xz plane by default; rotate it into the xy plane so
    // it sits behind the (planar) orbits, matching the original "backdrop" idea.
    this.grid.rotation.x = Math.PI / 2;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.4;
    this.grid.material.depthWrite = false;
    this.scene.add(this.grid);
  }

  // Centre of mass = a 3D crosshair through a small wireframe cube, deliberately
  // unlike the bodies so it reads as an instrument marker, not another star.
  _buildCOM() {
    this.comGroup = new THREE.Group();
    const L = 4;
    const axes = new THREE.BufferGeometry();
    axes.setAttribute('position', new THREE.Float32BufferAttribute([
      -L, 0, 0, L, 0, 0,
      0, -L, 0, 0, L, 0,
      0, 0, -L, 0, 0, L,
    ], 3));
    const lineMat = new THREE.LineBasicMaterial({ color: COM_COLOR, transparent: true, opacity: 0.9 });
    const crosshair = new THREE.LineSegments(axes, lineMat);

    const cube = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.6, 1.6, 1.6)),
      new THREE.LineBasicMaterial({ color: COM_COLOR })
    );

    this.comGroup.add(crosshair, cube);
    this.scene.add(this.comGroup);
  }

  // A bright wireframe cage drawn around the currently selected body.
  _buildSelection() {
    this.selectionBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.85 })
    );
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);
  }

  _buildComposer() {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // subtle glow only — enough to feel like a phosphor/vector display without
    // washing out the crisp wireframes
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.3, 0.12);
    this.composer.addPass(this.bloomPass);

    this.composer.addPass(new OutputPass());
  }

  // ---- collision effects ----

  /** Fire a cosmetic impact burst at `point`. opts: { severity, color }. */
  spawnImpact(point, opts) {
    this.fx.spawn(point, opts);
  }

  /** Snuff out any in-flight bursts (reset / config change). */
  clearEffects() {
    this.fx.clear();
  }

  /** (Re)create the per-body visuals to match the current system bodies. */
  buildBodies(system) {
    for (const v of this.bodyVisuals) this._disposeVisual(v);
    for (const a of this.arrows) this.arrowGroup.remove(a);
    this.bodyVisuals = [];
    this.arrows = [];
    this.fx.clear();
    this.setSelected(-1);

    for (const body of system.bodies) {
      const color = new THREE.Color(body.color);

      // low-poly icosahedron (detail 1) for an early-CG wireframe look; unit
      // geometry scaled per-frame from body.radius so live size edits are free
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color, wireframe: true })
      );
      mesh.scale.setScalar(body.radius);

      // trail: fixed-capacity buffer, drawn as an additive line that fades to
      // black at the tail (on a black background that reads as a fade-out).
      const positions = new Float32Array(TRAIL_CAPACITY * 3);
      const colors = new Float32Array(TRAIL_CAPACITY * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setDrawRange(0, 0);
      const trail = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      trail.frustumCulled = false;

      const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, color.getHex());
      this.arrowGroup.add(arrow);
      this.arrows.push(arrow);

      // z-height drop line: a dashed plumb line from the body straight down to
      // its shadow on the xy plane (z = 0), so height off the grid is readable.
      const zGeo = new THREE.BufferGeometry();
      zGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const zline = new THREE.Line(
        zGeo,
        new THREE.LineDashedMaterial({
          color: color.getHex(),
          transparent: true,
          opacity: 0.5,
          dashSize: 1.4,
          gapSize: 1,
          depthWrite: false,
        })
      );
      zline.frustumCulled = false;

      this.scene.add(mesh, trail, zline);
      this.bodyVisuals.push({ body, mesh, trail, zline, color, points: [] });
    }

    this.arrowGroup.visible = this.options.showVectors;
  }

  _disposeVisual(v) {
    this.scene.remove(v.mesh, v.trail, v.zline);
    v.mesh.geometry.dispose();
    v.mesh.material.dispose();
    v.trail.geometry.dispose();
    v.trail.material.dispose();
    v.zline.geometry.dispose();
    v.zline.material.dispose();
  }

  // ---- picking / selection ----

  /**
   * Screen-space body pick (forgiving): returns the index of the closest active
   * body whose projected centre is within a few pixels of (localX, localY), or
   * -1. Coordinates are relative to the canvas top-left.
   */
  pickBody(localX, localY) {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.bodyVisuals.length; i++) {
      const v = this.bodyVisuals[i];
      if (v.body.ejected) continue;
      this._proj.copy(v.body.pos).project(this.camera);
      if (this._proj.z > 1) continue; // behind camera
      const sx = (this._proj.x * 0.5 + 0.5) * w;
      const sy = (-this._proj.y * 0.5 + 0.5) * h;
      const d = Math.hypot(sx - localX, sy - localY);
      // tolerance scales a little with on-screen size, min 22px
      const screenR = Math.max(22, this._screenRadius(v.body));
      if (d < screenR && d < bestDist) { best = i; bestDist = d; }
    }
    return best;
  }

  _screenRadius(body) {
    // project a point one radius to the camera's right and measure the offset
    const h = this.container.clientHeight;
    this._tmp.copy(this.camera.position).sub(body.pos);
    const right = new THREE.Vector3().crossVectors(this.camera.up, this._tmp).normalize();
    this._proj.copy(body.pos).project(this.camera);
    const cy = (-this._proj.y * 0.5 + 0.5) * h;
    this._proj.copy(body.pos).addScaledVector(right, body.radius).project(this.camera);
    const ey = (-this._proj.y * 0.5 + 0.5) * h;
    return Math.abs(ey - cy) + 6;
  }

  setSelected(index) {
    this.selectedIndex = index;
    this.selectionBox.visible = index >= 0 && index < this.bodyVisuals.length;
  }

  // ---- trails ----

  /** Append the current position to every visible body's trail. */
  recordTrails(system) {
    for (const v of this.bodyVisuals) {
      if (v.body.ejected) continue;
      v.points.push(v.body.pos.clone());
      while (v.points.length > this.trailLength) v.points.shift();
    }
  }

  setTrailLength(n) {
    this.trailLength = Math.max(2, Math.min(TRAIL_CAPACITY, Math.floor(n)));
    for (const v of this.bodyVisuals) {
      while (v.points.length > this.trailLength) v.points.shift();
    }
  }

  clearTrails() {
    for (const v of this.bodyVisuals) {
      v.points.length = 0;
      v.trail.geometry.setDrawRange(0, 0);
    }
  }

  /** Push current physics state into the meshes, trails, COM marker and arrows. */
  syncVisuals(system) {
    for (const v of this.bodyVisuals) {
      const visible = !v.body.ejected;
      v.mesh.visible = visible;
      if (visible) {
        v.mesh.position.copy(v.body.pos);
        v.mesh.scale.setScalar(v.body.radius);
        v.mesh.rotation.x += 0.004;
        v.mesh.rotation.y += 0.006;
      }

      // drop line from the body down to its projection on the xy plane
      const zl = v.zline;
      zl.visible = visible && this.options.showZLines;
      if (zl.visible) {
        const p = zl.geometry.attributes.position.array;
        p[0] = v.body.pos.x; p[1] = v.body.pos.y; p[2] = v.body.pos.z;
        p[3] = v.body.pos.x; p[4] = v.body.pos.y; p[5] = 0;
        zl.geometry.attributes.position.needsUpdate = true;
        zl.computeLineDistances(); // keep dashes uniform as the height changes
      }

      this._updateTrailGeometry(v);
    }

    // selection cage follows the selected body
    if (this.selectionBox.visible) {
      const v = this.bodyVisuals[this.selectedIndex];
      if (v && !v.body.ejected) {
        this.selectionBox.position.copy(v.body.pos);
        this.selectionBox.scale.setScalar(v.body.radius * 2.6);
        this.selectionBox.rotation.y += 0.01;
        this.selectionBox.rotation.x += 0.006;
      } else {
        this.selectionBox.visible = false;
      }
    }

    // centre of mass
    system.centerOfMass(this._com);
    this.comGroup.position.copy(this._com);
    this.comGroup.visible = this.options.showCOM;

    // velocity arrows
    this.arrowGroup.visible = this.options.showVectors;
    if (this.options.showVectors) {
      for (let i = 0; i < this.bodyVisuals.length; i++) {
        const v = this.bodyVisuals[i];
        const arrow = this.arrows[i];
        const speed = v.body.vel.length();
        if (v.body.ejected || speed < 1e-6) {
          arrow.visible = false;
          continue;
        }
        arrow.visible = true;
        arrow.position.copy(v.body.pos);
        arrow.setDirection(this._tmp.copy(v.body.vel).normalize());
        arrow.setLength(speed * 14 + v.body.radius, v.body.radius * 1.2, v.body.radius * 0.7);
      }
    }
  }

  _updateTrailGeometry(v) {
    const pts = v.points;
    const n = this.options.showTrails ? pts.length : 0;
    const pos = v.trail.geometry.attributes.position.array;
    const col = v.trail.geometry.attributes.color.array;
    const r = v.color.r, g = v.color.g, b = v.color.b;
    for (let k = 0; k < n; k++) {
      const p = pts[k];
      const o = k * 3;
      pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z;
      const t = n > 1 ? k / (n - 1) : 1; // 0 at tail -> 1 at head
      const f = t * t; // ease so the fade hugs the head
      col[o] = r * f; col[o + 1] = g * f; col[o + 2] = b * f;
    }
    v.trail.geometry.setDrawRange(0, n);
    v.trail.geometry.attributes.position.needsUpdate = true;
    v.trail.geometry.attributes.color.needsUpdate = true;
  }

  /** Snap the backdrop grid to the camera target so it appears infinite. */
  _updateGrid() {
    this.grid.visible = this.options.showGrid;
    if (!this.options.showGrid) return;
    const t = this.controls.target;
    this.grid.position.set(
      Math.round(t.x / GRID_CELL) * GRID_CELL,
      Math.round(t.y / GRID_CELL) * GRID_CELL,
      0
    );
  }

  /** Move the camera so all active bodies fit comfortably in view. */
  autoFrame(system, distance = null) {
    const com = system.centerOfMass(this._com);
    let radius = 1;
    if (distance == null) {
      for (const b of system.activeBodies) {
        radius = Math.max(radius, b.pos.distanceTo(com) + b.radius);
      }
      const fov = (this.camera.fov * Math.PI) / 180;
      distance = (radius * 1.6) / Math.sin(fov / 2);
    }
    const dir = this._tmp.copy(this.camera.position).sub(this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize().multiplyScalar(distance);
    this.controls.target.copy(com);
    this.camera.position.copy(com).add(dir);
    this.controls.update();
  }

  setBloom(strength) {
    this.bloomPass.strength = strength;
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  render() {
    // TRACK COM: rigidly translate the whole camera rig (position + target) by
    // the COM's displacement since last frame, so it travels with the system at
    // the distance/offset locked in the moment tracking was switched on. Moving
    // both ends by the same delta preserves that offset exactly; the user can
    // still orbit/zoom by hand to change it.
    if (this.options.trackCOM) {
      if (!this._tracking) { this._tracking = true; this._comPrev.copy(this._com); }
      this._tmp.subVectors(this._com, this._comPrev);
      this.camera.position.add(this._tmp);
      this.controls.target.add(this._tmp);
      this._comPrev.copy(this._com);
    } else {
      this._tracking = false;
    }

    // FOLLOW COM: keep the orbit target locked on the COM so the camera always
    // points at it. Independent of tracking — works alone or layered on top of a
    // tracking shot to actively re-centre the framing.
    if (this.options.followCOM) {
      this.controls.target.lerp(this._com, 0.1);
    }

    this._updateGrid();
    this.fx.update();
    this.controls.update();
    this.composer.render();
  }
}
