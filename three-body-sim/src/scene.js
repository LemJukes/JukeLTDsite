// scene.js — all the Three.js rendering for the simulator.
//
// Owns the renderer, camera, orbit controls, the per-body visuals (low-poly
// wireframe sphere spinning on its own axis + fading trail + optional velocity
// arrow), the centre-of-mass crosshair, the "infinite" backdrop grid, the star
// field, body picking/selection, and the post-processing (bloom / 1-bit dither).
// It reads state from an NBodySystem each frame but never mutates it.
//
// Each body is drawn by a "look" (bodyLooks.js). The look's core spins in `coreNode`; any decorations
// (rings, tails, ...) live in `decoNode`; and an invisible unit-sphere `proxy` is what clicks hit.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { ImpactFX } from './effects.js';
import { pixelUnit } from './themes.js';
import { createLook, defaultLook, makeLookContext, makeOtherSlot } from './bodyLooks.js';

const GRID_CELL = 10;
const PICK_MIN_PX = 22;      // a body can be picked from at least this far away on screen...
const PICK_MARGIN_PX = 6;    // ...or from this far beyond its visible edge, whichever is larger
const TRAIL_CAPACITY = 4000; // max points buffered per trail
const BASE_FOV = 60;
const SURFACE_FOV = 90;      // wide lens when standing on a body (vertical degrees)
const SURFACE_EYE = 1.03;    // camera height as a multiple of the body's radius (just above its surface)
const SURFACE_NEAR = 0.02;   // near plane close enough for the ground right under the camera
const SURFACE_MAX_PITCH = THREE.MathUtils.degToRad(89.5); // straight up / down, short of the pole
const GRID_LADDER = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]; // grid cell multipliers (see _updateGrid)
const STAR_RADIUS = 10000;   // star sphere, re-centred on the camera every frame so it sits at infinity
const STAR_TIERS = [         // faint field + a few bright stars; size in CSS px (screen px for pixel styles)
  { count: 1400, size: 1 },
  { count: 160, size: 2 },
];

// Small deterministic PRNG so the sky is the same on every load.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Each body spins steadily about its own tilted axis (purely cosmetic; it keeps turning while
// the sim is paused). Axis and rate vary per body so they don't spin in lock-step.
function spinFor(i) {
  const tilt = 0.25 + 0.3 * ((i * 0.618) % 1);    // radians off the orbital-plane normal (+z)
  const azimuth = i * 2.39996;                     // golden angle, spreads the tilts around
  const axis = new THREE.Vector3(Math.sin(tilt) * Math.cos(azimuth), Math.sin(tilt) * Math.sin(azimuth), Math.cos(tilt));
  const rate = 0.32 + 0.22 * ((i * 0.381) % 1);   // radians per second
  return { axis: axis.normalize(), rate };
}

