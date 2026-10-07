// ui.js — builds the CRT terminal control panel and wires it to the app.
//
// Pure DOM. It talks to a controller object (`app`, created in main.js) through a
// small command surface (play/pause/reset/loadPreset/selectBody/...) and pulls
// live numbers back each frame via app.getReadouts(). No Three.js or physics here
// (only the plain-data look and shape tables are imported, to label the controls).

import { presets, presetOrder, COLORS } from './presets.js';
import { THEMES, themeOrder } from './themes.js';
import { hasIcon, iconSvg } from './icons.js';
import { LOOKS, lookOrder } from './bodyLooks.js';
import { SHAPE_STOPS, DICE_MAX, stopFor } from './shapes.js';

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

// Button labels are written in Title Case and may start with a symbol ("▶ Start").
// The symbol is swapped for a pixel icon (icons.js) in its own span, so it looks the same in
// every style whatever the font has; the CRT style upper-cases the text with CSS.
function setButtonLabel(b, label) {
  b.textContent = '';
  if (label[1] === ' ' && hasIcon(label[0])) {
    const ic = el('span', { class: 'ic' });
    ic.innerHTML = iconSvg(label[0]); // static markup from icons.js, no user input
    b.append(ic, ' ', label.slice(2));
  } else {
    b.textContent = label;
  }
}

