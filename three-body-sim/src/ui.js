// ui.js — builds the CRT terminal control panel and wires it to the app.
//
// Pure DOM. It talks to a controller object (`app`, created in main.js) through a
// small command surface (play/pause/reset/loadPreset/selectBody/...) and pulls
// live numbers back each frame via app.getReadouts(). No Three.js or physics here.

import { presets, presetOrder, COLORS } from './presets.js';

// ---- tiny DOM helpers -------------------------------------------------------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.appendChild(c);
  return node;
}

// A panel section whose header collapses/expands its body when clicked.
function section(title, ...children) {
  const head = el('div', { class: 'section-title' }, [
    el('span', { class: 'section-arrow', text: '▾' }),
    el('span', { text: title }),
  ]);
  const body = el('div', { class: 'section-body' }, children);
  const sec = el('div', { class: 'section' }, [head, body]);
  head.addEventListener('click', () => sec.classList.toggle('collapsed'));
  return sec;
}

function button(label, onclick, extraClass = '', tip) {
  const b = el('button', { class: `btn ${extraClass}`.trim(), type: 'button', text: label, onclick });
  if (tip) b.setAttribute('data-tip', tip);
  return b;
}

function slider(label, { min, max, step, value, format = (v) => v.toFixed(2), tip }, oninput) {
  const out = el('span', { class: 'slider-val', text: format(value) });
  const input = el('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    out.textContent = format(v);
    oninput(v);
  });
  const row = el('label', { class: 'slider' }, [
    el('span', { class: 'slider-label' }, [el('span', { text: label }), out]),
    input,
  ]);
  if (tip) row.setAttribute('data-tip', tip);
  return { row, input, out, set: (v) => { input.value = v; out.textContent = format(v); } };
}

function toggle(label, checked, onchange, tip) {
  const box = el('span', { class: 'tgl-box' });
  const input = el('input', { type: 'checkbox' });
  input.checked = checked;
  input.addEventListener('change', () => onchange(input.checked));
  const node = el('label', { class: 'tgl' }, [input, box, el('span', { text: label })]);
  if (tip) node.setAttribute('data-tip', tip);
  return { node, input };
}

// A single floating tooltip, shown for any element (or ancestor) with [data-tip].
// Lives on <body> so the scrollable control panel never clips it, and is placed
// to the left of the hovered element (the panel hugs the right edge).
function setupTooltips() {
  const tip = el('div', { class: 'tip hidden' });
  document.body.appendChild(tip);
  let current = null;

  const place = (target) => {
    const text = target.getAttribute('data-tip');
    if (!text) return;
    tip.textContent = text;
    tip.classList.remove('hidden');
    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let left = r.left - t.width - 12;
    let top = r.top + r.height / 2 - t.height / 2;
    if (left < 8) { left = Math.min(r.left, window.innerWidth - t.width - 8); top = r.bottom + 8; }
    top = Math.max(8, Math.min(top, window.innerHeight - t.height - 8));
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = top + 'px';
  };

  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (t && t !== current) { current = t; place(t); }
  });
  document.addEventListener('mouseout', (e) => {
    const t = e.target.closest('[data-tip]');
    if (t && (!e.relatedTarget || !t.contains(e.relatedTarget))) { current = null; tip.classList.add('hidden'); }
  });
}

const hex = (c) => '#' + c.toString(16).padStart(6, '0');

// Trigger a client-side download of `text` as a file. Pure DOM + Blob: the data
// never leaves the browser, so there is no network/upload surface.
function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function suggestedFilename() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `three-body-${stamp}.json`;
}

// Make a user-typed name safe to use as a download filename: keep printable
// ASCII only, replace path separators / reserved characters, drop leading dots,
// cap the length, and guarantee a .json extension.
function sanitizeFilename(name) {
  let n = String(name).replace(/[^\x20-\x7E]/g, '').trim();
  n = n.replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '').slice(0, 100).trim();
  if (!n) n = suggestedFilename();
  if (!/\.json$/i.test(n)) n += '.json';
  return n;
}

// ---- main builder -----------------------------------------------------------

