// lens.js — gravitational lensing for black-hole looks, as a screen-space post pass.
//
// It runs straight after the scene render and before bloom / output / dither, so the 1-bit dither styles
// stipple the already-bent picture. Around each black hole it bends the background (stars, grid, trails,
// the far half of its own accretion disk) with the thin-lens mapping
//
//     source = r - w(r) * R_E^2 / r          (r = distance from the hole on screen)
//
// which crowds the sky into a ring just outside the hole's shadow. Where the mapping would land back on
// the hole (out to the critical radius r_c, where source = the horizon's edge) the picture is simply the
// shadow, a solid disc a little wider than the horizon, and a thin highlight ring sits just outside it.
// R_E grows with the hole's mass and w(r) fades the bending out with screen distance.
//
// Only what lies behind the hole is bent: the pass reads the scene depth (the composer's targets carry a
// depth texture), so a body or the near half of the disk passing in front stays sharp, and a sample is
// never taken from something nearer than the hole's centre.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const MAX_HOLES = 3;

const VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const FRAGMENT = /* glsl */`
  #include <packing>
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform float uNear;
  uniform float uFar;
  uniform float uAspect;     // width / height
  uniform float uPx;         // one pixel, in screen heights
  uniform vec2 uTexel;       // one pixel, in uv
  uniform float uAdditive;   // 1 = light-emitting style (ring adds light), 0 = ink (ring darkens)
  uniform vec3 uShadow;      // colour of the shadow disc
  uniform int uCount;
  uniform vec4 uA[${MAX_HOLES}];   // xy = hole centre (uv), z = horizon radius, w = Einstein radius (screen heights)
  uniform vec4 uB[${MAX_HOLES}];   // x = view distance of the hole's centre: anything nearer is in front of it
  varying vec2 vUv;

  float viewDist(vec2 uv) {
    return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
  }

  // true if nothing nearer than z sits under the bilinear footprint of a colour sample at uv, so a
  // thin foreground line next to the sample cannot bleed a ghost of itself into the bent sky
  bool clearOf(vec2 uv, float z) {
    vec2 h = 0.5 * uTexel;
    return viewDist(uv + vec2(h.x, h.y)) >= z && viewDist(uv + vec2(-h.x, h.y)) >= z
        && viewDist(uv + vec2(h.x, -h.y)) >= z && viewDist(uv + vec2(-h.x, -h.y)) >= z;
  }

  void main() {
    vec2 aspect = vec2(uAspect, 1.0);
    vec2 uv = vUv;
    bool bent = false;
    float ring = 0.0;
    float shadow = 0.0;
    for (int k = 0; k < ${MAX_HOLES}; k++) {
      if (k >= uCount) break;
      vec2 c = uA[k].xy;
      float rh = uA[k].z;
      float re = uA[k].w;
      float zFront = uB[k].x;
      float rc = 0.5 * (rh + sqrt(rh * rh + 4.0 * re * re));   // critical radius: the shadow's edge

      vec2 d = (uv - c) * aspect;
      float r = length(d);
      if (r > 6.0 * re) continue;                  // out of reach
      if (viewDist(uv) < zFront) continue;         // something in front of the hole stays sharp
      if (r < rc) { shadow = 1.0; break; }

      float w = 1.0 / (1.0 + (r * r) / (25.0 * re * re));
      float s = r - w * re * re / r;
      vec2 src = c + (d / r * s) / aspect;
      if (clearOf(src, zFront)) { uv = src; bent = true; }   // never pull a nearer object into the sky

      // thin highlight just outside the shadow
      float wr = max(1.5 * uPx, 0.02 * rc);
      float t = (length((vUv - c) * aspect) - rc * 1.08) / wr;
      ring = max(ring, exp(-t * t));
    }
    // an unbent pixel is copied exactly (filtering at a texel centre is only almost exact)
    vec4 col = bent ? texture2D(tDiffuse, uv) : texelFetch(tDiffuse, ivec2(gl_FragCoord.xy), 0);
    col.rgb = uAdditive > 0.5 ? col.rgb + vec3(0.95, 0.9, 0.75) * ring * 0.7 : col.rgb * (1.0 - ring);
    gl_FragColor = shadow > 0.5 ? vec4(uShadow, 1.0) : col;
  }`;

export class LensPass extends Pass {
  constructor() {
    super();
    this.needsSwap = true;
    this.enabled = false;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uNear: { value: 0.1 },
        uFar: { value: 50000 },
        uAspect: { value: 1 },
        uPx: { value: 0.001 },
        uTexel: { value: new THREE.Vector2(0.001, 0.001) },
        uAdditive: { value: 1 },
        uShadow: { value: new THREE.Color(0x000000) },
        uCount: { value: 0 },
        uA: { value: Array.from({ length: MAX_HOLES }, () => new THREE.Vector4()) },
        uB: { value: Array.from({ length: MAX_HOLES }, () => new THREE.Vector4()) },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  /**
   * Set this frame's holes: [{ u, v, horizon, einstein, zFront }] (uv centre, radii in screen heights,
   * zFront = view distance of the hole's centre: anything nearer is in front of it), and the style's
   * scene config (additive / inverse).
   * The pass switches itself off when there are no holes.
   */
  setHoles(holes, camera, theme) {
    const u = this.material.uniforms;
    u.uCount.value = holes.length;
    u.uAdditive.value = theme.additive ? 1 : 0;
    u.uShadow.value.set(theme.inverse ? theme.background : 0x000000); // black, or white where the page is inverted
    holes.forEach((h, i) => {
      u.uA.value[i].set(h.u, h.v, h.horizon, h.einstein);
      u.uB.value[i].set(h.zFront, 0, 0, 0);
    });
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uAspect.value = camera.aspect;
    this.enabled = holes.length > 0;
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.uPx.value = 1 / readBuffer.height;
    u.uTexel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