function button(label, onclick, extraClass = '', tip) {
  const b = el('button', { class: `btn ${extraClass}`.trim(), type: 'button', onclick });
  setButtonLabel(b, label);
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

// A popup menu (a dropdown): a button showing the current choice that opens a list of options.
// It is built from plain elements rather than a native <select>, because the OS draws a select's list
// and no UI style could skin it (the 1-bit Mac look needs a menu drawn in black and white). Like the
// tooltip, the list is mounted on <body> so the scrolling control panel never clips it.
//   keyboard: Down/Up on the button open it; in the list Up/Down/Home/End move, Enter or Space picks,
//   Esc closes, typing jumps to a matching option.
// options: [{ id, label, tip }]
let menuCount = 0;
function popupMenu(label, options, value, onchange, tip) {
  const listId = `menu-list-${++menuCount}`;
  const text = el('span', { class: 'menu-text' });
  const trigger = el('button', {
    class: 'menu-btn', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': listId,
  }, [text, el('span', { class: 'menu-caret', 'aria-hidden': 'true' })]);
  const list = el('ul', { class: 'menu-list hidden', id: listId, role: 'listbox', tabindex: '-1' });
  const items = options.map((o, i) => {
    const li = el('li', { class: 'menu-item', role: 'option', id: `${listId}-${i}`, text: o.label });
    if (o.tip) li.setAttribute('data-tip', o.tip);
    li.addEventListener('click', () => choose(i));
    li.addEventListener('pointermove', () => highlight(i));
    list.appendChild(li);
    return li;
  });
  document.body.appendChild(list);

  let current = options.findIndex((o) => o.id === value);
  if (current < 0) current = 0;
  let active = current;
  let isOpen = false;
  let typed = '';
  let typedAt = 0;

  const render = () => {
    text.textContent = options[current].label;
    items.forEach((li, i) => li.setAttribute('aria-selected', String(i === current)));
  };
  const highlight = (i) => {
    active = (i + options.length) % options.length;
    items.forEach((li, k) => li.classList.toggle('active', k === active));
    list.setAttribute('aria-activedescendant', items[active].id);
    // keep the highlight inside a scrolling list (not scrollIntoView, which can scroll the page behind it)
    const top = items[active].offsetTop;
    const bottom = top + items[active].offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  };
  const place = () => {
    const r = trigger.getBoundingClientRect();
    list.style.minWidth = r.width + 'px';
    list.style.left = r.left + 'px';
    const h = list.offsetHeight;
    // below the button, or above it when there is no room
    const top = r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 2) : r.bottom + 2;
    list.style.top = top + 'px';
  };
  const scroller = document.getElementById('panel-body'); // the list closes if the panel scrolls under it
  const onOutside = (e) => { if (!list.contains(e.target) && !trigger.contains(e.target)) close(false); };
  const onScroll = () => close(false);
  function open() {
    if (isOpen) return;
    isOpen = true;
    list.classList.remove('hidden');
    place();
    highlight(current);
    trigger.setAttribute('aria-expanded', 'true');
    list.focus({ preventScroll: true });
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', onScroll);
    scroller.addEventListener('scroll', onScroll);
  }
  function close(refocus = true) {
    if (!isOpen) return;
    isOpen = false;
    list.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', onScroll);
    scroller.removeEventListener('scroll', onScroll);
    if (refocus) trigger.focus({ preventScroll: true });
  }
  function choose(i) {
    const changed = i !== current;
    current = i;
    render();
    close();
    if (changed) onchange(options[i].id);
  }

  // if focus leaves the open list (for anywhere but its own button) the menu closes, so it never sits
  // open while its keys go elsewhere
  list.addEventListener('focusout', (e) => {
    if (isOpen && !list.contains(e.relatedTarget) && e.relatedTarget !== trigger) close(false);
  });
  trigger.addEventListener('click', () => (isOpen ? close() : open()));
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
  });
  list.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowDown') highlight(active + 1);
    else if (k === 'ArrowUp') highlight(active - 1);
    else if (k === 'Home') highlight(0);
    else if (k === 'End') highlight(options.length - 1);
    else if (k === 'Enter' || k === ' ') choose(active);
    else if (k === 'Escape') close();
    else if (k === 'Tab') { close(false); return; }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = performance.now();
      typed = now - typedAt < 700 ? typed + k.toLowerCase() : k.toLowerCase();
      typedAt = now;
      const from = typed.length === 1 ? active + 1 : active; // repeating one letter steps through its matches
      for (let n = 0; n < options.length; n++) {
        const i = (from + n) % options.length;
        if (options[i].label.toLowerCase().startsWith(typed)) { highlight(i); break; }
      }
    } else return;
    e.preventDefault();
  });

  render();
  const row = el('div', { class: 'menu-row' }, [el('span', { class: 'menu-label', text: label }), trigger]);
  if (tip) row.setAttribute('data-tip', tip);
  return { row, set(id) { const i = options.findIndex((o) => o.id === id); if (i >= 0) { current = i; render(); } } };
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
    let side = 'left';
    if (left < 8) { left = Math.min(r.left, window.innerWidth - t.width - 8); top = r.bottom + 8; side = 'below'; }
    top = Math.max(8, Math.min(top, window.innerHeight - t.height - 8));
    tip.dataset.side = side; // lets a style point a speech-balloon tail at the target
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
  // the scrolling area of the control panel (the window chrome around it is static markup)
  const panel = document.getElementById('panel-body');
  const sceneTitle = document.getElementById('scene-title-text');

  // ---------- top bar ----------
  const statusPill = el('span', { class: 'status', text: 'Paused' });
  const fpsEl = el('span', { class: 'stat', text: 'FPS --' });
  const timeEl = el('span', { class: 'stat', text: 'T 0.0' });
  const helpBtn = el('button', { class: 'help-btn', type: 'button', text: '?', title: 'controls' });
  topbar.append(
    el('div', { class: 'brand' }, [
      el('span', { class: 'brand-mark', text: '◤◢' }),
      el('span', { class: 'brand-name', text: 'Three-Body Sim' }),
      el('span', { class: 'brand-ver', text: 'v1.27' }),
    ]),
    el('div', { class: 'topstats' }, [statusPill, fpsEl, timeEl, helpBtn])
  );

  // ---------- help popover ----------
  const popover = el('div', { class: 'popover hidden' }, [
    el('div', { class: 'popover-title' }, [el('span', { class: 'win-title-text', text: 'Controls' })]),
    el('div', { class: 'popover-grid', html: `
      <span>Drag</span><span>Orbit camera</span>
      <span>Scroll</span><span>Zoom</span>
      <span>Right-drag</span><span>Pan</span>
      <span>Click body</span><span>Select &amp; edit</span>
      <span class="k">SPACE</span><span>Play / pause</span>
      <span class="k">R</span><span>Reset</span>
      <span class="k">S</span><span>Step</span>
      <span class="k">N</span><span>Random</span>
      <span class="k">F</span><span>Frame all</span>
      <span class="k">T / G / V</span><span>Trails / grid / velocity</span>
      <span class="k">Z</span><span>Z-height lines</span>
      <span class="k">B</span><span>Stars</span>
      <span class="k">C</span><span>Cycle collisions</span>
      <span class="k">0 – 4</span><span>Camera: free / A / B / C / COM</span>
      <span class="k">P</span><span>Ride the body (surface view)</span>
      <span class="k">U</span><span>Cycle UI style</span>
      <span class="k">ESC</span><span>Deselect</span>
    ` }),
  ]);
  document.body.appendChild(popover);
  helpBtn.addEventListener('click', (e) => { e.stopPropagation(); popover.classList.toggle('hidden'); });
  document.addEventListener('click', (e) => {
    if (e.target !== helpBtn && !popover.contains(e.target)) popover.classList.add('hidden');
  });

  // ---------- sim control ----------
  const playBtn = button('▶ Start', () => app.toggle(), 'btn-primary', 'Play or pause the simulation (Space)');
  panel.appendChild(
    section('Sim Control',
      el('div', { class: 'btn-grid three' }, [
        playBtn,
        button('⏭ Step', () => app.step(), '', 'Step the simulation forward one tick, then hold (S)'),
        button('↺ Reset', () => app.reset(), '', "Return all bodies to the configuration's starting state (R)"),
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
  const customBtn = button('Custom', () => app.enterCustom(), '', presetTips.custom);
  presetBtns.custom = customBtn;
  presetRow.appendChild(customBtn);
  panel.appendChild(section('Configuration', presetRow));

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
  const saveBtn = button('✓ Save', () => confirmExport(), 'btn-primary', 'Download the setup with this name');
  const cancelExportBtn = button('✕ Cancel', () => hideExportForm(), '', 'Dismiss without saving');
  const exportForm = el('div', { class: 'io-form hidden' }, [
    el('label', { class: 'io-name-label', text: 'File name' }),
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

  const exportBtn = button('⭱ Export', () => showExportForm(), '', 'Save the current bodies and parameters to a text file');
  const importBtn = button('⭳ Import', () => fileInput.click(), '', 'Load a setup from a previously exported text file');

  panel.appendChild(section('Save / Load',
    el('div', { class: 'btn-grid' }, [importBtn, exportBtn]),
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
    const b = button(`Body ${'ABC'[i]}`, () => app.selectBody(i), '', `Select & edit body ${'ABC'[i]}`);
    bodySelBtns.push(b);
    bodySelRow.appendChild(b);
  }
  const editTitle = el('div', { class: 'custom-body-title' });
  const editorBody = el('div', { class: 'custom-body' }, [
    editTitle,
    mk('Mass', 'mass', { min: 0.1, max: 12, step: 0.1, value: 1, tip: 'Body mass — drives its gravity and how the others respond' }),
    mk('Size', 'radius', { min: 0.4, max: 6, step: 0.1, value: 1, tip: 'Visual radius only — cosmetic, does not affect gravity' }),
    mk('Pos X', 'px', { min: -40, max: 40, step: 0.5, value: 0, format: (v) => v.toFixed(1), tip: 'Starting position along the X axis' }),
    mk('Pos Y', 'py', { min: -40, max: 40, step: 0.5, value: 0, format: (v) => v.toFixed(1), tip: 'Starting position along the Y axis' }),
    mk('Pos Z', 'pz', { min: -40, max: 40, step: 0.5, value: 0, format: (v) => v.toFixed(1), tip: 'Starting position along the Z axis (depth)' }),
    mk('Vel X', 'vx', { min: -1.5, max: 1.5, step: 0.01, value: 0, tip: 'Starting velocity along the X axis' }),
    mk('Vel Y', 'vy', { min: -1.5, max: 1.5, step: 0.01, value: 0, tip: 'Starting velocity along the Y axis' }),
    mk('Vel Z', 'vz', { min: -1.5, max: 1.5, step: 0.01, value: 0, tip: 'Starting velocity along the Z axis (depth)' }),
  ]);
  // ---- look: what the selected body looks like (cosmetic only, never touches the simulation) ----
  const SHAPE_TIP = 'Shape of the round body. Snaps to fixed stops: the dice solids, then geodesic spheres, then a smooth ball. Cosmetic only.';
  const DICE_TIP = 'Number the faces like a real die: opposite faces add up to one more than the face count (d4 is read at the corners, d10 runs 0-9).';
  const shapeS = slider('Shape', { min: 0, max: 100, step: 10, value: 60, format: (v) => stopFor(v).short, tip: SHAPE_TIP },
    (v) => app.setLook(editIndex, { shape: v }));
  shapeS.row.classList.add('stops-slider');
  const shapeCaption = el('div', { class: 'shape-caption' });
  shapeS.row.append(
    el('div', { class: 'stops', 'aria-hidden': 'true' }, SHAPE_STOPS.map(() => el('span'))),
    shapeCaption,
  );
  const diceT = toggle('Dice faces', false, (v) => app.setLook(editIndex, { dice: v }), DICE_TIP);
  const objectM = popupMenu('Object', lookOrder.map((id) => ({ id, label: LOOKS[id].label, tip: LOOKS[id].tip })), 'body',
    (id) => app.setLook(editIndex, { object: id }),
    'What this body looks like. Purely cosmetic: its mass, size and gravity do not change.');
  const lookBox = el('div', { class: 'custom-body look-box' }, [
    el('div', { class: 'custom-body-title', text: 'Look' }),
    objectM.row,
    shapeS.row,
    diceT.node,
  ]);

  // Show the selected body's look in the controls, greying out what does not apply to it.
  function syncLook() {
    const look = app.looks[editIndex];
    const def = LOOKS[look.object];
    const stop = stopFor(look.shape);
    objectM.set(look.object);
    shapeS.set(look.shape);
    shapeCaption.textContent = [stop.label, stop.die, stop.faces].filter(Boolean).join(' · ');
    const hasShape = def.usesDetail;
    shapeS.input.disabled = !hasShape;
    shapeS.row.classList.toggle('disabled', !hasShape);
    shapeS.row.setAttribute('data-tip', hasShape ? SHAPE_TIP : `The ${def.label} look has a fixed shape, so there is nothing to choose.`);
    const diceOk = hasShape && !def.noDice && stop.value <= DICE_MAX;
    diceT.input.checked = !!look.dice;
    diceT.input.disabled = !diceOk;
    diceT.node.classList.toggle('disabled', !diceOk);
    diceT.node.setAttribute('data-tip', diceOk ? DICE_TIP
      : hasShape && !def.noDice ? 'Dice faces need a flat-faced shape: tetrahedron through icosahedron.'
        : `The ${def.label} look has no flat faces to number.`);
  }

  const editorHead = el('div', { class: 'section-title' }, [
    el('span', { class: 'section-arrow', text: '▾' }),
    el('span', { text: 'Selected Body' }),
  ]);
  const editorSection = el('div', { class: 'section editor hidden' }, [
    editorHead,
    el('div', { class: 'section-body' }, [
      el('div', { class: 'editor-hint', text: 'Click a body in the scene, or pick one:' }),
      bodySelRow,
      editorBody,
      lookBox,
    ]),
  ]);
  editorHead.addEventListener('click', () => editorSection.classList.toggle('collapsed'));
  panel.appendChild(editorSection);

  // ---------- parameters ----------
  const speedS = slider('Speed', { min: 0.05, max: 4, step: 0.05, value: app.state.speed, format: (v) => v.toFixed(2) + 'x', tip: 'How fast simulation time passes. Pure playback speed — does not change accuracy.' }, (v) => app.setSpeed(v));
  const qualS = slider('Quality', { min: 1, max: 16, step: 1, value: app.state.substeps, format: (v) => v + ' sub', tip: 'Physics sub-steps per frame. Higher = smaller time steps = more accurate, but more CPU.' }, (v) => app.setSubsteps(v));
  const gravS = slider('Gravity G', { min: 0, max: 4, step: 0.05, value: app.state.G, tip: 'Gravitational constant. Higher = stronger pull between all bodies.' }, (v) => app.setG(v));
  const softS = slider('Softening', { min: 0.01, max: 3, step: 0.01, value: app.state.softening, tip: 'Softens gravity at very close range to prevent slingshot blow-ups. Larger = gentler near-collisions.' }, (v) => app.setSoftening(v));
  const trailS = slider('Trail', { min: 0, max: 2000, step: 50, value: app.state.trailLength, format: (v) => (v | 0) + '', tip: 'Length of the fading orbital trail behind each body (number of points). 0 = off.' }, (v) => app.setTrailLength(v));
  panel.appendChild(section('Parameters', speedS.row, qualS.row, gravS.row, softS.row, trailS.row));

  // ---------- collisions ----------
  // Mode selector (OFF / MERGE / BOUNCE) + restitution, plus a live report of the
  // most recent impact: who hit whom, how fast, and how violent versus the
  // bodies' own gravitational binding energy.
  const collModeBtns = {};
  const collModeDefs = [
    ['off', 'Off', 'Bodies pass straight through each other — pure point-mass gravity'],
    ['merge', 'Merge', 'On contact, bodies coalesce into one. Momentum and mass conserved.'],
    ['bounce', 'Bounce', 'On contact, bodies rebound as solid spheres (see restitution).'],
  ];
  const collModeRow = el('div', { class: 'btn-grid three' });
  for (const [id, label, tip] of collModeDefs) {
    const b = button(label, () => app.setCollisionMode(id), '', tip);
    collModeBtns[id] = b;
    collModeRow.appendChild(b);
  }
  const restS = slider('Restitution', { min: 0, max: 1, step: 0.05, value: app.state.restitution, tip: 'Bounciness in BOUNCE mode: 0 = fully inelastic (sticky), 1 = perfectly elastic. Below 1 the impact bleeds off energy.' }, (v) => app.setRestitution(v));

  // impact class is styled per UI style via [data-sev] (see styles.css / themes/)
  const impClass = el('span', { class: 'ro-val caps', text: '—' });
  const impPair = el('span', { class: 'ro-val', text: '—' });
  const impSpeed = el('span', { class: 'ro-val', text: '—' });
  const impEnergy = el('span', { class: 'ro-val', text: '—' });
  const impSeverity = el('span', { class: 'ro-val', text: '—' });
  panel.appendChild(section('Collisions',
    collModeRow,
    restS.row,
    el('div', { class: 'ro-sub', text: 'Last impact' }),
    el('div', { class: 'ro-grid' }, [
      el('span', { class: 'ro-label', text: 'Class', 'data-tip': 'Impact severity: MERGE (would gently accrete), DISRUPTION (a violent graze), or CATASTROPHIC (a body-shattering smash).' }), impClass,
      el('span', { class: 'ro-label', text: 'Bodies', 'data-tip': 'The two bodies involved in the most recent impact.' }), impPair,
      el('span', { class: 'ro-label', text: 'Rel speed', 'data-tip': 'Relative speed of the two bodies at the moment of contact.' }), impSpeed,
      el('span', { class: 'ro-label', text: 'Impact E', 'data-tip': 'Kinetic energy of the relative motion at contact (½·μ·v²) — the energy available to do damage.' }), impEnergy,
      el('span', { class: 'ro-label', text: 'Vs binding', 'data-tip': 'Impact energy as a multiple of the merged body’s gravitational binding energy. Above ~1 it can disrupt; above ~10 it shatters.' }), impSeverity,
    ])
  ));

  // ---------- display ----------
  const o = app.options;
  const toggleInputs = {};
  const tgl = (label, key, tip) => {
    const t = toggle(label, o[key], (v) => app.setOption(key, v), tip);
    toggleInputs[key] = t.input;
    return t.node;
  };
  panel.appendChild(
    section('Display',
      el('div', { class: 'tgl-grid' }, [
        tgl('Grid', 'showGrid', 'Show/hide the background reference grid (G)'),
        tgl('Center of mass', 'showCOM', "Show/hide the crosshair at the system's center of mass"),
        tgl('Trails', 'showTrails', 'Show/hide the fading orbital trails (T)'),
        tgl('Velocity', 'showVectors', "Show/hide arrows for each body's velocity — direction & speed (V)"),
        tgl('Stars', 'showStars', 'Show/hide the background star field (B)'),
        tgl('Z-height', 'showZLines', 'Show/hide vertical drop lines from each body to the xy plane — reveals height above/below the grid (Z)'),
      ])
    )
  );

  // ---------- UI style ----------
  // Purely cosmetic: swaps the CSS skin and the 3D scene's look (app.setTheme).
  const themeBtns = {};
  const themeRow = el('div', { class: 'btn-grid span-first' });
  for (const id of themeOrder) {
    const b = button(THEMES[id].label, () => app.setTheme(id), '', THEMES[id].tip);
    themeBtns[id] = b;
    themeRow.appendChild(b);
  }
  panel.appendChild(section('UI Style', themeRow));

  // ---------- camera ----------
  // The camera locks onto something (the center of mass or one body) and travels with it, or
  // stays free. A locked body can also be viewed from its own surface. The hint line under the
  // buttons always spells out what the current choice does and how to drive it.
  const camBtns = {};
  const camBtn = (key, label, tip, onclick) => {
    camBtns[key] = button(label, onclick, '', tip);
    return camBtns[key];
  };
  const bodyName = (i) => `Body ${'ABC'[i]}`;
  const camTop = el('div', { class: 'btn-grid' }, [
    camBtn('free', 'Free', 'Camera stays where you put it. Drag to orbit, scroll to zoom, right-drag to pan. (0)', () => app.setCameraFocus('free')),
    camBtn('com', 'Center of Mass', 'Lock onto the center of mass and travel with it. Drag to orbit around it, scroll to zoom. (4)', () => app.setCameraFocus('com')),
  ]);
  const camBodies = el('div', { class: 'btn-grid three cam-row' }, [0, 1, 2].map((i) =>
    camBtn(`body${i}`, bodyName(i), `Lock onto ${bodyName(i)} and travel with it. Drag to orbit around it, scroll to zoom. (${i + 1})`, () => app.setCameraFocus(i))
  ));
  const spotBtn = button('⚄ New Spot', () => app.newSurfaceSpot(), '', 'Jump to a different random spot on the same body’s surface');
  const camView = el('div', { class: 'cam-opts hidden' }, [
    el('div', { class: 'ro-sub', text: 'View from' }),
    el('div', { class: 'btn-grid' }, [
      camBtn('orbit', 'Orbit', 'Orbit around the body, looking at it from outside', () => app.setCameraView('orbit')),
      camBtn('surface', 'Surface', 'Stand on the body’s surface at a random spot and look out at the rest of the sim. Drag to look around. (P)', () => app.setCameraView('surface')),
    ]),
    el('div', { class: 'cam-spot hidden' }, [spotBtn]),
  ]);
  const camHint = el('div', { class: 'cam-hint' });
  const camSpot = camView.querySelector('.cam-spot');
  panel.appendChild(
    section('Camera',
      el('div', { class: 'ro-sub first', text: 'Focus' }),
      camTop,
      camBodies,
      camView,
      camHint,
      el('div', { class: 'btn-row' }, [button('⛶ Frame All', () => app.frameAll(), '', 'Move the camera to fit all bodies in view (F)')])
    )
  );

  function describeCamera({ focus, view }) {
    if (focus === 'free') return 'Free camera. Drag to orbit, scroll to zoom, right-drag to pan.';
    const what = focus === 'com' ? 'the center of mass' : bodyName(focus);
    if (view === 'surface') return `Riding the surface of ${what}: you turn as it spins. Starts looking straight up; drag to look around, New Spot moves you.`;
    return `Locked on ${what}. The camera travels with it. Drag to orbit, scroll to zoom.`;
  }

  // ---------- readouts ----------
  const keEl = el('span', { class: 'ro-val', text: '0.00' });
  const peEl = el('span', { class: 'ro-val', text: '0.00' });
  const energyEl = el('span', { class: 'ro-val', text: '0.00' });
  const driftEl = el('span', { class: 'ro-val', text: '0.0000%' });
  const sepEl = el('span', { class: 'ro-val', text: '0.00' });
  const bodyBars = [];
  const barsWrap = el('div', { class: 'bars' });
  for (let i = 0; i < 3; i++) {
    // data-body lets a monochrome style tell A/B/C apart by pattern instead of colour
    const fill = el('span', { class: 'bar-fill', 'data-body': i, style: `background:${hex(COLORS[i])}` });
    const val = el('span', { class: 'bar-val caps', text: '0.00' });
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
    section('Telemetry',
      el('div', { class: 'ro-grid' }, [
        el('span', { class: 'ro-label', text: 'Kinetic', 'data-tip': 'Total kinetic energy (energy of motion). Rises as bodies speed up.' }), keEl,
        el('span', { class: 'ro-label', text: 'Potential', 'data-tip': 'Total gravitational potential energy. More negative when bodies are closer.' }), peEl,
        el('span', { class: 'ro-label', text: 'Total', 'data-tip': 'Kinetic + potential. Should stay nearly constant — the integrator conserves energy.' }), energyEl,
        el('span', { class: 'ro-label', text: 'Drift', 'data-tip': 'How far total energy has strayed from its start. Tiny = faithful; grows on violent close passes.' }), driftEl,
        el('span', { class: 'ro-label', text: 'Min sep', 'data-tip': 'Closest center-to-center distance between any two bodies right now.' }), sepEl,
      ]),
      el('div', { class: 'ro-sub', text: 'Body speed' }),
      barsWrap
    )
  );

  setupTooltips();

  // ---------- keyboard ----------
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    // a popup menu owns its keys while it is open (Esc closes it instead of deselecting the body)
    // and the keys that operate its button
    if (e.target.closest?.('.menu-list')) return;
    if (e.target.closest?.('.menu-btn') && [' ', 'Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    switch (e.key.toLowerCase()) {
      case ' ': e.preventDefault(); app.toggle(); break;
      case 'r': app.reset(); break;
      case 's': app.step(); break;
      case 'n': app.random(); break;
      case 'f': app.frameAll(); break;
      case 't': app.toggleOption('showTrails'); break;
      case 'g': app.toggleOption('showGrid'); break;
      case 'v': app.toggleOption('showVectors'); break;
      case 'z': app.toggleOption('showZLines'); break;
      case 'b': app.toggleOption('showStars'); break;
      case 'c': app.cycleCollisionMode(); break;
      case 'u': app.cycleTheme(); break;
      case '0': app.setCameraFocus('free'); break;
      case '1': case '2': case '3': app.setCameraFocus(Number(e.key) - 1); break;
      case '4': app.setCameraFocus('com'); break;
      case 'p': app.toggleSurface(); break;
      case 'escape': app.deselect(); popover.classList.add('hidden'); break;
    }
  });

  // ---------- API back to main ----------
  let maxSpeed = 1;
  let lastRunning = null;
  return {
    setActivePreset(id) {
      for (const [k, b] of Object.entries(presetBtns)) b.classList.toggle('active', k === id);
      // the scene window of a windowed style is titled like a document
      if (sceneTitle) sceneTitle.textContent = presets[id] ? presets[id].label : 'Custom';
    },
    setTheme(id) {
      for (const [k, b] of Object.entries(themeBtns)) b.classList.toggle('active', k === id);
    },
    setCamera(cam) {
      const isBody = Number.isInteger(cam.focus);
      for (const [k, b] of Object.entries(camBtns)) {
        const on = k === 'free' ? cam.focus === 'free'
          : k === 'com' ? cam.focus === 'com'
          : k === 'orbit' ? isBody && cam.view === 'orbit'
          : k === 'surface' ? isBody && cam.view === 'surface'
          : cam.focus === Number(k.slice(4)); // body0..body2
        b.classList.toggle('active', on);
      }
      camView.classList.toggle('hidden', !isBody);
      camSpot.classList.toggle('hidden', cam.view !== 'surface');
      camHint.textContent = describeCamera(cam);
    },
    setCollisionMode(m) {
      for (const [k, b] of Object.entries(collModeBtns)) b.classList.toggle('active', k === m);
    },
    showBodyEditor(i, cfg) {
      editIndex = i;
      editTitle.innerHTML = `<span class="swatch" data-body="${i}" style="background:${hex(COLORS[i])}"></span>Body ${'ABC'[i]}`;
      editSel.mass.set(cfg.mass); editSel.radius.set(cfg.radius);
      editSel.px.set(cfg.pos.x); editSel.py.set(cfg.pos.y); editSel.pz.set(cfg.pos.z);
      editSel.vx.set(cfg.vel.x); editSel.vy.set(cfg.vel.y); editSel.vz.set(cfg.vel.z);
      bodySelBtns.forEach((b, k) => b.classList.toggle('active', k === i));
      syncLook();
      editorSection.classList.remove('hidden');
    },
    // re-read the selected body's look (after an import, or applying one look to every body)
    syncLook() { if (editIndex >= 0) syncLook(); },
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
      restS.set(app.state.restitution);
    },
    syncToggles() {
      for (const [k, input] of Object.entries(toggleInputs)) input.checked = !!app.options[k];
    },
    update() {
      const r = app.getReadouts();
      statusPill.textContent = r.running ? 'Running' : 'Paused';
      statusPill.classList.toggle('on', r.running);
      if (r.running !== lastRunning) {
        lastRunning = r.running;
        setButtonLabel(playBtn, r.running ? '⏸ Pause' : '▶ Start');
      }
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
        bodyBars[i].val.textContent = r.ejected[i] ? 'Eject' : sp.toFixed(2);
      }

      const li = r.lastImpact;
      if (li) {
        impClass.textContent = li.category;
        impClass.dataset.sev = li.category;
        impPair.textContent = `${li.a} ✕ ${li.b}`;
        impSpeed.textContent = li.vRel.toFixed(2);
        impEnergy.textContent = li.impactEnergy.toFixed(2);
        impSeverity.textContent = Number.isFinite(li.severity) ? li.severity.toFixed(2) + '×' : '∞';
      } else {
        impClass.textContent = impPair.textContent = '—';
        impSpeed.textContent = impEnergy.textContent = impSeverity.textContent = '—';
        delete impClass.dataset.sev;
      }
    },
  };
}