export function createUI(app) {
  const topbar = document.getElementById('topbar');
  const panel = document.getElementById('panel');

  // ---------- top bar ----------
  const statusPill = el('span', { class: 'status', text: 'PAUSED' });
  const fpsEl = el('span', { class: 'stat', text: 'FPS --' });
  const timeEl = el('span', { class: 'stat', text: 'T 0.0' });
  const helpBtn = el('button', { class: 'help-btn', type: 'button', text: '?', title: 'controls' });
  topbar.append(
    el('div', { class: 'brand' }, [
      el('span', { class: 'brand-mark', text: '◤◢' }),
      el('span', { text: 'THREE-BODY SIM' }),
      el('span', { class: 'brand-ver', text: 'v1.0' }),
    ]),
    el('div', { class: 'topstats' }, [statusPill, fpsEl, timeEl, helpBtn])
  );

  // ---------- help popover ----------
  const popover = el('div', { class: 'popover hidden' }, [
    el('div', { class: 'popover-title', text: 'CONTROLS' }),
    el('div', { class: 'popover-grid', html: `
      <span>drag</span><span>orbit camera</span>
      <span>scroll</span><span>zoom</span>
      <span>right-drag</span><span>pan</span>
      <span>click body</span><span>select &amp; edit</span>
      <span class="k">SPACE</span><span>play / pause</span>
      <span class="k">R</span><span>reset</span>
      <span class="k">S</span><span>step</span>
      <span class="k">N</span><span>random</span>
      <span class="k">F</span><span>frame all</span>
      <span class="k">T / G / V</span><span>trails / grid / velocity</span>
      <span class="k">ESC</span><span>deselect</span>
    ` }),
  ]);
  document.body.appendChild(popover);
  helpBtn.addEventListener('click', (e) => { e.stopPropagation(); popover.classList.toggle('hidden'); });
  document.addEventListener('click', (e) => {
    if (e.target !== helpBtn && !popover.contains(e.target)) popover.classList.add('hidden');
  });

  // ---------- sim control ----------
  const playBtn = button('▶ START', () => app.toggle(), 'btn-primary', 'Play or pause the simulation (Space)');
  panel.appendChild(
    section('SIM CONTROL',
      el('div', { class: 'btn-grid three' }, [
        playBtn,
        button('⏭ STEP', () => app.step(), '', 'Advance one step while paused (S)'),
        button('↺ RESET', () => app.reset(), '', "Return all bodies to the configuration's starting state (R)"),
      ])
    )
  );

  // ---------- presets ----------
  const presetTips = {
    default: 'Three equal bodies on an equilateral triangle — drifts into chaos',
    figure8: 'The famous stable figure-eight choreography (equal masses share one curve)',
    lagrange: 'Rotating equilateral triangle — a stable Lagrange configuration',
    binary: 'A tight heavy binary orbited by a distant lighter companion',
    random: 'Random masses, positions and velocities; camera auto-frames (N)',
    custom: 'Build your own — edit each body by hand',
  };
  const presetBtns = {};
  const presetRow = el('div', { class: 'btn-grid' });
  for (const id of presetOrder) {
    const b = button(presets[id].label, () => app.loadPreset(id), '', presetTips[id]);
    presetBtns[id] = b;
    presetRow.appendChild(b);
  }
  const customBtn = button('CUSTOM', () => app.enterCustom(), '', presetTips.custom);
  presetBtns.custom = customBtn;
  presetRow.appendChild(customBtn);
  panel.appendChild(section('CONFIGURATION', presetRow));

  // ---------- save / load ----------
  // Export downloads the current setup as JSON text; import reads a text file
  // back through app.importSetup(), which validates and sanitises every value
  // (see io.js) before it ever touches the simulation.
  const ioStatus = el('div', { class: 'io-status' });
  const setIoStatus = (msg, isError = false) => {
    ioStatus.textContent = msg;
    ioStatus.classList.toggle('error', isError);
  };

  const fileInput = el('input', {
    type: 'file',
    accept: '.json,.txt,application/json,text/plain',
    style: 'display:none',
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // reset so re-selecting the same file fires change again
    if (!file) return;
    if (file.size > 256 * 1024) { setIoStatus('That file is too large.', true); return; }
    const reader = new FileReader();
    reader.onerror = () => setIoStatus('Could not read that file.', true);
    reader.onload = () => {
      try {
        app.importSetup(String(reader.result));
        setIoStatus(`Loaded "${file.name}".`);
      } catch (err) {
        // io.js throws SetupError with a user-facing message; show it verbatim.
        setIoStatus(err && err.message ? err.message : 'Import failed.', true);
      }
    };
    reader.readAsText(file);
  });

  // Export reveals a small confirm form: a filename box (prefilled with a
  // suggested name the user can edit) plus SAVE / CANCEL. The download only
  // happens on SAVE, after the typed name is sanitised.
  const nameInput = el('input', { type: 'text', class: 'io-name', spellcheck: 'false', autocomplete: 'off' });
  const saveBtn = button('✓ SAVE', () => confirmExport(), 'btn-primary', 'Download the setup with this name');
  const cancelExportBtn = button('✕ CANCEL', () => hideExportForm(), '', 'Dismiss without saving');
  const exportForm = el('div', { class: 'io-form hidden' }, [
    el('label', { class: 'io-name-label', text: 'file name' }),
    nameInput,
    el('div', { class: 'btn-grid' }, [saveBtn, cancelExportBtn]),
  ]);

  const hideExportForm = () => exportForm.classList.add('hidden');
  const confirmExport = () => {
    try {
      const name = sanitizeFilename(nameInput.value);
      downloadText(app.exportSetup(), name);
      setIoStatus(`Saved "${name}".`);
    } catch {
      setIoStatus('Export failed.', true);
    }
    hideExportForm();
  };
  const showExportForm = () => {
    nameInput.value = suggestedFilename();
    setIoStatus('');
    exportForm.classList.remove('hidden');
    nameInput.focus();
    nameInput.select();
  };
  // Enter confirms, Escape cancels. The global key handler ignores INPUT targets,
  // so these don't double-fire sim shortcuts.
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmExport(); }
    else if (e.key === 'Escape') { e.preventDefault(); hideExportForm(); }
  });

  const exportBtn = button('⭳ EXPORT', () => showExportForm(), '', 'Save the current bodies and parameters to a text file');
  const importBtn = button('⭱ IMPORT', () => fileInput.click(), '', 'Load a setup from a previously exported text file');

  panel.appendChild(section('SAVE / LOAD',
    el('div', { class: 'btn-grid' }, [exportBtn, importBtn]),
    exportForm,
    fileInput,
    ioStatus,
  ));

  // ---------- selected-body editor (hidden until a body is selected) ----------
  let editIndex = 0;
  const editSel = {};
  const mk = (label, key, opts) => {
    const s = slider(label, opts, (v) => app.editCustom(editIndex, key, v));
    editSel[key] = s;
    return s.row;
  };
  const bodySelBtns = [];
  const bodySelRow = el('div', { class: 'btn-grid' });
  for (let i = 0; i < 3; i++) {
    const b = button(`BODY ${'ABC'[i]}`, () => app.selectBody(i), '', `Select & edit body ${'ABC'[i]}`);
    bodySelBtns.push(b);
    bodySelRow.appendChild(b);
  }
  const editTitle = el('div', { class: 'custom-body-title' });
  const editorBody = el('div', { class: 'custom-body' }, [
    editTitle,
    mk('mass', 'mass', { min: 0.1, max: 12, step: 0.1, value: 1, tip: 'Body mass — drives its gravity and how the others respond' }),
    mk('size', 'radius', { min: 0.4, max: 6, step: 0.1, value: 1, tip: 'Visual radius only — cosmetic, does not affect gravity' }),
    mk('pos x', 'px', { min: -40, max: 40, step: 0.5, value: 0, format: (v) => v.toFixed(1), tip: 'Starting position along the X axis' }),
    mk('pos y', 'py', { min: -40, max: 40, step: 0.5, value: 0, format: (v) => v.toFixed(1), tip: 'Starting position along the Y axis' }),
    mk('pos z', 'pz', { min: -40, max: 40, step: 0.5, value: 0, format: (v) => v.toFixed(1), tip: 'Starting position along the Z axis (depth)' }),
    mk('vel x', 'vx', { min: -1.5, max: 1.5, step: 0.01, value: 0, tip: 'Starting velocity along the X axis' }),
    mk('vel y', 'vy', { min: -1.5, max: 1.5, step: 0.01, value: 0, tip: 'Starting velocity along the Y axis' }),
    mk('vel z', 'vz', { min: -1.5, max: 1.5, step: 0.01, value: 0, tip: 'Starting velocity along the Z axis (depth)' }),
  ]);
  const editorHead = el('div', { class: 'section-title' }, [
    el('span', { class: 'section-arrow', text: '▾' }),
    el('span', { text: 'SELECTED BODY' }),
  ]);
  const editorSection = el('div', { class: 'section editor hidden' }, [
    editorHead,
    el('div', { class: 'section-body' }, [
      el('div', { class: 'editor-hint', text: 'click a body in the scene, or pick one:' }),
      bodySelRow,
      editorBody,
    ]),
  ]);
  editorHead.addEventListener('click', () => editorSection.classList.toggle('collapsed'));
  panel.appendChild(editorSection);

  // ---------- parameters ----------
  const speedS = slider('speed', { min: 0.05, max: 4, step: 0.05, value: app.state.speed, format: (v) => v.toFixed(2) + 'x', tip: 'How fast simulation time passes. Pure playback speed — does not change accuracy.' }, (v) => app.setSpeed(v));
  const qualS = slider('quality', { min: 1, max: 16, step: 1, value: app.state.substeps, format: (v) => v + ' sub', tip: 'Physics sub-steps per frame. Higher = smaller time steps = more accurate, but more CPU.' }, (v) => app.setSubsteps(v));
  const gravS = slider('gravity G', { min: 0, max: 4, step: 0.05, value: app.state.G, tip: 'Gravitational constant. Higher = stronger pull between all bodies.' }, (v) => app.setG(v));
  const softS = slider('softening', { min: 0.01, max: 3, step: 0.01, value: app.state.softening, tip: 'Softens gravity at very close range to prevent slingshot blow-ups. Larger = gentler near-collisions.' }, (v) => app.setSoftening(v));
  const trailS = slider('trail', { min: 0, max: 2000, step: 50, value: app.state.trailLength, format: (v) => (v | 0) + '', tip: 'Length of the fading orbital trail behind each body (number of points). 0 = off.' }, (v) => app.setTrailLength(v));
  panel.appendChild(section('PARAMETERS', speedS.row, qualS.row, gravS.row, softS.row, trailS.row));

  // ---------- display ----------
  const o = app.options;
  const toggleInputs = {};
  const tgl = (label, key, tip) => {
    const t = toggle(label, o[key], (v) => app.setOption(key, v), tip);
    toggleInputs[key] = t.input;
    return t.node;
  };
  panel.appendChild(
    section('DISPLAY',
      el('div', { class: 'tgl-grid' }, [
        tgl('grid', 'showGrid', 'Show/hide the background reference grid (G)'),
        tgl('center-of-mass', 'showCOM', "Show/hide the blue crosshair at the system's center of mass"),
        tgl('trails', 'showTrails', 'Show/hide the fading orbital trails (T)'),
        tgl('velocity', 'showVectors', "Show/hide arrows for each body's velocity — direction & speed (V)"),
      ])
    )
  );

  // ---------- camera ----------
  panel.appendChild(
    section('CAMERA',
      el('div', { class: 'tgl-grid' }, [
        tgl('follow COM', 'followCOM', 'Stay put but keep aiming at the center of mass as the system drifts. Combine with track COM.'),
        tgl('track COM', 'trackCOM', "Travel with the center of mass at the distance locked in when switched on — a tracking/dolly shot. Combine with follow COM."),
      ]),
      el('div', { class: 'btn-row' }, [button('⛶ FRAME ALL', () => app.frameAll(), '', 'Move the camera to fit all bodies in view (F)')])
    )
  );

  // ---------- readouts ----------
  const keEl = el('span', { class: 'ro-val', text: '0.00' });
  const peEl = el('span', { class: 'ro-val', text: '0.00' });
  const energyEl = el('span', { class: 'ro-val', text: '0.00' });
  const driftEl = el('span', { class: 'ro-val', text: '0.0000%' });
  const sepEl = el('span', { class: 'ro-val', text: '0.00' });
  const bodyBars = [];
  const barsWrap = el('div', { class: 'bars' });
  for (let i = 0; i < 3; i++) {
    const fill = el('span', { class: 'bar-fill', style: `background:${hex(COLORS[i])}` });
    const val = el('span', { class: 'bar-val', text: '0.00' });
    bodyBars.push({ fill, val });
    barsWrap.appendChild(
      el('div', { class: 'bar-row' }, [
        el('span', { class: 'bar-label', text: 'ABC'[i] }),
        el('span', { class: 'bar-track' }, [fill]),
        val,
      ])
    );
  }
  panel.appendChild(
    section('TELEMETRY',
      el('div', { class: 'ro-grid' }, [
        el('span', { class: 'ro-label', text: 'kinetic', 'data-tip': 'Total kinetic energy (energy of motion). Rises as bodies speed up.' }), keEl,
        el('span', { class: 'ro-label', text: 'potential', 'data-tip': 'Total gravitational potential energy. More negative when bodies are closer.' }), peEl,
        el('span', { class: 'ro-label', text: 'total', 'data-tip': 'Kinetic + potential. Should stay nearly constant — the integrator conserves energy.' }), energyEl,
        el('span', { class: 'ro-label', text: 'drift', 'data-tip': 'How far total energy has strayed from its start. Tiny = faithful; grows on violent close passes.' }), driftEl,
        el('span', { class: 'ro-label', text: 'min sep', 'data-tip': 'Closest center-to-center distance between any two bodies right now.' }), sepEl,
      ]),
      el('div', { class: 'ro-sub', text: 'body speed' }),
      barsWrap
    )
  );

  setupTooltips();

  // ---------- keyboard ----------
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    switch (e.key.toLowerCase()) {
      case ' ': e.preventDefault(); app.toggle(); break;
      case 'r': app.reset(); break;
      case 's': app.step(); break;
      case 'n': app.random(); break;
      case 'f': app.frameAll(); break;
      case 't': app.toggleOption('showTrails'); break;
      case 'g': app.toggleOption('showGrid'); break;
      case 'v': app.toggleOption('showVectors'); break;
      case 'escape': app.deselect(); popover.classList.add('hidden'); break;
    }
  });

  // ---------- API back to main ----------
  let maxSpeed = 1;
  return {
    setActivePreset(id) {
      for (const [k, b] of Object.entries(presetBtns)) b.classList.toggle('active', k === id);
    },
    showBodyEditor(i, cfg) {
      editIndex = i;
      editTitle.innerHTML = `<span class="swatch" style="background:${hex(COLORS[i])}"></span>BODY ${'ABC'[i]}`;
      editSel.mass.set(cfg.mass); editSel.radius.set(cfg.radius);
      editSel.px.set(cfg.pos.x); editSel.py.set(cfg.pos.y); editSel.pz.set(cfg.pos.z);
      editSel.vx.set(cfg.vel.x); editSel.vy.set(cfg.vel.y); editSel.vz.set(cfg.vel.z);
      bodySelBtns.forEach((b, k) => b.classList.toggle('active', k === i));
      editorSection.classList.remove('hidden');
    },
    hideBodyEditor() {
      editorSection.classList.add('hidden');
      bodySelBtns.forEach((b) => b.classList.remove('active'));
    },
    // reflect external state into the slider widgets (e.g. presets change G/softening)
    syncParams() {
      gravS.set(app.state.G);
      softS.set(app.state.softening);
      trailS.set(app.state.trailLength);
      speedS.set(app.state.speed);
      qualS.set(app.state.substeps);
    },
    syncToggles() {
      for (const [k, input] of Object.entries(toggleInputs)) input.checked = !!app.options[k];
    },
    update() {
      const r = app.getReadouts();
      statusPill.textContent = r.running ? 'RUNNING' : 'PAUSED';
      statusPill.classList.toggle('on', r.running);
      playBtn.textContent = r.running ? '⏸ PAUSE' : '▶ START';
      fpsEl.textContent = 'FPS ' + r.fps.toFixed(0);
      timeEl.textContent = 'T ' + r.time.toFixed(1);
      keEl.textContent = r.ke.toFixed(3);
      peEl.textContent = r.pe.toFixed(3);
      energyEl.textContent = r.energy.toFixed(3);
      driftEl.textContent = (r.drift * 100).toFixed(4) + '%';
      driftEl.classList.toggle('warn', Math.abs(r.drift) > 0.05);
      sepEl.textContent = r.minSep.toFixed(2);
      maxSpeed = Math.max(maxSpeed * 0.995, ...r.speeds, 0.01);
      for (let i = 0; i < bodyBars.length; i++) {
        const sp = r.speeds[i] ?? 0;
        bodyBars[i].fill.style.width = Math.min(100, (sp / maxSpeed) * 100) + '%';
        bodyBars[i].val.textContent = r.ejected[i] ? 'EJECT' : sp.toFixed(2);
      }
    },
  };
}
