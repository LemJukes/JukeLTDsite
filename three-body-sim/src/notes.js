// notes.js — the Lab Notebook's red-pen annotations.
//
// In the notebook style the picture is pencil on graph paper and everything *about* the picture is
// written over it in red ballpoint: a hand-drawn circle round the selected body, a crossed circle with
// "c.o.m." for the centre of mass, a letter and a short leader line beside each body, and a note
// ("impact!", "merge") where two bodies collide. These are marks on the page, not objects in the scene,
// so they are an SVG overlay above the canvas: never hidden behind a body, never dithered or lensed, and
// drawn in a real handwriting font. The 3D selection cage and centre-of-mass marker are hidden instead.
//
// Everything wobbles by a fixed seeded amount, so a mark looks hand-drawn and never shimmers.

import * as THREE from 'three';
import { mulberry32 } from './noise.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PEN_FONT = "'Reenie Beanie', 'Segoe Script', 'Bradley Hand', cursive";
const NOTE_LIFE = 2.2; // seconds an impact note stays on the page

const svgEl = (name, attrs = {}) => {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

// A closed-ish loop drawn by hand: a little over one turn, the radius wandering a few percent.
function scribbleLoop(r, seed, turns = 1.12) {
  const rand = mulberry32(seed);
  const N = 36;
  const start = rand() * Math.PI * 2;
  let d = '';
  for (let k = 0; k <= N; k++) {
    const a = start + (k / N) * Math.PI * 2 * turns;
    const rr = r * (1 + (rand() - 0.5) * 0.07 + (k / N) * 0.04);
    d += `${k ? 'L' : 'M'}${(rr * Math.cos(a)).toFixed(1)} ${(rr * Math.sin(a)).toFixed(1)}`;
  }
  return d;
}

// A short, slightly curved pen stroke from (x0, y0) to (x1, y1).
function penStroke(x0, y0, x1, y1, seed) {
  const rand = mulberry32(seed);
  const mx = (x0 + x1) / 2 + (rand() - 0.5) * 3;
  const my = (y0 + y1) / 2 + (rand() - 0.5) * 3;
  return `M${x0.toFixed(1)} ${y0.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

export class NotebookNotes {
  constructor(container) {
    this.container = container;
    this.svg = svgEl('svg', { class: 'notes', 'aria-hidden': 'true' });
    this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;display:none';
    container.appendChild(this.svg);
    this.active = false;
    this.color = '#c4262e';

    const pen = () => ({ fill: 'none', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    const label = (text, size) => {
      const t = svgEl('text', { 'font-family': PEN_FONT, 'font-size': size, 'text-anchor': 'start' });
      t.textContent = text;
      return t;
    };

    // centre of mass: a circle with a cross through it, and its name
    this.com = svgEl('g');
    this.com.append(
      svgEl('path', { ...pen(), d: scribbleLoop(9, 5) }),
      svgEl('path', { ...pen(), d: penStroke(-14, 0.5, 14, -0.5, 6) }),
      svgEl('path', { ...pen(), d: penStroke(0.5, -14, -0.5, 14, 7) }),
      Object.assign(label('c.o.m.', 20), {}),
    );
    this.com.lastChild.setAttribute('x', 13);
    this.com.lastChild.setAttribute('y', -9);

    // body letters with a short leader line each
    this.labels = [0, 1, 2].map((i) => {
      const g = svgEl('g');
      const leader = svgEl('path', { ...pen(), 'stroke-width': 1.6 });
      const t = label('ABC'[i], 26);
      g.append(leader, t);
      return { g, leader, t };
    });

    // the selected body: a hand-drawn circle round it
    this.select = svgEl('path', { ...pen(), 'stroke-width': 2.4 });
    this._selectR = -1;

    this.impacts = [];
    this.svg.append(this.com, ...this.labels.map((l) => l.g), this.select);
    this._p = new THREE.Vector3();
    this._q = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  /** Turn the overlay on (the style has `notes`) or off, and take its pen colour from the style. */
  setTheme(theme) {
    this.active = !!theme.notes;
    this.svg.style.display = this.active ? 'block' : 'none';
    this.color = '#' + new THREE.Color(theme.annot ?? 0xc4262e).getHexString(THREE.SRGBColorSpace);
    for (const e of this.svg.querySelectorAll('path')) e.setAttribute('stroke', this.color);
    for (const e of this.svg.querySelectorAll('text')) e.setAttribute('fill', this.color);
    if (!this.active) this.clear();
  }

  /** Write a note on the page where `point` (world space) is; it rises a little and fades. */
  addImpact(point, text) {
    if (!this.active || !text) return;
    const t = svgEl('text', { 'font-family': PEN_FONT, 'font-size': 30, fill: this.color, 'text-anchor': 'middle' });
    t.textContent = text;
    this.svg.appendChild(t);
    this.impacts.push({ el: t, point: point.clone(), born: performance.now() });
    if (this.impacts.length > 8) this.impacts.shift().el.remove();
  }

  clear() {
    for (const n of this.impacts) n.el.remove();
    this.impacts.length = 0;
  }

  // world point -> container pixels (null when behind the camera)
  _screen(camera, world, w, h, out = this._p) {
    out.copy(world).project(camera);
    if (out.z > 1) return null;
    out.set((out.x * 0.5 + 0.5) * w, (-out.y * 0.5 + 0.5) * h, 0);
    return out;
  }

  /** Redraw every mark for this frame. `sim` is the SimScene. */
  update(sim) {
    if (!this.active) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const cam = sim.camera;
    const ridden = sim.cam.view === 'surface' ? sim.bodyVisuals[sim.cam.focus] : null;
    this._right.setFromMatrixColumn(cam.matrixWorld, 0);

    const at = this._screen(cam, sim._com, w, h);
    this.com.style.display = at && sim.options.showCOM ? '' : 'none';
    if (at && sim.options.showCOM) this.com.setAttribute('transform', `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`);

    let selectShown = false;
    sim.bodyVisuals.forEach((v, i) => {
      const L = this.labels[i];
      const body = v.body;
      const show = !body.ejected && v !== ridden;
      const c = show ? this._screen(cam, body.pos, w, h) : null;
      if (!c) { L.g.style.display = 'none'; return; }
      const cx = c.x, cy = c.y;
      // body radius on screen, from a point one radius to the camera's right
      const e = this._screen(cam, this._q.copy(body.pos).addScaledVector(this._right, body.radius), w, h, this._q);
      const r = e ? Math.hypot(e.x - cx, e.y - cy) : 12;
      L.g.style.display = '';
      const off = 22 + r * 0.72;                     // up and to the right of the body
      L.g.setAttribute('transform', `translate(${cx.toFixed(1)} ${cy.toFixed(1)})`);
      L.leader.setAttribute('d', penStroke(r * 0.72 + 3, -(r * 0.72 + 3), off - 3, -off + 4, i + 11));
      L.t.setAttribute('x', off);
      L.t.setAttribute('y', -off + 2);

      if (i === sim.selectedIndex && sim.selectionVisible) {
        selectShown = true;
        const R = r + 11;
        if (Math.abs(R - this._selectR) > 1) {
          this.select.setAttribute('d', scribbleLoop(R, 77 + i));
          this._selectR = R;
        }
        this.select.setAttribute('transform', `translate(${cx.toFixed(1)} ${cy.toFixed(1)})`);
      }
    });
    this.select.style.display = selectShown ? '' : 'none';

    // impact notes
    const now = performance.now();
    for (let k = this.impacts.length - 1; k >= 0; k--) {
      const n = this.impacts[k];
      const age = (now - n.born) / 1000;
      if (age > NOTE_LIFE) { n.el.remove(); this.impacts.splice(k, 1); continue; }
      const p = this._screen(cam, n.point, w, h);
      if (!p) { n.el.style.display = 'none'; continue; }
      n.el.style.display = '';
      n.el.setAttribute('transform', `translate(${p.x.toFixed(1)} ${(p.y - 26 - age * 14).toFixed(1)}) rotate(-6)`);
      n.el.setAttribute('opacity', Math.max(0, Math.min(1, (NOTE_LIFE - age) / 0.8)).toFixed(2));
    }
  }
}