// Final 1-bit pass for monochrome styles: ordered (Bayer 4x4) dither of the
// finished frame to pure black/white, so mid-greys (the faint grid, fading
// trails, translucent bursts) become the stippled patterns of an early Mac
// bitmap display instead of smooth shades. `cell` is the size of one dither
// pixel in render-target pixels.
const DitherShader = {
  uniforms: { tDiffuse: { value: null }, cell: { value: 1 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float cell;
    varying vec2 vUv;
    float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
    float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      float t = bayer4(floor(gl_FragCoord.xy / cell));
      gl_FragColor = vec4(vec3(l > t ? 1.0 : 0.0), 1.0);
    }`,
};

export class SimScene {
  /** @param theme scene half of a UI style — see themes.js */
  constructor(container, theme) {
    this.container = container;
    this.theme = theme;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this._pixelRatioFor(theme));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(theme.background);
    this._fade = new THREE.Color(theme.fadeTo);

    this.camera = new THREE.PerspectiveCamera(BASE_FOV, container.clientWidth / container.clientHeight, 0.1, 50000);
    this.camera.position.set(0, 0, 60);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.bodyVisuals = [];
    this.trailLength = 600;
    this.selectedIndex = -1;

    // picking: clicks are raycast against an invisible unit sphere per body (never the visible
    // mesh), so thin or odd looks are still easy to hit
    this.raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._proxyGeo = new THREE.SphereGeometry(1, 16, 12);
    this._proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    this.looks = [];                       // per-body look settings (owned by the app, see main.js)

    this._buildGrid();
    this._buildCOM();
    this._buildSelection();

    this.arrowGroup = new THREE.Group();
    this.scene.add(this.arrowGroup);
    this.arrows = [];

    this._buildComposer();
    this._buildStars();

    // collision pyrotechnics (cosmetic; reads nothing back into the physics)
    this.fx = new ImpactFX(this.scene, theme);

    // option state mirrored by the UI
    this.options = {
      showGrid: true,
      showCOM: true,
      showTrails: true,
      showVectors: false,
      showZLines: true,
      showStars: true,
    };
    this._spinClock = new THREE.Clock(); // drives the bodies' cosmetic spin, paused or not

    this._com = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();

    // camera focus (see setCamera)
    this.cam = { focus: 'free', view: 'orbit' };
    this.onCameraChange = null;            // called when the scene changes the camera itself
    this._camSettle = 0;                   // frames of soft re-centring after a focus change
    this._savedPose = null;                // orbit pose to restore when leaving the surface view
    this._spot = new THREE.Vector3(0, 0, 1);     // random surface point, as a raw direction
    // The standing frame, stored in the body's own (spinning) coordinates so it turns with it:
    // n = local "up" (away from the body's centre), e1 = horizontal axis at yaw 0, e2 = n x e1.
    this._surfaceNL = new THREE.Vector3(0, 0, 1);
    this._surfaceE1L = new THREE.Vector3(1, 0, 0);
    this._surfaceE2L = new THREE.Vector3(0, 1, 0);
    // ...and the same three in world space for the current frame
    this._surfaceN = new THREE.Vector3();
    this._surfaceE1 = new THREE.Vector3();
    this._surfaceE2 = new THREE.Vector3();
    this._yaw = 0;                                // look direction within that frame
    this._pitch = SURFACE_MAX_PITCH;              //   (starts straight up, away from the body)
    this._qInv = new THREE.Quaternion();
    this._surfaceInit = false;
    this._gridLevel = 0;                          // index into GRID_LADDER
    this._bindSurfaceLook();
  }

  _pixelRatioFor(theme) {
    if (theme.pixelRatio === 'unit') return 1 / pixelUnit().css; // one buffer pixel = one screen pixel
    return theme.pixelRatio ?? Math.min(window.devicePixelRatio, 2);
  }

  _buildGrid() {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid.material.dispose();
    }
    const [c1, c2] = this.theme.grid;
    this.grid = new THREE.GridHelper(2000, 2000 / GRID_CELL, c1, c2);
    // GridHelper lies in the xz plane by default; rotate it into the xy plane so
    // it sits behind the (planar) orbits, matching the original "backdrop" idea.
    this.grid.rotation.x = Math.PI / 2;
    this.grid.material.transparent = this.theme.gridOpacity < 1;
    this.grid.material.opacity = this.theme.gridOpacity;
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
    const lineMat = new THREE.LineBasicMaterial({ color: this.theme.com, transparent: true, opacity: this.theme.comOpacity });
    const crosshair = new THREE.LineSegments(axes, lineMat);

    const cube = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.6, 1.6, 1.6)),
      new THREE.LineBasicMaterial({ color: this.theme.com })
    );

    this.comGroup.add(crosshair, cube);
    this.scene.add(this.comGroup);
  }

  // A bright wireframe cage drawn around the currently selected body.
  _buildSelection() {
    this.selectionBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: this.theme.select, transparent: true, opacity: this.theme.selectOpacity })
    );
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);
  }

  // Background star field: points scattered over a big sphere that is re-centred on the camera
  // every frame, so the stars sit "at infinity" and only turn, never shift, as the view moves.
  // It gives the eye a fixed reference when nothing else is in view (e.g. riding a spinning
  // body). Two tiers: a faint field and a few brighter stars.
  _buildStars() {
    const rand = mulberry32(0x3b0d1e5);
    this.stars = new THREE.Group();
    this.starTiers = STAR_TIERS.map(({ count, size }) => {
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const u = rand() * 2 - 1;
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(1 - u * u);
        pos[i * 3] = r * Math.cos(a) * STAR_RADIUS;
        pos[i * 3 + 1] = r * Math.sin(a) * STAR_RADIUS;
        pos[i * 3 + 2] = u * STAR_RADIUS;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const points = new THREE.Points(geo, new THREE.PointsMaterial({ sizeAttenuation: false, depthWrite: false }));
      points.frustumCulled = false;
      points.renderOrder = -1; // behind everything
      this.stars.add(points);
      return { points, count, size };
    });
    this.scene.add(this.stars);
    this._styleStars();
  }

  // Star colour, density, blending and size for the current style and resolution. Sizes are
  // whole render pixels so a star never straddles two pixels and flickers as the view turns.
  _styleStars() {
    const t = this.theme;
    const pr = this.renderer.getPixelRatio();
    const toBuffer = t.pixelRatio === 'unit' ? 1 : pr; // pixel styles size stars in screen pixels
    this.starTiers.forEach((tier, i) => {
      const m = tier.points.material;
      m.color.set(t.starColors[i]);
      m.size = Math.max(1, Math.round(tier.size * toBuffer)) / pr; // three.js multiplies by pr again
      m.blending = t.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      m.transparent = t.additive;
      m.needsUpdate = true;
      tier.points.geometry.setDrawRange(0, Math.round(tier.count * t.starDensity));
    });
  }

  _buildComposer() {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // subtle glow only — enough to feel like a phosphor/vector display without
    // washing out the crisp wireframes
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), this.theme.bloom, 0.3, 0.12);
    this.bloomPass.enabled = this.theme.bloom > 0;
    this.composer.addPass(this.bloomPass);

    this.composer.addPass(new OutputPass());

    // 1-bit finish for monochrome styles (disabled passes are skipped, so the
    // OutputPass renders straight to screen when this is off)
    this.ditherPass = new ShaderPass(DitherShader);
    this.ditherPass.enabled = !!this.theme.dither;
    this.composer.addPass(this.ditherPass);
  }

  // ---- UI style ----

  /** Restyle the whole scene for a UI style (the `scene` half of a themes.js entry). */
  setTheme(theme) {
    this.theme = theme;
    this.scene.background.set(theme.background);
    this._fade.set(theme.fadeTo);

    this.resize(); // also re-derives the renderer resolution for this style

    this.bloomPass.strength = theme.bloom;
    this.bloomPass.enabled = theme.bloom > 0;
    this.ditherPass.enabled = !!theme.dither;
    this._styleStars();

    this._buildGrid();
    for (const m of this.comGroup.children) m.material.color.set(theme.com);
    this.comGroup.children[0].material.opacity = theme.comOpacity; // the crosshair (the cube is opaque)
    this.selectionBox.material.color.set(theme.select);
    this.selectionBox.material.opacity = theme.selectOpacity;

    this.fx.setTheme(theme);
    for (const v of this.bodyVisuals) {
      this._styleVisual(v);
      this._restyleLook(v); // the look's materials depend on the style, so build it afresh
    }
  }

  _inkFor(body) {
    return new THREE.Color(this.theme.ink ?? body.color);
  }

  // (Re)apply the current style's colours and blending to one body's trail, drop line and arrow.
  // (The body itself is its look, rebuilt by _restyleLook.)
  _styleVisual(v) {
    v.color = this._inkFor(v.body);
    const hex = v.color.getHex();
    v.trail.material.blending = this.theme.additive ? THREE.AdditiveBlending : THREE.MultiplyBlending;
    v.trail.material.needsUpdate = true;
    v.zline.material.color.copy(v.color);
    v.zline.material.opacity = this.theme.zOpacity;
    v.arrow.setColor(hex);
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

  /**
   * (Re)create the per-body visuals to match the current system bodies. `looks` is the app's array of
   * per-body look settings; the scene keeps a reference and reads it whenever a look is (re)built.
   */
  buildBodies(system, looks) {
    if (looks) this.looks = looks;
    for (const v of this.bodyVisuals) this._disposeVisual(v);
    for (const a of this.arrows) this.arrowGroup.remove(a);
    this.bodyVisuals = [];
    this.arrows = [];
    this.fx.clear();
    this.setSelected(-1);

    for (const [i, body] of system.bodies.entries()) {
      const color = this._inkFor(body);

      // The body is its look. coreNode carries the transform the old wireframe mesh had (position,
      // spin, scale = physics radius, updated per frame so live size edits are free); the look's unit
      // core sits inside it with an identity matrix. Decorations get their own, unspun node.
      const coreNode = new THREE.Group();
      const decoNode = new THREE.Group();
      const proxy = new THREE.Mesh(this._proxyGeo, this._proxyMat);
      proxy.userData.index = i;

      // trail: fixed-capacity buffer, drawn as a line whose vertex colour fades
      // from the body's ink at the head to the background colour at the tail
      // (additive on dark styles, multiply on light ones — see _styleVisual).
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
          dashSize: 1.4,
          gapSize: 1,
          depthWrite: false,
        })
      );
      zline.frustumCulled = false;

      this.scene.add(coreNode, decoNode, proxy, trail, zline);
      const { axis: spinAxis, rate: spinRate } = spinFor(i);
      const visual = {
        body, index: i, coreNode, decoNode, proxy, trail, zline, arrow, color, points: [],
        spinAxis, spinRate, spin: 0,
        spinQ: coreNode.quaternion, // the body's current spin (the surface camera rides it)
        look: null, ctx: makeLookContext(),
      };
      this._styleVisual(visual);
      this._raiseLook(visual);
      this.bodyVisuals.push(visual);
    }

    this.arrowGroup.visible = this.options.showVectors;

    // a new system invalidates the surface seat and the chase offset: re-seat / re-centre
    if (this.cam.view === 'surface') this._surfaceInit = true;
    this._camSettle = 40;
  }

  // ---- looks ----

  // Look settings for body `i`, defaulting if the app has not supplied any.
  _settingsFor(i) {
    return this.looks[i] || (this.looks[i] = defaultLook());
  }

  // Build body v's look from its settings and hang it on the scene graph.
  _raiseLook(v) {
    const look = createLook(this._settingsFor(v.index), {
      theme: this.theme, color: v.color, index: v.index, spinAxis: v.spinAxis,
    });
    v.look = look;
    v.coreNode.add(look.core);
    if (look.decorations) v.decoNode.add(look.decorations);
  }

  // Take body v's look down and free everything it allocated (geometries, materials, textures...).
  _dropLook(v) {
    if (!v.look) return;
    v.coreNode.remove(v.look.core);
    if (v.look.decorations) v.decoNode.remove(v.look.decorations);
    v.look.dispose();
    v.look = null;
  }

  _restyleLook(v) {
    this._dropLook(v);
    if (!v.body.ejected) this._raiseLook(v);
  }

  /** Rebuild body `index`'s look after its settings (this.looks[index]) changed. */
  setLook(index) {
    const v = this.bodyVisuals[index];
    if (v) this._restyleLook(v);
  }

  // Fill v's update context (copies only, so a look cannot reach back into the simulation).
  _fillContext(v, dt) {
    const c = v.ctx;
    const b = v.body;
    c.dt = dt;
    c.body.index = v.index;
    c.body.mass = b.mass; c.body.radius = b.radius;
    c.body.pos.copy(b.pos); c.body.vel.copy(b.vel);
    c.spinQ.copy(v.spinQ); c.spinAxis.copy(v.spinAxis); c.spinAngle = v.spin;
    let k = 0;
    for (const o of this.bodyVisuals) {
      if (o === v) continue;
      const slot = c.others[k] || (c.others[k] = makeOtherSlot());
      slot.index = o.index;
      slot.mass = o.body.mass; slot.radius = o.body.radius; slot.ejected = o.body.ejected;
      slot.pos.copy(o.body.pos); slot.vel.copy(o.body.vel);
      k++;
    }
    c.others.length = k;
    c.theme = this.theme;
    c.camera = this.camera;
  }

  _disposeVisual(v) {
    this._dropLook(v);
    this.scene.remove(v.coreNode, v.decoNode, v.proxy, v.trail, v.zline);
    v.trail.geometry.dispose();
    v.trail.material.dispose();
    v.zline.geometry.dispose();
    v.zline.material.dispose();
  }

  // ---- picking / selection ----

  /**
   * Pick the body under (localX, localY), relative to the canvas top-left, or -1. The ray is cast
   * against each body's invisible unit-sphere proxy, never its visible mesh or decorations, so a
   * thin or oddly shaped look is as easy to click as a ball. Each proxy is sized to the body's
   * physics radius, but never smaller than a forgiving patch of screen around it.
   */
  pickBody(localX, localY) {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this._ndc.set((localX / w) * 2 - 1, -(localY / h) * 2 + 1);
    this.raycaster.setFromCamera(this._ndc, this.camera);

    // world size of one screen pixel, per unit of distance from the camera
    const perPixel = (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / h;
    const targets = [];
    for (const v of this.bodyVisuals) {
      if (v.body.ejected) continue;
      const pixelWorld = perPixel * this.camera.position.distanceTo(v.body.pos);
      v.proxy.position.copy(v.body.pos);
      v.proxy.scale.setScalar(Math.max(PICK_MIN_PX * pixelWorld, v.body.radius + PICK_MARGIN_PX * pixelWorld));
      v.proxy.updateMatrixWorld(true);
      targets.push(v.proxy);
    }
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    return hit ? hit.object.userData.index : -1;
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
    // the body whose surface the camera is standing on: its own trail, drop line and
    // velocity arrow would all run through the camera, so they are left out of its view
    const ridden = this.cam.view === 'surface' ? this.bodyVisuals[this.cam.focus] : null;
    const dt = Math.min(this._spinClock.getDelta(), 0.1);

    for (const v of this.bodyVisuals) {
      const visible = !v.body.ejected;
      // a body merged away has its look freed; Reset brings the body back and so its look
      if (visible && !v.look) this._raiseLook(v);
      else if (!visible && v.look) this._dropLook(v);

      // standing on a body whose visible core would reach the camera: hide the core (the camera
      // itself stays seated at the physics sphere)
      const hideCore = v === ridden && v.look && v.look.coreReach > SURFACE_EYE;
      v.coreNode.visible = visible && !hideCore;
      v.decoNode.visible = visible;
      // cosmetic spin about the body's own axis; keeps going while the sim is paused (and a
      // surface camera turns with it, see _updateSurface)
      v.spin += v.spinRate * dt;
      v.spinQ.setFromAxisAngle(v.spinAxis, v.spin);
      if (visible) {
        v.coreNode.position.copy(v.body.pos);
        v.coreNode.scale.setScalar(v.body.radius);
        v.decoNode.position.copy(v.body.pos);
        v.decoNode.scale.setScalar(v.body.radius);
        if (v.look && v.look.update) {
          this._fillContext(v, dt);
          v.look.update(dt, v.ctx);
        }
      }

      // drop line from the body down to its projection on the xy plane
      const zl = v.zline;
      zl.visible = visible && this.options.showZLines && v !== ridden;
      if (zl.visible) {
        const p = zl.geometry.attributes.position.array;
        p[0] = v.body.pos.x; p[1] = v.body.pos.y; p[2] = v.body.pos.z;
        p[3] = v.body.pos.x; p[4] = v.body.pos.y; p[5] = 0;
        zl.geometry.attributes.position.needsUpdate = true;
        zl.computeLineDistances(); // keep dashes uniform as the height changes
      }

      this._updateTrailGeometry(v);
      v.trail.visible = v !== ridden;
    }

    // selection cage follows the selected body (not drawn around you while you stand on it)
    const sel = this.bodyVisuals[this.selectedIndex];
    const standingOn = this.cam.view === 'surface' && this.cam.focus === this.selectedIndex;
    this.selectionBox.visible = !!sel && !sel.body.ejected && !standingOn;
    if (this.selectionBox.visible) {
      this.selectionBox.position.copy(sel.body.pos);
      this.selectionBox.scale.setScalar(sel.body.radius * 2.6);
      this.selectionBox.rotation.y += 0.01;
      this.selectionBox.rotation.x += 0.006;
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
        if (v.body.ejected || speed < 1e-6 || v === ridden) {
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
    const fr = this._fade.r, fg = this._fade.g, fb = this._fade.b;
    // Ink styles fade by *displayed* brightness (mix in gamma space, then back to
    // linear) so the dithered tail thins out evenly instead of vanishing early.
    const gamma = this.theme.additive ? 1 : 2.2;
    const ease = this.theme.trailEase;
    const ig = 1 / gamma;
    const dr = Math.pow(r, ig), dg = Math.pow(g, ig), db = Math.pow(b, ig);
    const dfr = Math.pow(fr, ig), dfg = Math.pow(fg, ig), dfb = Math.pow(fb, ig);
    for (let k = 0; k < n; k++) {
      const p = pts[k];
      const o = k * 3;
      pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z;
      const t = n > 1 ? k / (n - 1) : 1; // 0 at tail -> 1 at head
      const f = Math.pow(t, ease); // ease so the fade hugs the head
      col[o] = Math.pow(dfr + (dr - dfr) * f, gamma);
      col[o + 1] = Math.pow(dfg + (dg - dfg) * f, gamma);
      col[o + 2] = Math.pow(dfb + (db - dfb) * f, gamma);
    }
    v.trail.geometry.setDrawRange(0, n);
    v.trail.geometry.attributes.position.needsUpdate = true;
    v.trail.geometry.attributes.color.needsUpdate = true;
  }

  /** Snap the backdrop grid to the camera target so it appears infinite. */
  _updateGrid() {
    // (the flat grid is edge-on, a smear of lines, when you stand in the orbital plane)
    this.grid.visible = this.options.showGrid && this.cam.view !== 'surface';
    if (!this.grid.visible) return;
    // Styles with `gridMinPx` coarsen the grid as the camera pulls back, so its lines never
    // crowd closer than that many pixels. A 1-bit display cannot draw a dense field of thin
    // lines cleanly: they merge into a black smear and shimmer as the camera moves.
    let cell = GRID_CELL;
    if (this.theme.gridMinPx) {
      const mult = this._gridMultiplier();
      this.grid.scale.setScalar(mult);
      cell = GRID_CELL * mult;
    }
    const t = this.controls.target;
    this.grid.position.set(Math.round(t.x / cell) * cell, Math.round(t.y / cell) * cell, 0);
  }

  // Cell-size multiplier (1-2-5 ladder) that keeps grid lines at least `gridMinPx` apart where
  // the camera is looking. Hysteresis so it doesn't flip back and forth at a boundary.
  _gridMultiplier() {
    const heightPx = this.renderer.domElement.height || 1;
    const dist = Math.max(this.camera.position.distanceTo(this.controls.target), 1e-3);
    const cellPx = (GRID_CELL * heightPx) / (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    const min = this.theme.gridMinPx;
    let lvl = this._gridLevel;
    while (lvl < GRID_LADDER.length - 1 && cellPx * GRID_LADDER[lvl] < min) lvl++;
    while (lvl > 0 && cellPx * GRID_LADDER[lvl - 1] >= min * 1.6) lvl--;
    this._gridLevel = lvl;
    return GRID_LADDER[lvl];
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
    // while standing on a surface this is the pose to return to when leaving it
    if (this.cam.view === 'surface') {
      this._savedPose = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    }
  }

  setBloom(strength) {
    this.bloomPass.strength = strength;
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return; // container hidden or collapsed
    // re-derived here (not just in setTheme) so a display-scale / browser-zoom change is picked up
    const pr = this._pixelRatioFor(this.theme);
    if (pr !== this.renderer.getPixelRatio()) {
      this.renderer.setPixelRatio(pr);
      this.composer.setPixelRatio(pr);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this._styleStars(); // star sizes are in whole render pixels, which depend on the pixel ratio
  }

  // ---- camera focus ----
  //
  // focus: 'free'  — the camera only moves when you move it.
  //        'com'   — locked on the centre of mass: the camera travels with it, keeping
  //                  whatever distance/angle you give it; drag to orbit, scroll to zoom.
  //        <index> — the same, locked on that body.
  // view:  'orbit'   — look at the focus from outside (all focus kinds).
  //        'surface' — (bodies only) stand on a random spot of the body's surface and
  //                    look out at the rest of the system; drag to look around.

  /** Set the camera focus and view; see above. A non-body focus always uses 'orbit'. */
  setCamera(focus, view = 'orbit') {
    if (!Number.isInteger(focus)) view = 'orbit';
    const prev = this.cam;
    const enteringSurface = view === 'surface' && prev.view !== 'surface';
    const leavingSurface = view !== 'surface' && prev.view === 'surface';

    if (enteringSurface) {
      this._savedPose = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    }
    if (leavingSurface && this._savedPose) {
      this.camera.position.copy(this._savedPose.pos);
      this.controls.target.copy(this._savedPose.target);
      this._savedPose = null;
    }

    this.cam = { focus, view };
    this._camSettle = 40;

    const surface = view === 'surface';
    this.camera.fov = surface ? SURFACE_FOV : BASE_FOV;
    this.camera.near = surface ? SURFACE_NEAR : 0.1;
    this.camera.updateProjectionMatrix();
    this.controls.enabled = !surface; // the surface view does its own look-around (_bindSurfaceLook)
    this.controls.enablePan = focus === 'free';
    if (!surface) this.camera.up.set(0, 1, 0); // the surface view tips "up" to the local zenith

    if (surface && (enteringSurface || prev.focus !== focus)) this.newSurfaceSpot();
    if (leavingSurface) this.controls.update();
  }

  /** Pick a new random spot on the surface of the focused body (surface view only). */
  newSurfaceSpot() {
    // uniform random direction on the unit sphere
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    this._spot.set(r * Math.cos(a), r * Math.sin(a), u);
    this._surfaceInit = true; // resolved against the live positions on the next frame
  }

  // Position of the nearest other active body into `out` (a point far down -z if there is
  // none). The nearest rather than the centroid, which can land in empty space between
  // bodies on opposite sides.
  _nearestOther(body, out) {
    let best = Infinity;
    for (const v of this.bodyVisuals) {
      if (v.body === body || v.body.ejected) continue;
      const d = v.body.pos.distanceToSquared(body.pos);
      if (d < best) { best = d; out.copy(v.body.pos); }
    }
    if (best === Infinity || best < 1e-9) out.copy(body.pos).z -= 100;
    return out;
  }

  // The focus point this frame, or null for a free camera. If the focused body has been
  // merged away / ejected, quietly fall back to the centre of mass and tell the UI.
  _focusPoint() {
    const { focus } = this.cam;
    if (focus === 'free') return null;
    if (focus === 'com') return this._com;
    const v = this.bodyVisuals[focus];
    if (v && !v.body.ejected) return v.body.pos;
    this.setCamera('com', 'orbit');
    if (this.onCameraChange) this.onCameraChange(this.cam);
    return this._com;
  }

  // Locked orbit: translate the camera and its pivot together by however far the focus has
  // moved, which preserves the user's distance and viewing angle exactly. For a few frames
  // after a focus change the pivot eases onto the new focus instead of jumping.
  _updateChase(anchor) {
    const k = this._camSettle > 0 ? 0.18 : 1;
    if (this._camSettle > 0) this._camSettle--;
    this._tmp.subVectors(anchor, this.controls.target).multiplyScalar(k);
    this.camera.position.add(this._tmp);
    this.controls.target.add(this._tmp);
    this.controls.update();
  }

  // Surface view: you are standing on the body. The camera is bolted to one point of its
  // surface (just above the ground) and "up" is the local zenith, straight away from the
  // body's centre. That point is fixed in the body's own spinning frame, so you ride both the
  // body's motion through the sim and its spin about its axis: the ground stays put under you
  // while the stars and the other bodies wheel across the sky, even with the sim paused. You
  // start looking straight up and can drag to look around, down to the ground and back up.
  _updateSurface(v) {
    const cam = this.camera;
    const body = v.body;
    const spin = v.spinQ; // the body's current spin (set in syncVisuals)

    if (this._surfaceInit) {
      this._surfaceInit = false;
      const other = this._nearestOther(body, this._tmp);
      // the random spot, mirrored into the half of the body that faces its nearest
      // neighbour, so the sky holds the sim rather than the far side of the body
      const toOther = this._tmp2.subVectors(other, body.pos).normalize();
      const n = this._surfaceN.copy(this._spot);
      const d = n.dot(toOther);
      if (d < 0) n.addScaledVector(toOther, -2 * d);
      n.normalize();
      // horizontal axes: e1 points toward that neighbour's bearing (so tilting down from straight
      // up sweeps toward it); e2 = n x e1 is to the left
      const e1 = this._surfaceE1.copy(toOther).addScaledVector(n, -toOther.dot(n));
      if (e1.lengthSq() < 1e-8) {
        e1.set(Math.abs(n.z) < 0.9 ? 0 : 1, 0, Math.abs(n.z) < 0.9 ? 1 : 0);
        e1.addScaledVector(n, -e1.dot(n));
      }
      e1.normalize();
      this._surfaceE2.crossVectors(n, e1);
      // pin the frame to the body: store it in the body's spinning coordinates
      this._qInv.copy(spin).invert();
      this._surfaceNL.copy(n).applyQuaternion(this._qInv);
      this._surfaceE1L.copy(e1).applyQuaternion(this._qInv);
      this._surfaceE2L.copy(this._surfaceE2).applyQuaternion(this._qInv);
      this._yaw = 0;
      this._pitch = SURFACE_MAX_PITCH;
    }

    // where the standing frame has spun to this frame
    const n = this._surfaceN.copy(this._surfaceNL).applyQuaternion(spin);
    this._surfaceE1.copy(this._surfaceE1L).applyQuaternion(spin);
    this._surfaceE2.copy(this._surfaceE2L).applyQuaternion(spin);
    const seat = this._tmp.copy(body.pos).addScaledVector(n, body.radius * SURFACE_EYE);
    const cp = Math.cos(this._pitch);
    const look = this._tmp2.set(0, 0, 0)
      .addScaledVector(this._surfaceE1, cp * Math.cos(this._yaw))
      .addScaledVector(this._surfaceE2, cp * Math.sin(this._yaw))
      .addScaledVector(n, Math.sin(this._pitch));

    cam.up.copy(n);
    cam.position.copy(seat);
    this.controls.target.copy(seat).add(look); // keep the orbit pivot sane for leaving the view
    cam.lookAt(this.controls.target);
  }

  // Drag-to-look for the surface view. "Grab the sky": a pixel of drag moves the image by a
  // pixel, so dragging right turns the view left. Yaw is unbounded; pitch stops at straight
  // up / straight down.
  _bindSurfaceLook() {
    const dom = this.renderer.domElement;
    let drag = null;
    dom.addEventListener('pointerdown', (e) => {
      if (this.cam.view !== 'surface' || e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { dom.setPointerCapture(e.pointerId); } catch { /* pointer already gone: drag still works while over the canvas */ }
    });
    dom.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const radiansPerPx = THREE.MathUtils.degToRad(this.camera.fov) / (this.container.clientHeight || 1);
      this._yaw += (e.clientX - drag.x) * radiansPerPx;
      this._pitch = THREE.MathUtils.clamp(
        this._pitch + (e.clientY - drag.y) * radiansPerPx, -SURFACE_MAX_PITCH, SURFACE_MAX_PITCH);
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    const end = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
  }

  render() {
    const anchor = this._focusPoint();
    if (!anchor) {
      this.controls.update();
    } else if (this.cam.view === 'surface') {
      this._updateSurface(this.bodyVisuals[this.cam.focus]);
    } else {
      this._updateChase(anchor);
    }

    this.stars.visible = this.options.showStars;
    this.stars.position.copy(this.camera.position); // keep the sky at infinity
    this._updateGrid();
    this.fx.update();
    this.composer.render();
  }
}
