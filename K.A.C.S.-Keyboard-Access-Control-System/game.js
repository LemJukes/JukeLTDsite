/**
 * KEYBOARD CONTROL — game.js
 *
 * A keyboard-interface game where the player operates a mysterious
 * Machine(TM) by entering command sequences before time runs out.
 * Inspired by LOST (the timer), The Stanley Parable, and Office Space
 * (corporate monotony, mindless compliance, the Conglomeration).
 *
 * Progression: completed sequences earn CREDITS. Every 5 sequences the
 * player steps away from the Machine into an untimed BREAK ROOM, where
 * they may rebind keys and spend credits at REQUISITION on consumables,
 * permanent run upgrades, and cosmetic CRT themes. All purchases reset
 * each run (roguelike); only the high score persists.
 */

'use strict';

// ============================================================
// CONSTANTS
// ============================================================

/**
 * All command names the Machine can demand. There must be at least as many
 * entries as there are bindable keys (one command per key); commands are
 * assigned to keys by index in initKeyBindings().
 */
const COMMANDS = [
  'INITIATE',   'ENGAGE',     'CONFIRM',     'EXECUTE',
  'OVERRIDE',   'RESET',      'PURGE',       'SYNC',
  'ANALYZE',    'DEPLOY',     'RECALL',      'ABORT',
  'AUTHORIZE',  'TRANSMIT',   'DISENGAGE',   'PROCESS',
  'CALIBRATE',  'ESCALATE',   'COMPILE',     'ARCHIVE',
  'INDEX',      'VERIFY',     'ENCRYPT',     'DECRYPT',
  'REROUTE',    'BUFFER',     'FLUSH',       'COMMIT',
  'ROLLBACK',   'ISOLATE',    'QUARANTINE',  'BROADCAST',
  'RELAY',      'SCAN',       'PATCH',       'REBOOT',
  'SUSPEND',    'RESUME',     'ALLOCATE',    'RELEASE',
  'MIGRATE',    'REPLICATE',  'VALIDATE',    'NORMALIZE',
  'DISPATCH',   'INTERCEPT',  'AMPLIFY',     'THROTTLE',
  'ACKNOWLEDGE',
];

/**
 * Concentric rings of keys, center → outward. The player begins on the
 * central cluster (ring 0); the playable pool expands by one chunk per break
 * room (see expandKeyPool). Keys are identified by their KeyboardEvent.code
 * so the numpad ('Numpad1') stays distinct from the reserved main number row
 * ('Digit1'), and punctuation / NumLock behave consistently.
 *   Ring 5 is the numpad — a late-game "bonus" tier reached only in long runs.
 */
const KEY_RINGS = [
  // ring 0 — START: central cluster (T Y U / F G H J / V B N)
  ['KeyT','KeyY','KeyU','KeyF','KeyG','KeyH','KeyJ','KeyV','KeyB','KeyN'],
  // ring 1
  ['KeyR','KeyE','KeyI','KeyD','KeyK','KeyC','KeyM'],
  // ring 2
  ['KeyW','KeyO','KeyS','KeyL','KeyX','Comma'],
  // ring 3
  ['KeyQ','KeyP','KeyA','Semicolon','KeyZ','Period'],
  // ring 4
  ['Quote','Slash','BracketLeft','BracketRight','Backslash'],
  // ring 5 — NUMPAD BONUS
  ['Numpad7','Numpad8','Numpad9','Numpad4','Numpad5','Numpad6',
   'Numpad1','Numpad2','Numpad3','Numpad0',
   'NumpadDivide','NumpadMultiply','NumpadSubtract','NumpadAdd','NumpadDecimal'],
];

/** Every key that can ever become playable (flattened ring order). */
const ALL_KEYS    = KEY_RINGS.flat();
const BINDABLE_SET = new Set(ALL_KEYS);

/**
 * Physical layout for the binding grid. The main keyboard is always drawn
 * (locked keys dimmed) so the player can watch the pool grow outward; the
 * numpad cluster is only drawn once any numpad key has unlocked.
 */
const KEYBOARD_LAYOUT = [
  ['KeyQ','KeyW','KeyE','KeyR','KeyT','KeyY','KeyU','KeyI','KeyO','KeyP','BracketLeft','BracketRight','Backslash'],
  ['KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyK','KeyL','Semicolon','Quote'],
  ['KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM','Comma','Period','Slash'],
];

const NUMPAD_LAYOUT = [
  ['Numpad7','Numpad8','Numpad9','NumpadDivide'],
  ['Numpad4','Numpad5','Numpad6','NumpadMultiply'],
  ['Numpad1','Numpad2','Numpad3','NumpadSubtract'],
  ['Numpad0','NumpadDecimal','NumpadAdd'],
];

/** Main number row — reserved for consumable hotkeys, never bindable. */
const RESERVED_KEYS = [
  'Digit1','Digit2','Digit3','Digit4','Digit5',
  'Digit6','Digit7','Digit8','Digit9','Digit0',
];

/** Display labels for non-letter keys (letters/digits derive from the code). */
const KEY_LABELS = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  NumpadDivide: '/', NumpadMultiply: '*', NumpadSubtract: '-',
  NumpadAdd: '+', NumpadDecimal: '.',
};

/** Seconds on the countdown timer. 33s applies real pressure from the start;
 *  the LOST "108" homage lives on in the v1.08 version string. */
const TIMER_START = 33;

/** Maximum number of lines kept in the machine-status log. */
const MAX_LOG_ENTRIES = 50;

/** Maximum characters shown for a command name inside a key cell. */
const MAX_DISPLAY_CMD_LENGTH = 9;

/** Sequence length caps by tier. */
const SEQ_LENGTH_BY_TIER = [3, 4, 5, 6, 7];

/** A break room opens every this-many completed sequences. */
const BREAK_ROOM_EVERY = 5;

// ── Run checkpoint persistence ────────────────────────────────
/** localStorage key holding the serialized run checkpoint. */
const SAVE_KEY     = 'kacs_save';
/** Bumped whenever the snapshot shape changes, so stale saves are ignored. */
const SAVE_VERSION = 1;

// ── Redemption (paid in-place revive on game over; resets each run) ──
/** Sequences the run must reach before ATTEMPT REDEMPTION appears on the recap. */
const REDEMPTION_UNLOCK_SCORE  = 25;
/** Credit cost of the first redemption in a run. */
const REDEMPTION_BASE_COST     = 100;
/** The cost is multiplied by this for every redemption taken within a run. */
const REDEMPTION_COST_MULTIPLIER = 2;

// ── Progression gates (measured in error-free play; reset each run) ──
/** Consecutive clean sets required before the keyboard / sequence-length ramp begins. */
const CLEAN_SETS_FOR_EXPANSION  = 3;
/** Cumulative clean sequences required before REQUISITION comes online. */
const CLEAN_SEQ_FOR_REQUISITION = 25;
/** Once REQUISITION is open, one more shop item is authorised per this-many clean sequences. */
const ITEM_DRIP_EVERY           = 9;

// ── Economy tuning ────────────────────────────────────────────
// Deliberately lean early: a clean length-3 set earns ~10-12 credits, so it
// takes ~2 sets to afford even the cheapest shop item. CREDIT_BASE is per
// command and intentionally sub-1 (a 5-sequence set multiplies it five times);
// awardCredits() floors the per-sequence total so credits stay whole numbers.
const CREDIT_BASE             = 0.5; // per command in the sequence
const CREDIT_EFFICIENCY_BONUS = 1;   // scaled by lifetime efficiency ratio
const CREDIT_TIME_DIVISOR     = 25;  // timeBonus = floor(timer / divisor)
const HAZARD_PAY_MULTIPLIER   = 1.5; // credit multiplier when HAZARD PAY owned

/** Per-level effects for permanent upgrades. */
const OVERCLOCK_SECONDS = 20;        // added to each set's starting timer per level
const STIMULANT_SECONDS = 20;        // added to current timer per STIMULANT

// ── Keyboard expansion tuning ─────────────────────────────────
const EXPANSION_RATE             = 0.30; // fraction of the next ring unlocked per set
const BLIND_EXPANSION_MULTIPLIER = 1.25; // credit multiplier earned during a blind set

// ── Cosmetic CRT themes (swap the core CSS custom properties) ──
const THEMES = {
  amber: {
    '--green':      '#ffb700',
    '--green-dim':  '#aa7a00',
    '--green-dark': '#3a2a00',
    '--green-glow': 'rgba(255, 183, 0, 0.35)',
  },
  cyan: {
    '--green':      '#00e5ff',
    '--green-dim':  '#0098aa',
    '--green-dark': '#003540',
    '--green-glow': 'rgba(0, 229, 255, 0.35)',
  },
};
const THEME_VARS = ['--green', '--green-dim', '--green-dark', '--green-glow'];

// ============================================================
// SHOP CATALOG
// ============================================================
// Single source of truth for the shop, inventory rendering and use.
//   kind: 'consumable' — one-shot, stored in state.inventory, used in play
//         'upgrade'    — bought once (or a few times), level in state.upgrades
//         'cosmetic'   — flavor only, recolours the CRT
//   max:  purchase / stack cap
//   apply(): run on purchase (upgrades/cosmetics)
//   use():  run on activation (consumables); return true if it took effect

const SHOP_ITEMS = [
  // ── Time consumables ──
  {
    id: 'coffee', name: 'STIMULANT', kind: 'consumable', category: 'time', unlockOrder: 0, cost: 25, max: 9,
    blurb: `+${STIMULANT_SECONDS}s to the current timer.`,
    use() {
      state.timer += STIMULANT_SECONDS;
      updateTimerDisplay();
      addToLog(`STIMULANT METABOLISED. +${STIMULANT_SECONDS}s.`, 'log-success');
      return true;
    },
  },
  {
    id: 'freeze', name: 'TIME FREEZE', kind: 'consumable', category: 'time', unlockOrder: 2, cost: 30, max: 9,
    blurb: 'Pause the countdown for the rest of this sequence.',
    use() {
      if (state.timerFrozen) return false;
      state.timerFrozen = true;
      updateTimerDisplay();
      addToLog('TIME FREEZE ACTIVE. THE COUNTDOWN HOLDS.', 'log-info');
      return true;
    },
  },
  // ── Sequencing aids ──
  {
    id: 'autoexec', name: 'AUTO-EXECUTE', kind: 'consumable', category: 'aid', unlockOrder: 4, cost: 35, max: 9,
    blurb: 'Instantly complete the current command.',
    use() {
      const cmd = state.currentSequence[state.sequencePos];
      if (!cmd) return false;
      flashInputEcho(cmd, true);
      state.sequencePos++;
      addToLog('AUTO-EXECUTE: COMMAND DISCHARGED BY PROXY.', 'log-info');
      if (state.sequencePos >= state.currentSequence.length) {
        completeSequence();
      } else {
        renderSequenceDisplay();
        renderKeyBindings();
      }
      return true;
    },
  },
  {
    id: 'reveal', name: 'KEY REVEAL', kind: 'consumable', category: 'aid', unlockOrder: 1, cost: 20, max: 9,
    blurb: 'Highlight every upcoming key in this sequence.',
    use() {
      if (state.revealActive) return false;
      state.revealActive = true;
      renderKeyBindings();
      addToLog('KEY REVEAL: REMAINING TARGETS ILLUMINATED.', 'log-info');
      return true;
    },
  },
  {
    id: 'skip', name: 'SKIP TOKEN', kind: 'consumable', category: 'aid', unlockOrder: 3, cost: 40, max: 9,
    blurb: 'Mark this sequence complete. Earns no credits.',
    use() {
      if (state.phase !== 'PLAYING') return false;
      state.skipCredit = true;
      state.sequenceHadError = true;   // a bail-out does not count as clean play
      state.sequencePos = state.currentSequence.length;
      addToLog('SKIP TOKEN SPENT. SEQUENCE WAIVED.', 'log-info');
      completeSequence();
      return true;
    },
  },
  // ── Permanent run upgrades ──
  {
    id: 'overclock', name: 'OVERCLOCK', kind: 'upgrade', category: 'upgrade', unlockOrder: 7, cost: 55, max: 3,
    blurb: `+${OVERCLOCK_SECONDS}s to each set's starting timer.`,
  },
  {
    id: 'hazardPay', name: 'HAZARD PAY', kind: 'upgrade', category: 'upgrade', unlockOrder: 8, cost: 70, max: 1,
    blurb: `Earn ${Math.round((HAZARD_PAY_MULTIPLIER - 1) * 100)}% more credits per sequence.`,
  },
  {
    id: 'tolerance', name: 'ERROR BUFFER', kind: 'upgrade', category: 'upgrade', unlockOrder: 5, cost: 65, max: 2,
    blurb: 'Forgive one extra wrong keystroke each sequence.',
  },
  {
    id: 'precog', name: 'PRECOGNITION', kind: 'upgrade', category: 'upgrade', unlockOrder: 6, cost: 60, max: 1,
    blurb: 'Also dimly highlights the NEXT command\'s key.',
  },
  // ── Cosmetic ──
  {
    id: 'theme_amber', name: 'AMBER PHOSPHOR', kind: 'cosmetic', category: 'cosmetic', unlockOrder: 9, cost: 15, max: 1,
    blurb: 'Recolour the CRT to warm amber.',
    apply() { applyTheme('amber'); },
  },
  {
    id: 'theme_cyan', name: 'CYAN TERMINAL', kind: 'cosmetic', category: 'cosmetic', unlockOrder: 10, cost: 15, max: 1,
    blurb: 'Recolour the CRT to cold cyan.',
    apply() { applyTheme('cyan'); },
  },
];

const SHOP_BY_ID = {};
SHOP_ITEMS.forEach(item => { SHOP_BY_ID[item.id] = item; });

/** Display order + headers for the REQUISITION grid (organised beyond colour coding). */
const SHOP_CATEGORIES = [
  { key: 'time',     label: 'TIME' },
  { key: 'aid',      label: 'SEQUENCING AIDS' },
  { key: 'upgrade',  label: 'PERMANENT UPGRADES' },
  { key: 'cosmetic', label: 'COSMETIC' },
];

// ── Machine messages ──────────────────────────────────────────
const MSGS = {
  sequenceComplete: [
    'SEQUENCE LOGGED. THE MACHINE CONTINUES.',
    'PROTOCOL ACKNOWLEDGED. SYSTEMS STABLE.',
    'COMPLIANCE NOTED. WELL DONE, EMPLOYEE.',
    'THE CONGLOMERATION THANKS YOU FOR YOUR SERVICE.',
    'OPERATIONAL PARAMETERS MET. PROCEEDING.',
    'INPUT VALIDATED. THE MACHINE PERSISTS.',
    'YOUR COMPLIANCE HAS BEEN RECORDED.',
    'SEQUENCE RECEIVED. REMOTE SYSTEMS ENGAGED.',
    'ACKNOWLEDGED. THE WORK CONTINUES. IT ALWAYS CONTINUES.',
    'SUBSYSTEM DELTA REPORTS: NOMINAL.',
    'GOOD. KEEP GOING. DO NOT ASK QUESTIONS.',
    'THE NUMBERS HAVE BEEN ENTERED. FOR NOW.',
  ],
  sequenceError: [
    'INCORRECT INPUT. SEQUENCE RESET.',
    'PROTOCOL BREACH DETECTED. RECALIBRATING.',
    'INPUT MISMATCH. BEGIN AGAIN.',
    'THE MACHINE DOES NOT RECOGNIZE THAT SEQUENCE.',
    'ERROR LOGGED. COMPLIANCE FAILURE. TRY AGAIN.',
    'THAT WAS NOT THE CORRECT KEY, EMPLOYEE.',
    'DEVIATION DETECTED. SEQUENCE VOIDED.',
  ],
  timerWarning: [
    'ATTENTION: INPUT OVERDUE. RISK LEVEL ELEVATED.',
    'WARNING: TIMER CRITICAL. ENTER SEQUENCE IMMEDIATELY.',
    'SYSTEM INSTABILITY DETECTED. HURRY.',
    'THE MACHINE GROWS IMPATIENT.',
    'FAILURE TO ENTER SEQUENCE WILL HAVE CONSEQUENCES.',
    'THIS IS YOUR FINAL WARNING.',
    'CRITICAL THRESHOLD APPROACHING.',
  ],
  // Streamed every second during the last five — bigger, louder, worse.
  timerCritical: [
    'CONTAINMENT FAILING.',
    'STRUCTURAL INTEGRITY: LOST.',
    'THE MACHINE IS WAKING.',
    'IT KNOWS YOUR NAME, EMPLOYEE.',
    'SOMETHING IS COMING THROUGH.',
    'THERE IS NO MORE TIME.',
    'DO NOT LOOK AWAY FROM THE SCREEN.',
    'RUN. (YOU CANNOT.)',
    'THE WALLS REMEMBER EVERYONE WHO FAILED.',
    'PRESS THE KEYS. PRESS THE KEYS. PRESS THE KEYS.',
  ],
  timerExpired: [
    '.',
    '..',
    '...',
    'TIMER ELAPSED.',
    'SEQUENCE NOT ENTERED IN TIME.',
    'THE MACHINE HAS BEEN RELEASED.',
    'THE CONSEQUENCES ARE ALREADY UNFOLDING.',
    'THEY CANNOT BE STOPPED NOW.',
    'YOU HAVE BEEN LOGGED AS NON-COMPLIANT.',
    'GOODBYE, EMPLOYEE.',
  ],
  breakRoom: [
    'BREAK ROOM SEALED. THE MACHINE WAITS, PATIENT.',
    'THE COUNTDOWN HOLDS. BREATHE WHILE YOU CAN.',
    'COMPLIANCE CREDITS MAY BE EXCHANGED AT REQUISITION.',
    'YOU MAY ALSO REMAP YOUR KEYS. CLICK OR PRESS TWO TO SWAP.',
    'REST IS A PRIVILEGE. IT WILL BE NOTED.',
    'PRESS ENTER WHEN READY TO RETURN TO SERVICE.',
  ],
  startup: [
    'KEYBOARD CONTROL SYSTEM v1.08 INITIALIZING...',
    'LOADING COMMAND PROTOCOLS.',
    'EMPLOYEE AUTHENTICATION: ACCEPTED.',
    'MACHINE INTERFACE ONLINE.',
    'THE MACHINE AWAITS YOUR INPUT.',
    'ENTER THE SEQUENCES. DO NOT DEVIATE.',
    'AWAITING FIRST SEQUENCE.',
  ],
};

// ============================================================
// GAME STATE
// ============================================================

const state = {
  phase: 'START',           // START | PLAYING | BREAK_ROOM | GAME_OVER
  keyBindings:   {},        // { 'KeyR': 'INITIATE', ... }  keyed by event.code
  currentSequence: [],      // ['INITIATE','SYNC','EXECUTE',...]
  sequencePos:   0,         // how far into currentSequence we are
  score:         0,         // sequences completed
  timer:         TIMER_START,
  roundTimerStart: TIMER_START, // effective starting timer (incl. OVERCLOCK)
  timerInterval: null,
  timerPaused:   false,     // true while tab is hidden
  timerFrozen:   false,     // true while TIME FREEZE is active
  breakRoomFirstKey: null,  // first key selected in a swap operation
  sequenceLength: 3,        // current sequence length
  commandFreq:   {},        // { 'INITIATE': 7, ... }  — lifetime totals
  totalInputs:   0,         // keystrokes attempted during PLAYING
  correctInputs: 0,         // keystrokes that were correct
  // ── Progression (all reset each run) ──
  credits:       0,         // spendable currency
  inventory:     {},        // { coffee: 2, freeze: 1, ... } consumables owned
  upgrades:      {},        // { overclock: 2, hazardPay: 1, ... } permanent levels
  errorBuffer:   0,         // forgiven wrong keystrokes left this sequence
  revealActive:  false,     // KEY REVEAL active for the current sequence
  skipCredit:    false,     // suppress credit award for a skipped sequence
  // ── Keyboard expansion (reset each run) ──
  activeKeys:    new Set(), // event.codes eligible for sequences (incl. blind)
  hiddenKeys:    new Set(), // active but unrevealed (blind, not yet called)
  ringIndex:     1,         // next ring to draw expansion keys from (0 pre-unlocked)
  ringPos:       0,         // keys already unlocked within the current ring
  newKeysThisSet: [],       // keys added for the upcoming set
  expansionMode: null,      // 'reveal' | 'blind' — chosen each break room
  creditMultiplier: 1,      // 1.25 during a blind set, else 1
  // ── Clean-play tracking & progression gates (reset each run) ──
  sequenceHadError: false,  // any wrong key (or skip) in the current sequence
  setHadError:      false,  // any wrong key anywhere in the current set
  cleanSequenceTotal: 0,    // cumulative error-free sequences this run
  cleanSetStreak:   0,      // consecutive error-free sets
  expansionUnlocked: false, // latched once cleanSetStreak hits the gate
  requisitionUnlocked: false, // latched once cleanSequenceTotal hits the gate
  expansionsDone:   0,      // break rooms processed since expansion unlocked (drives length tier)
  // ── Redemption / game-over hand-off (reset each run) ──
  redemptionCost:   REDEMPTION_BASE_COST, // credit cost of the next in-run revive (doubles per use)
  awaitingGameOverAck: false, // GAME OVER splash is up, waiting for a click/keypress
  _gameOverClick:   null,   // bound click handler while the splash is shown
  // ── Spotlight tutorial ──
  tutorialQueue:    [],     // ids of pending tips
  tutorialActive:   false,  // a tip is currently on screen
  tutorialPaused:   false,  // timer was paused to show a tip
  _tutResize:       null,   // bound resize handler while a tip is open
  // ── Reset confirmation modal ──
  confirmingReset:  false,  // the purge-confirmation modal is open
  resetPausedTimer: false,  // timer was paused while the reset modal is up
};

// ============================================================
// UTILITIES
// ============================================================

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function efficiency() {
  if (state.totalInputs === 0) return '--';
  return Math.round((state.correctInputs / state.totalInputs) * 100) + '%';
}

function efficiencyRatio() {
  if (state.totalInputs === 0) return 1;
  return state.correctInputs / state.totalInputs;
}

function getKeyForCommand(cmd) {
  return Object.keys(state.keyBindings).find(k => state.keyBindings[k] === cmd) || '?';
}

/** Human-readable label for a key code ('KeyR'→'R', 'Numpad7'→'7', 'Comma'→','). */
function keyLabel(code) {
  if (KEY_LABELS[code])          return KEY_LABELS[code];
  if (code.startsWith('Key'))    return code.slice(3);
  if (code.startsWith('Digit'))  return code.slice(5);
  if (code.startsWith('Numpad')) return code.slice(6);
  return code;
}

/** Canonical key id for a keyboard event — its physical code. */
function eventKeyId(e) {
  return e.code;
}

function swapBindings(k1, k2) {
  const tmp          = state.keyBindings[k1];
  state.keyBindings[k1] = state.keyBindings[k2];
  state.keyBindings[k2] = tmp;
}

// ── Cosmetic themes ───────────────────────────────────────────
function applyTheme(name) {
  resetTheme();
  const palette = THEMES[name];
  if (!palette) return;
  Object.entries(palette).forEach(([prop, val]) => {
    document.documentElement.style.setProperty(prop, val);
  });
}

function resetTheme() {
  THEME_VARS.forEach(prop => document.documentElement.style.removeProperty(prop));
}

// ============================================================
// KEY BINDINGS INITIALISATION
// ============================================================

function initKeyBindings() {
  state.keyBindings = {};
  // Bind every eligible key to a command by index — one command per key.
  ALL_KEYS.forEach((code, i) => {
    state.keyBindings[code] = COMMANDS[i];
  });
  state.commandFreq = {};
  Object.values(state.keyBindings).forEach(cmd => { state.commandFreq[cmd] = 0; });

  // The playable pool starts at the central cluster (ring 0); the rest is locked.
  state.activeKeys = new Set(KEY_RINGS[0]);
  state.hiddenKeys = new Set();
  state.ringIndex  = 1;
  state.ringPos    = 0;
  state.newKeysThisSet = [];
}

// ============================================================
// SEQUENCE GENERATION
// ============================================================

function generateSequence(length) {
  // Only commands bound to currently-unlocked keys may be demanded.
  const activeCommands = [...state.activeKeys].map(code => state.keyBindings[code]);
  const seq = [];
  for (let i = 0; i < length; i++) {
    const cmd = rand(activeCommands);
    seq.push(cmd);
    state.commandFreq[cmd] = (state.commandFreq[cmd] || 0) + 1;
  }
  return seq;
}

// ============================================================
// KEYBOARD EXPANSION
// ============================================================

/**
 * Unlock the next chunk (~EXPANSION_RATE of the current ring) of keys.
 * Called once per break room. Returns the keys newly added this set
 * (empty once the whole keyboard + numpad has been unlocked).
 */
function expandKeyPool() {
  state.newKeysThisSet = [];
  if (state.ringIndex >= KEY_RINGS.length) return state.newKeysThisSet;

  const ring  = KEY_RINGS[state.ringIndex];
  const chunk = Math.max(1, Math.ceil(ring.length * EXPANSION_RATE));

  for (let i = 0; i < chunk && state.ringPos < ring.length; i++) {
    const code = ring[state.ringPos++];
    state.activeKeys.add(code);
    state.newKeysThisSet.push(code);
  }
  if (state.ringPos >= ring.length) {
    state.ringIndex++;
    state.ringPos = 0;
  }
  return state.newKeysThisSet;
}

/** Reveal a single blind key (no-op if it isn't hidden). */
function revealKey(code) {
  if (state.hiddenKeys.delete(code)) {
    renderKeyBindings();
  }
}

/** Reveal every still-hidden key at once (silent, e.g. when a set ends). */
function revealAllHidden() {
  if (state.hiddenKeys.size === 0) return;
  state.hiddenKeys.clear();
  renderKeyBindings();
}

/** True once any numpad key has unlocked (gates rendering the numpad cluster). */
function numpadUnlocked() {
  return NUMPAD_LAYOUT.some(row => row.some(code => state.activeKeys.has(code)));
}

// ============================================================
// MACHINE LOG
// ============================================================

const logEl = () => document.getElementById('machine-log');

function addToLog(text, cls) {
  const el  = logEl();
  const div = document.createElement('div');
  div.className = 'log-line' + (cls ? ' ' + cls : '');
  div.textContent = text;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
  // Keep the log from growing forever
  while (el.children.length > MAX_LOG_ENTRIES) {
    el.removeChild(el.firstChild);
  }
  return div;   // callers may style the line (e.g. the death cascade)
}

function clearLog() {
  logEl().innerHTML = '';
}

// ============================================================
// RENDERING
// ============================================================

function renderAll() {
  renderSequenceDisplay();
  renderKeyBindings();
  renderInventory();
  updateTimerDisplay();
  updateScoreDisplay();
}

// ── Sequence display ──────────────────────────────────────────
function renderSequenceDisplay() {
  const seqEl = document.getElementById('sequence-display');
  seqEl.innerHTML = '';

  state.currentSequence.forEach((cmd, i) => {
    const span = document.createElement('span');
    span.className = 'seq-cmd';

    if (i < state.sequencePos) {
      // Already entered correctly
      span.classList.add('done');
      span.textContent = '✓';
    } else if (i === state.sequencePos) {
      // The current target — show which key to press
      const key = getKeyForCommand(cmd);
      if (state.hiddenKeys.has(key)) revealKey(key);  // a blind key surfaces when called
      span.classList.add('active');
      span.textContent = `[${keyLabel(key)}]${cmd}`;
    } else {
      // Future commands — show name only
      span.classList.add('pending');
      span.textContent = cmd;
    }

    seqEl.appendChild(span);

    if (i < state.currentSequence.length - 1) {
      const arrow = document.createElement('span');
      arrow.className = 'seq-arrow';
      arrow.textContent = ' → ';
      seqEl.appendChild(arrow);
    }
  });

  // Progress bar
  const pct = (state.sequencePos / state.currentSequence.length) * 100;
  document.getElementById('progress-fill').style.width = pct + '%';
}

// ── Key binding grid ──────────────────────────────────────────
// Renders the full keyboard skeleton so the player can watch the playable
// pool grow outward. Locked keys (not yet unlocked) and blind keys (active but
// unrevealed) look identical — dim, command hidden — so blind expansions can't
// be spotted by position. A key reveals (lights up with its command) the moment
// it is first called. The numpad cluster appears only once it begins unlocking.
function renderKeyBindings() {
  const grid = document.getElementById('bindings-grid');
  grid.innerHTML = '';

  const inBreakRoom = state.phase === 'BREAK_ROOM';
  const currentCmd  = state.currentSequence[state.sequencePos];
  const nextCmd     = state.currentSequence[state.sequencePos + 1];

  // Commands still to be entered (for KEY REVEAL highlighting)
  const upcoming = state.revealActive
    ? new Set(state.currentSequence.slice(state.sequencePos))
    : null;

  // Compute max frequency for normalisation
  const freqVals = Object.values(state.commandFreq);
  const maxFreq  = Math.max(1, ...freqVals);

  const makeCell = (code) => {
    const cell = document.createElement('div');
    cell.className = 'key-cell';
    cell.dataset.key = code;

    // Locked or blind-and-uncalled → indistinguishable dim cell, no command.
    if (!state.activeKeys.has(code) || state.hiddenKeys.has(code)) {
      cell.classList.add('locked');
      cell.innerHTML =
        `<span class="key-label">${keyLabel(code)}</span>` +
        `<span class="key-cmd">—</span>`;
      return cell;
    }

    const cmd = state.keyBindings[code];

    if (state.phase === 'PLAYING') {
      if (cmd === currentCmd) {
        cell.classList.add('highlight');
      } else if (state.upgrades.precog && cmd === nextCmd) {
        cell.classList.add('precog');             // PRECOGNITION preview
      }
      if (upcoming && upcoming.has(cmd) && cmd !== currentCmd) {
        cell.classList.add('revealed');           // KEY REVEAL target
      }
    }

    if (inBreakRoom) {
      cell.classList.add('rebindable');
      const relFreq = (state.commandFreq[cmd] || 0) / maxFreq;
      if (relFreq > 0.6)      cell.classList.add('freq-high');
      else if (relFreq > 0.3) cell.classList.add('freq-med');
      else if (relFreq > 0)   cell.classList.add('freq-low');
      if (state.breakRoomFirstKey === code) cell.classList.add('selected');
      cell.addEventListener('click', () => handleRebindClick(code));
    }

    cell.innerHTML =
      `<span class="key-label">${keyLabel(code)}</span>` +
      `<span class="key-cmd">${cmd.substring(0, MAX_DISPLAY_CMD_LENGTH)}</span>`;
    return cell;
  };

  const addRow = (codes, extraClass) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'key-row' + (extraClass ? ' ' + extraClass : '');
    codes.forEach(code => rowEl.appendChild(makeCell(code)));
    grid.appendChild(rowEl);
  };

  // Reserved number row — inert; these keys trigger consumables 1–9.
  const reservedRow = document.createElement('div');
  reservedRow.className = 'key-row reserved-row';
  RESERVED_KEYS.forEach(code => {
    const cell = document.createElement('div');
    cell.className = 'key-cell reserved';
    cell.innerHTML =
      `<span class="key-label">${keyLabel(code)}</span>` +
      `<span class="key-cmd">USE</span>`;
    reservedRow.appendChild(cell);
  });
  grid.appendChild(reservedRow);

  // Main keyboard (always drawn).
  KEYBOARD_LAYOUT.forEach(row => addRow(row));

  // Numpad bonus cluster — only once it has begun unlocking.
  if (numpadUnlocked()) {
    const npLabel = document.createElement('div');
    npLabel.className = 'numpad-label';
    npLabel.textContent = 'NUMPAD — BONUS TIER';
    grid.appendChild(npLabel);
    NUMPAD_LAYOUT.forEach(row => addRow(row, 'numpad-row'));
    queueTutorial('numpad');   // shown via the break room's showNextTutorial()
  }
}

// ── Inventory bar (consumables, usable during play) ──────────
function ownedConsumables() {
  return SHOP_ITEMS.filter(
    item => item.kind === 'consumable' && (state.inventory[item.id] || 0) > 0
  );
}

function renderInventory() {
  const bar = document.getElementById('inventory-bar');
  if (!bar) return;
  bar.innerHTML = '';

  if (state.phase !== 'PLAYING') {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');

  const owned = ownedConsumables();
  if (owned.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'inv-empty';
    empty.textContent = 'NO CONSUMABLES — VISIT REQUISITION IN THE BREAK ROOM';
    bar.appendChild(empty);
    return;
  }

  owned.forEach((item, i) => {
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    const hotkey = i + 1;
    slot.innerHTML =
      `<span class="inv-key">${hotkey}</span>` +
      `<span class="inv-name">${item.name}</span>` +
      `<span class="inv-count">x${state.inventory[item.id]}</span>`;
    slot.addEventListener('click', () => useConsumable(item.id));
    bar.appendChild(slot);
  });

  // First time consumables are in play, teach the hotkeys.
  queueTutorial('consumables');
  showNextTutorial();
}

// ── Timer display ─────────────────────────────────────────────
function updateTimerDisplay() {
  const t     = Math.max(0, state.timer);
  const numEl = document.getElementById('timer-number');
  const fill  = document.getElementById('timer-fill');

  numEl.textContent = String(t).padStart(3, '0');
  fill.style.width  = Math.min(100, (t / state.roundTimerStart) * 100) + '%';

  if (state.timerFrozen) {
    numEl.className = 'timer-frozen';
    fill.className  = 'frozen';
  } else if (t <= 10) {
    numEl.className  = 'timer-danger';
    fill.className   = 'danger';
  } else if (t <= 22) {
    numEl.className  = 'timer-warning';
    fill.className   = 'warning';
  } else {
    numEl.className  = '';
    fill.className   = '';
  }

  updateScreenGlitch(t);
}

// ── Screen corruption escalation ──────────────────────────────
// The whole interface starts to come apart as the countdown dies: an uneasy
// jitter from 15s, a violent tearing/blackout from 5s. Driven off the live
// timer so STIMULANT pulling time back up calms it, and TIME FREEZE / any
// non-playing phase clears it entirely. The '.dying' death-throes class (added
// in triggerConsequences) is cleared here too, so a reset/revive restores the panels.
function clearScreenGlitch() {
  const container = document.getElementById('game-container');
  if (container) container.classList.remove('glitch-active', 'glitch-severe', 'dying');
  const overlay = document.getElementById('glitch-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function updateScreenGlitch(t) {
  const container = document.getElementById('game-container');
  const overlay   = document.getElementById('glitch-overlay');
  if (!container) return;

  const active = state.phase === 'PLAYING' && !state.timerFrozen;
  const severe = active && t <= 5;
  const mild   = active && t <= 15 && t > 5;

  container.classList.toggle('glitch-severe', severe);
  container.classList.toggle('glitch-active', mild);
  if (overlay) overlay.classList.toggle('hidden', !severe);
}

// ── Score / efficiency / credits ──────────────────────────────
function updateScoreDisplay() {
  document.getElementById('score-num').textContent      = state.score;
  document.getElementById('efficiency-num').textContent = efficiency();
  document.getElementById('highscore-num').textContent  = loadHighScore();
  const creditsEl = document.getElementById('credits-num');
  if (creditsEl) creditsEl.textContent = state.credits;
}

// ── High score persistence ────────────────────────────────────
function loadHighScore() {
  return parseInt(localStorage.getItem('kacs_highscore') || '0', 10);
}

function saveHighScore(score) {
  if (score > loadHighScore()) {
    localStorage.setItem('kacs_highscore', score);
    return true;
  }
  return false;
}

// ── Run checkpoint persistence ────────────────────────────────
// A snapshot of the run is written at every break room (the only natural pause)
// and re-written after each break-room action. On reload the player resumes from
// that break room with their score, credits, inventory, upgrades, keybindings and
// expansion progress intact. The checkpoint is cleared on death and when a new
// run starts, so it can't be abused as a free revive. The high score and tutorial
// flags persist independently. Sets are stored as arrays (JSON can't serialise a Set).
function saveCheckpoint() {
  try {
    const snapshot = {
      v:                   SAVE_VERSION,
      score:               state.score,
      credits:             state.credits,
      inventory:           state.inventory,
      upgrades:            state.upgrades,
      keyBindings:         state.keyBindings,
      commandFreq:         state.commandFreq,
      sequenceLength:      state.sequenceLength,
      totalInputs:         state.totalInputs,
      correctInputs:       state.correctInputs,
      activeKeys:          [...state.activeKeys],
      hiddenKeys:          [...state.hiddenKeys],
      ringIndex:           state.ringIndex,
      ringPos:             state.ringPos,
      newKeysThisSet:      state.newKeysThisSet,
      expansionMode:       state.expansionMode,
      creditMultiplier:    state.creditMultiplier,
      cleanSequenceTotal:  state.cleanSequenceTotal,
      cleanSetStreak:      state.cleanSetStreak,
      expansionUnlocked:   state.expansionUnlocked,
      requisitionUnlocked: state.requisitionUnlocked,
      expansionsDone:      state.expansionsDone,
      redemptionCost:      state.redemptionCost,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
  } catch (e) { /* storage unavailable / quota — saving is best-effort */ }
}

function loadCheckpoint() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== SAVE_VERSION) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function clearCheckpoint() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}

// Rehydrate the run state from a checkpoint (returns false if it looks invalid).
function restoreCheckpoint(data) {
  if (!data || typeof data.score !== 'number') return false;

  state.score               = data.score;
  state.credits             = data.credits || 0;
  state.inventory           = data.inventory || {};
  state.upgrades            = data.upgrades || {};
  state.keyBindings         = data.keyBindings || {};
  state.commandFreq         = data.commandFreq || {};
  state.sequenceLength      = data.sequenceLength || 3;
  state.totalInputs         = data.totalInputs || 0;
  state.correctInputs       = data.correctInputs || 0;
  state.activeKeys          = new Set(data.activeKeys || []);
  state.hiddenKeys          = new Set(data.hiddenKeys || []);
  state.ringIndex           = typeof data.ringIndex === 'number' ? data.ringIndex : 1;
  state.ringPos             = data.ringPos || 0;
  state.newKeysThisSet      = data.newKeysThisSet || [];
  state.expansionMode       = data.expansionMode || null;
  state.creditMultiplier    = data.creditMultiplier || 1;
  state.cleanSequenceTotal  = data.cleanSequenceTotal || 0;
  state.cleanSetStreak      = data.cleanSetStreak || 0;
  state.expansionUnlocked   = !!data.expansionUnlocked;
  state.requisitionUnlocked = !!data.requisitionUnlocked;
  state.expansionsDone      = data.expansionsDone || 0;
  state.redemptionCost      = data.redemptionCost || REDEMPTION_BASE_COST;

  // Re-apply any owned cosmetic theme.
  resetTheme();
  if (state.upgrades.theme_cyan)       applyTheme('cyan');
  else if (state.upgrades.theme_amber) applyTheme('amber');

  return true;
}

// Drop the player back into the break room from a restored checkpoint, without
// re-running any progression logic (gates, key expansion) — that already happened
// when the checkpoint was taken.
function resumeBreakRoom() {
  state.phase             = 'BREAK_ROOM';
  state.breakRoomFirstKey = null;
  state.timer             = TIMER_START;   // restored to a full count on leaving
  state.timerFrozen       = false;
  clearScreenGlitch();

  const overlay = document.getElementById('overlay');
  overlay.classList.add('hidden');
  overlay.classList.remove('blackout');
  hideGameOverSplash();
  document.getElementById('game-container').classList.remove('consequences');
  document.getElementById('input-echo').textContent = '';

  clearLog();
  addToLog('SESSION RESTORED FROM LAST BREAK ROOM CHECKPOINT.', 'log-info');
  addToLog(`WELCOME BACK, EMPLOYEE. SEQUENCES LOGGED: ${state.score}.`, 'log-info');

  renderBreakRoomScreen();
  updateScoreDisplay();

  // Re-offer the break-room tips (each still shows at most once, ever).
  queueTutorial('breakroom');
  if (state.requisitionUnlocked) queueTutorial('requisition');
  showNextTutorial();
}

// ── Input echo ────────────────────────────────────────────────
function flashInputEcho(cmd, correct) {
  const el = document.getElementById('input-echo');
  el.textContent = cmd;
  el.classList.remove('echo-flash', 'echo-flash-error');
  void el.offsetWidth;
  el.classList.add(correct ? 'echo-flash' : 'echo-flash-error');
}

// ── Error shake ───────────────────────────────────────────────
function flashError() {
  const container = document.getElementById('game-container');
  container.classList.remove('shake');
  void container.offsetWidth;
  container.classList.add('shake');
  container.addEventListener('animationend', () => container.classList.remove('shake'), { once: true });
}

// ============================================================
// GAME PHASES
// ============================================================

// ── Start screen ──────────────────────────────────────────────
// The K.A.C.S. block-letter banner, shown alone and centered when the start
// screen first opens, before its glyphs "blink out" cell by cell.
const KACS_BANNER = [
  '██   ██  █████   ██████ ███████',
  '██  ██  ██   ██ ██      ██',
  '█████   ███████ ██      ███████',
  '██  ██  ██   ██ ██           ██',
  '██   ██ ██   ██  ██████ ███████',
];

// Wrap every glyph of the banner in its own cell span so it can be extinguished
// individually. Spacing cells are tagged so the burn-out only touches lit glyphs.
function buildAsciiCells() {
  return KACS_BANNER
    .map(line =>
      [...line]
        .map(ch =>
          ch === ' '
            ? '<span class="ascii-cell ascii-space"> </span>'
            : `<span class="ascii-cell">${ch}</span>`
        )
        .join('')
    )
    .join('\n');
}

// Hold the intact logo briefly, extinguish its glyph cells in a random order,
// then reveal the induction text. Honours prefers-reduced-motion.
function animateIntro() {
  const pre  = document.getElementById('intro-ascii');
  const body = document.getElementById('intro-body');
  const reveal = () => {
    if (pre)  pre.classList.add('gone');
    if (body) { body.classList.remove('hidden'); body.classList.add('intro-reveal'); }
  };

  if (!pre || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    reveal();
    return;
  }

  // Lit glyph cells only, shuffled, so the banner dissolves rather than wipes.
  const cells = [...pre.querySelectorAll('.ascii-cell:not(.ascii-space)')];
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  const HOLD  = 650;   // ms the intact logo lingers first
  const STEP  = 24;    // ms between extinguishing bursts
  const BATCH = 2;     // cells extinguished per burst

  setTimeout(() => {
    let idx = 0;
    const timer = setInterval(() => {
      for (let b = 0; b < BATCH && idx < cells.length; b++, idx++) {
        cells[idx].classList.add('out');
      }
      if (idx >= cells.length) {
        clearInterval(timer);
        setTimeout(reveal, 200);
      }
    }, STEP);
  }, HOLD);
}

function showStartScreen() {
  const overlay = document.getElementById('overlay');
  overlay.classList.remove('hidden');
  // Mirrors README.md — the in-universe employee induction, deliberate
  // corporate "typos" (timre, responsibilty, ©™®¶) preserved intentionally.
  overlay.innerHTML = `
    <div class="overlay-content">
      <pre class="overlay-ascii" id="intro-ascii" aria-hidden="true">${buildAsciiCells()}</pre>
      <div id="intro-body" class="overlay-intro-body hidden">
      <div class="overlay-title">K.A.C.S.</div>
      <div class="overlay-subtitle">KEYBOARD ACCESS CONTROL SYSTEM</div>
      <div class="overlay-body">
        <p class="overlay-heading">YOUR DUTIES</p>
        <p>The Machine© will display a <strong>sequence of commands</strong>.</p>
        <p>You will enter them. That is all.</p>
        <p>That is the primary, and sole function of your position within The Organization™®.</p>
        <p><strong>Goal:</strong> Keep entering command sequences before the countdown reaches zero.</p>
        <p>That is all. You have one job.</p>

        <p class="overlay-heading">⚠ ON THE SUBJECT OF FAILURE</p>
        <p>Should the timer reach zero:</p>
        <p>Do not allow the timer to reach zero.</p>
        <p>We, The Organization©™®, are not obligated to disclose any potential hazards to
           your person. Therefore it is an employees sole responsibilty to maintain and persist
           the primary function of their position.</p>
        <blockquote>The consequences of failure do not exist.<br>
           Because you will not fail.<br>
           They are however, very painful.</blockquote>
        <p>Non-compliance is subject to immediate termination of any employee with no appeal,
           no severance, and, (pursuant to Section 108-L-JJ-©) no funeral.</p>
        <blockquote>Your desk will be reassigned before you have finished failing.</blockquote>
        <p class="warning">Deviation from these instructions is itself a form of failure. So is
           hesitation. So is reading this sentence too slowly. DO NOT DEVIATE. DO NOT HESITATE.
           DO NOT LET THE TIMER REACH ZERO.</p>
      </div>
      <button id="start-btn" class="overlay-btn">BEGIN SERVICE</button>
      <div class="overlay-flavor">Good luck, Employee. You had one job.</div>
      </div>
    </div>
  `;
  document.getElementById('start-btn').addEventListener('click', startGame);
  animateIntro();
}

// ── Start / restart game ──────────────────────────────────────
function startGame() {
  clearCheckpoint();       // a new run supersedes any saved checkpoint
  state.phase            = 'PLAYING';
  state.score            = 0;
  state.sequenceLength   = 3;
  state.timer            = TIMER_START;
  state.roundTimerStart  = TIMER_START;
  state.totalInputs      = 0;
  state.correctInputs    = 0;
  // Progression resets each run
  state.credits          = 0;
  state.inventory        = {};
  state.upgrades         = {};
  state.errorBuffer      = 0;
  state.revealActive     = false;
  state.skipCredit       = false;
  state.timerFrozen      = false;
  state.breakRoomFirstKey = null;
  state.creditMultiplier  = 1;
  state.expansionMode     = null;
  // Clean-play tracking & progression gates
  state.sequenceHadError    = false;
  state.setHadError         = false;
  state.cleanSequenceTotal  = 0;
  state.cleanSetStreak      = 0;
  state.expansionUnlocked   = false;
  state.requisitionUnlocked = false;
  state.expansionsDone      = 0;
  // Redemption resets each run (cost back to base, no pending splash)
  state.redemptionCost      = REDEMPTION_BASE_COST;
  state.awaitingGameOverAck = false;

  hideTutorial();      // clear any tip left over from a previous run
  hideGameOverSplash();
  clearScreenGlitch();
  document.getElementById('game-container').classList.remove('consequences');

  resetTheme();
  initKeyBindings();   // also resets the key pool to ring 0

  const overlay = document.getElementById('overlay');
  overlay.classList.add('hidden');
  overlay.classList.remove('blackout');   // restore the normal backdrop for the next start screen
  document.getElementById('phase-label').textContent = 'ACTIVE SEQUENCE';
  document.getElementById('game-container').classList.remove('in-break');
  document.getElementById('rebind-hint').classList.add('hidden');
  document.getElementById('break-room').classList.add('hidden');
  document.getElementById('freq-legend').classList.add('hidden');
  document.getElementById('input-echo').textContent = '';

  clearLog();
  MSGS.startup.forEach((msg, i) => {
    setTimeout(() => addToLog(msg), i * 300);
  });

  const delay = MSGS.startup.length * 300 + 400;
  setTimeout(() => {
    state.currentSequence = generateSequence(state.sequenceLength);
    state.sequencePos     = 0;
    state.sequenceHadError = false;
    state.errorBuffer     = state.upgrades.tolerance || 0;
    renderAll();
    startTimer();
    queueTutorial('basics');   // teach the core loop on the very first sequence
    showNextTutorial();
  }, delay);
}

// ── Timer ─────────────────────────────────────────────────────
// The countdown runs continuously across a whole SET (the sequences between
// break rooms) — including the brief pause between sequences, so finishing a
// sequence buys no free time. startTimer() resets it to full, only at the start
// of a set; it keeps ticking untouched between sequences within the set.
function startTimer() {
  clearInterval(state.timerInterval);
  state.roundTimerStart = TIMER_START + OVERCLOCK_SECONDS * (state.upgrades.overclock || 0);
  state.timer = state.roundTimerStart;
  state.timerFrozen = false;
  updateTimerDisplay();
  state.timerInterval = setInterval(tickTimer, 1000);
}

function tickTimer() {
  if (state.timerFrozen) return;   // TIME FREEZE holds the countdown
  state.timer--;
  updateTimerDisplay();

  if ([22, 20, 15, 10, 5].includes(state.timer)) {
    addToLog(rand(MSGS.timerWarning), 'log-warning');
  }

  // The final five seconds get a louder, more dire line every tick.
  if (state.timer <= 5 && state.timer > 0) {
    addToLog(rand(MSGS.timerCritical), 'log-critical');
  }

  if (state.timer <= 0) {
    clearInterval(state.timerInterval);
    triggerConsequences();
  }
}

// ── Handle player key input (code = event.code) ───────────────
function handleKeyInput(code) {
  // ── Break room phase ─────────────────────────────────────
  if (state.phase === 'BREAK_ROOM') {
    if (BINDABLE_SET.has(code)) handleRebindClick(code);
    return;
  }

  // ── Playing phase ────────────────────────────────────────
  if (state.phase !== 'PLAYING') return;

  // Ignore input during the brief settle after a sequence is fully entered
  // (the countdown keeps running, but the next sequence hasn't loaded yet) — and
  // during boot before the first sequence exists.
  if (!state.currentSequence.length || state.sequencePos >= state.currentSequence.length) return;

  // Main number row 1–9 activates consumables (numpad digits do NOT clash).
  const digitMatch = /^Digit([1-9])$/.exec(code);
  if (digitMatch) {
    useConsumableSlot(parseInt(digitMatch[1], 10));
    return;
  }

  // Only keys that exist in the layout AND are currently unlocked count.
  if (!BINDABLE_SET.has(code) || !state.activeKeys.has(code)) return;

  const cmd      = state.keyBindings[code];
  const expected = state.currentSequence[state.sequencePos];
  const correct  = cmd === expected;

  state.totalInputs++;
  flashInputEcho(cmd, correct);
  updateScoreDisplay();

  if (correct) {
    state.correctInputs++;
    if (state.hiddenKeys.has(code)) revealKey(code);  // surface a blind key on use
    state.sequencePos++;

    if (state.sequencePos >= state.currentSequence.length) {
      completeSequence();
    } else {
      renderSequenceDisplay();
      renderKeyBindings();
    }
  } else if (state.errorBuffer > 0) {
    // A wrong key always breaks "clean play", even if the buffer absorbs it.
    state.sequenceHadError = true;
    // ERROR BUFFER absorbs the deviation — sequence is not reset
    state.errorBuffer--;
    addToLog(`ERROR BUFFER ABSORBED ONE DEVIATION. ${state.errorBuffer} REMAINING.`, 'log-info');
    flashError();
  } else {
    sequenceError();
  }
}

// ── Consumable activation ─────────────────────────────────────
function useConsumableSlot(slot) {
  const owned = ownedConsumables();
  const item  = owned[slot - 1];
  if (item) useConsumable(item.id);
}

function useConsumable(id) {
  if (state.phase !== 'PLAYING') return;
  const item = SHOP_BY_ID[id];
  if (!item || item.kind !== 'consumable') return;
  if ((state.inventory[id] || 0) <= 0) return;

  const took = item.use();
  if (took === false) return;          // could not apply right now

  state.inventory[id]--;
  renderInventory();
  updateScoreDisplay();
}

// ── Sequence completed ────────────────────────────────────────
function completeSequence() {
  state.score++;

  // Clean-play tracking: a sequence with no wrong keys (and not skipped) counts.
  if (state.sequenceHadError) {
    state.setHadError = true;
  } else {
    state.cleanSequenceTotal++;
  }

  if (state.skipCredit) {
    state.skipCredit = false;          // skipped sequences earn nothing
  } else {
    awardCredits();
  }

  updateScoreDisplay();
  addToLog(rand(MSGS.sequenceComplete), 'log-success');
  if (state.timer <= 15) {
    addToLog(`CLOSE CALL: ${state.timer}s REMAINING. DO NOT DO THAT AGAIN.`, 'log-warning');
  }

  const triggerBreak = state.score % BREAK_ROOM_EVERY === 0;

  // The countdown keeps running through this short pause (no free time). Only the
  // break room stops it. Guard the callback in case the timer expires mid-pause.
  setTimeout(() => {
    if (state.phase !== 'PLAYING') return;   // timer hit zero during the pause
    if (triggerBreak) {
      enterBreakRoom();
    } else {
      nextSequence();
    }
  }, 600);
}

function awardCredits() {
  const base      = CREDIT_BASE * state.currentSequence.length;
  const effBonus  = efficiencyRatio() * CREDIT_EFFICIENCY_BONUS;   // fractional until the end
  const timeBonus = Math.floor(Math.max(0, state.timer) / CREDIT_TIME_DIVISOR);
  let earned      = base + effBonus + timeBonus;
  if (state.upgrades.hazardPay)     earned *= HAZARD_PAY_MULTIPLIER;
  if (state.creditMultiplier !== 1) earned *= state.creditMultiplier;   // blind-expansion bonus
  // Floor to whole credits; a completed sequence always pays at least 1.
  earned = Math.max(1, Math.floor(earned));
  state.credits += earned;
  addToLog(`COMPLIANCE CREDITS AWARDED: +${earned}. BALANCE: ${state.credits}.`, 'log-success');
}

function nextSequence() {
  state.currentSequence = generateSequence(state.sequenceLength);
  state.sequencePos     = 0;
  state.sequenceHadError = false;
  state.revealActive    = false;
  state.timerFrozen     = false;
  state.errorBuffer     = state.upgrades.tolerance || 0;
  renderAll();
  // The countdown is already running (mid-set), or was just started by
  // startTimer() after a break room — nothing to resume here.
}

// ── Sequence error ────────────────────────────────────────────
function sequenceError() {
  state.sequenceHadError = true;   // breaks the clean-play streak
  addToLog(rand(MSGS.sequenceError), 'log-error');
  state.sequencePos = 0;
  renderSequenceDisplay();
  renderKeyBindings();
  flashError();
}

// ============================================================
// BREAK ROOM
// ============================================================

// Pure rendering of the break-room screen from the current state. Shared by
// enterBreakRoom (live) and resumeBreakRoom (restored) so neither duplicates the
// layout/visibility wiring and no progression logic runs twice.
function renderBreakRoomScreen() {
  document.getElementById('phase-label').textContent = 'BREAK ROOM';
  document.getElementById('rebind-hint').classList.remove('hidden');
  document.getElementById('freq-legend').classList.remove('hidden');
  // REQUISITION only appears once it has come online; the two-column break-room
  // layout (rebind keys beside the shop) is only used while the shop is shown.
  document.getElementById('break-room').classList.toggle('hidden', !state.requisitionUnlocked);
  document.getElementById('game-container').classList.toggle('in-break', state.requisitionUnlocked);

  renderKeyBindings();   // interactive + frequency-coloured
  if (state.requisitionUnlocked) renderShop();
  renderExpansionChoice();
  renderInventory();     // hides the in-play inventory bar

  // Break-room instruction line reflects what's actually available.
  const actions = ['REBIND KEYS'];
  if (state.expansionUnlocked && state.newKeysThisSet.length > 0) actions.push('CHOOSE YOUR EXPANSION');
  if (state.requisitionUnlocked) actions.push('VISIT REQUISITION');
  document.getElementById('sequence-display').innerHTML =
    '<span style="color:var(--green-dim);font-size:12px;">' +
    'YOU HAVE STEPPED AWAY FROM THE MACHINE. ' + actions.join(', ') +
    ', THEN PRESS ENTER TO RETURN.</span>';
  document.getElementById('progress-fill').style.width = '0%';
}

function enterBreakRoom() {
  state.phase            = 'BREAK_ROOM';
  state.breakRoomFirstKey = null;
  state.timerFrozen      = false;
  clearInterval(state.timerInterval);  // the menacing countdown is frozen
  clearScreenGlitch();                 // the screen settles in the safety of the break room

  // ── Evaluate the set that just finished against the progression gates ──
  if (state.setHadError) state.cleanSetStreak = 0;
  else                   state.cleanSetStreak++;
  state.setHadError = false;

  const expansionJustOpened =
    !state.expansionUnlocked && state.cleanSetStreak >= CLEAN_SETS_FOR_EXPANSION;
  if (expansionJustOpened) state.expansionUnlocked = true;

  const requisitionJustOpened =
    !state.requisitionUnlocked && state.cleanSequenceTotal >= CLEAN_SEQ_FOR_REQUISITION;
  if (requisitionJustOpened) state.requisitionUnlocked = true;

  // The set has ended. Silently reveal any blind keys that were never called.
  revealAllHidden();
  state.creditMultiplier = 1;
  state.expansionMode    = null;

  // Keyboard / sequence-length expansion only happens once its gate is open.
  if (state.expansionUnlocked) {
    const added = expandKeyPool();
    added.forEach(code => state.hiddenKeys.add(code));
    state.expansionsDone++;
  } else {
    state.newKeysThisSet = [];
  }

  // Flavour intro (skip the REQUISITION line while the shop is still offline).
  MSGS.breakRoom
    .filter(m => state.requisitionUnlocked || !/REQUISITION/.test(m))
    .forEach((msg, i) => setTimeout(() => addToLog(msg, 'log-info'), i * 200));

  // ── Progression status feedback ──
  if (expansionJustOpened) {
    addToLog('EXPANSION GATE OPEN. THE KEYBOARD BEGINS TO GROW.', 'log-success');
  } else if (!state.expansionUnlocked) {
    const need = Math.max(0, CLEAN_SETS_FOR_EXPANSION - state.cleanSetStreak);
    addToLog(`EXPANSION LOCKED: ${need} MORE CLEAN SET${need === 1 ? '' : 'S'} IN A ROW (STREAK ${state.cleanSetStreak}/${CLEAN_SETS_FOR_EXPANSION}).`, 'log-warning');
  }
  if (requisitionJustOpened) {
    addToLog('REQUISITION AUTHORISED. THE SHOP IS OPEN FOR BUSINESS.', 'log-success');
  } else if (!state.requisitionUnlocked) {
    const need = CLEAN_SEQ_FOR_REQUISITION - state.cleanSequenceTotal;
    addToLog(`REQUISITION OFFLINE: ${need} MORE CLEAN SEQUENCE${need === 1 ? '' : 'S'} TO AUTHORISE (${state.cleanSequenceTotal}/${CLEAN_SEQ_FOR_REQUISITION}).`, 'log-warning');
  }

  renderBreakRoomScreen();

  // Checkpoint: the break-room state has fully settled, so persist it now.
  saveCheckpoint();

  // ── Tutorial tips (each shows at most once, ever) ──
  queueTutorial('breakroom');
  if (state.expansionUnlocked && state.newKeysThisSet.length > 0) queueTutorial('expansion');
  if (state.requisitionUnlocked) queueTutorial('requisition');
  showNextTutorial();
}

function leaveBreakRoom() {
  // If the player never chose, default to a safe REVEAL (no credit bonus).
  if (state.expansionMode === null && state.newKeysThisSet.length > 0) {
    chooseExpansion('reveal');
  }

  state.phase            = 'PLAYING';
  state.breakRoomFirstKey = null;

  document.getElementById('phase-label').textContent = 'ACTIVE SEQUENCE';
  document.getElementById('game-container').classList.remove('in-break');
  document.getElementById('rebind-hint').classList.add('hidden');
  document.getElementById('break-room').classList.add('hidden');
  document.getElementById('freq-legend').classList.add('hidden');
  document.getElementById('expansion-choice').classList.add('hidden');

  // Sequence length stays at the baseline until the expansion gate opens, then
  // ramps one tier per expansion break room (shares the gate with key expansion).
  const tier = state.expansionUnlocked
    ? Math.min(state.expansionsDone, SEQ_LENGTH_BY_TIER.length - 1)
    : 0;
  state.sequenceLength = SEQ_LENGTH_BY_TIER[tier];

  addToLog('BREAK ENDED. RESUMING OPERATIONS.', 'log-info');

  startTimer();    // a brand-new set begins with a full countdown
  nextSequence();  // load the set's first sequence (keeps that timer running)
}

function handleRebindClick(key) {
  if (state.phase !== 'BREAK_ROOM') return;
  // Only unlocked, revealed keys can be remapped (locked/blind keys are inert).
  if (!state.activeKeys.has(key) || state.hiddenKeys.has(key)) return;

  if (!state.breakRoomFirstKey) {
    state.breakRoomFirstKey = key;
    addToLog(
      `[${keyLabel(key)}] ${state.keyBindings[key]} — SELECTED. CHOOSE SECOND KEY TO SWAP.`,
      'log-info'
    );
  } else if (state.breakRoomFirstKey === key) {
    state.breakRoomFirstKey = null;
    addToLog('SELECTION CLEARED.', 'log-info');
  } else {
    const k1 = state.breakRoomFirstKey;
    const k2 = key;
    addToLog(
      `SWAPPING [${keyLabel(k1)}]${state.keyBindings[k1]} ↔ [${keyLabel(k2)}]${state.keyBindings[k2]}`,
      'log-info'
    );
    swapBindings(k1, k2);
    state.breakRoomFirstKey = null;
    saveCheckpoint();   // remapped bindings survive a refresh
  }

  renderKeyBindings();
}

// ============================================================
// EXPANSION CHOICE (break room: REVEAL vs BLIND)
// ============================================================

function chooseExpansion(mode) {
  if (state.phase !== 'BREAK_ROOM') return;
  if (state.newKeysThisSet.length === 0) return;   // nothing left to expand
  state.expansionMode = mode;

  if (mode === 'reveal') {
    // Expose the new keys now — visible and rebindable, no credit bonus.
    state.newKeysThisSet.forEach(code => state.hiddenKeys.delete(code));
    state.creditMultiplier = 1;
    addToLog('EXPANSION REVEALED. NEW KEYS AVAILABLE FOR REMAPPING.', 'log-info');
  } else {
    // Keep them hidden until each is first called; earn a credit multiplier.
    state.newKeysThisSet.forEach(code => state.hiddenKeys.add(code));
    state.creditMultiplier = BLIND_EXPANSION_MULTIPLIER;
    const pct = Math.round((BLIND_EXPANSION_MULTIPLIER - 1) * 100);
    addToLog(
      `BLIND EXPANSION ACCEPTED. +${pct}% CREDITS NEXT SET. NEW KEYS HIDDEN UNTIL CALLED.`,
      'log-warning'
    );
  }

  renderExpansionChoice();
  renderKeyBindings();
  saveCheckpoint();   // the expansion choice is part of the break-room checkpoint
}

function renderExpansionChoice() {
  const box = document.getElementById('expansion-choice');
  if (!box) return;

  // Gate still closed — explain how to open it.
  if (!state.expansionUnlocked) {
    const need = Math.max(0, CLEAN_SETS_FOR_EXPANSION - state.cleanSetStreak);
    box.innerHTML =
      '<div class="exp-title">EXPANSION LOCKED</div>' +
      `<div class="exp-blurb">Complete ${need} more clean set${need === 1 ? '' : 's'} in a row ` +
      `(a full set with no wrong keys) to begin expanding the keyboard and lengthening sequences. ` +
      `Current streak: ${state.cleanSetStreak}/${CLEAN_SETS_FOR_EXPANSION}.</div>`;
    box.classList.remove('hidden');
    return;
  }

  const n = state.newKeysThisSet.length;
  if (n === 0) {
    box.innerHTML =
      '<div class="exp-title">KEYBOARD FULLY MAPPED</div>' +
      '<div class="exp-blurb">No further expansion remains. Return to service.</div>';
    box.classList.remove('hidden');
    return;
  }

  const pct    = Math.round((BLIND_EXPANSION_MULTIPLIER - 1) * 100);
  const mode   = state.expansionMode;
  const labels = state.newKeysThisSet.map(keyLabel).join(' ');
  const revealDesc = mode === 'reveal'
    ? `Revealed: ${labels}. Rebind them now. No bonus.`
    : 'See &amp; rebind the new keys now. No bonus.';

  box.innerHTML =
    `<div class="exp-title">EXPANSION PENDING — ${n} NEW KEY${n > 1 ? 'S' : ''} NEXT SET</div>` +
    `<div class="exp-blurb">Choose how the new keys arrive (defaults to REVEAL):</div>` +
    `<div class="exp-options">` +
      `<button type="button" class="exp-btn${mode === 'reveal' ? ' chosen' : ''}" data-mode="reveal">` +
        `<span class="exp-btn-name">REVEAL</span>` +
        `<span class="exp-btn-desc">${revealDesc}</span>` +
      `</button>` +
      `<button type="button" class="exp-btn${mode === 'blind' ? ' chosen' : ''}" data-mode="blind">` +
        `<span class="exp-btn-name">BLIND &nbsp;+${pct}% CR</span>` +
        `<span class="exp-btn-desc">New keys stay hidden until called; +${pct}% credits all next set.</span>` +
      `</button>` +
    `</div>`;
  box.classList.remove('hidden');

  box.querySelectorAll('.exp-btn').forEach(btn => {
    btn.addEventListener('click', () => chooseExpansion(btn.dataset.mode));
  });
}

// ============================================================
// REQUISITION (SHOP)
// ============================================================

function itemOwnedCount(item) {
  return item.kind === 'consumable'
    ? (state.inventory[item.id] || 0)
    : (state.upgrades[item.id] || 0);
}

/** How many catalog items REQUISITION has authorised so far (drip-fed by clean play). */
function unlockedItemCount() {
  if (!state.requisitionUnlocked) return 0;
  return Math.min(
    SHOP_ITEMS.length,
    1 + Math.floor((state.cleanSequenceTotal - CLEAN_SEQ_FOR_REQUISITION) / ITEM_DRIP_EVERY)
  );
}

/** True once this item has been drip-unlocked. */
function itemUnlocked(item) {
  return item.unlockOrder < unlockedItemCount();
}

/** Clean sequences a given item still needs before it unlocks (0 if already unlocked). */
function cleanSeqUntilItem(item) {
  const threshold = CLEAN_SEQ_FOR_REQUISITION + item.unlockOrder * ITEM_DRIP_EVERY;
  return Math.max(0, threshold - state.cleanSequenceTotal);
}

/** Clean sequences until the NEXT locked item unlocks (null once all are open). */
function cleanSeqUntilNextItem() {
  const count = unlockedItemCount();
  if (count >= SHOP_ITEMS.length) return null;
  return Math.max(0, (CLEAN_SEQ_FOR_REQUISITION + count * ITEM_DRIP_EVERY) - state.cleanSequenceTotal);
}

function makeShopCard(item) {
  const card = document.createElement('div');
  card.className = 'shop-card shop-' + item.kind;

  // Locked teaser — visible so the player knows what's coming, but inert.
  if (!itemUnlocked(item)) {
    const until = cleanSeqUntilItem(item);
    card.classList.add('locked');
    card.innerHTML =
      `<div class="shop-name">${item.name}</div>` +
      `<div class="shop-blurb">LOCKED — authorised after more clean play.</div>` +
      `<div class="shop-cost">${until} CLEAN SEQ</div>`;
    return card;
  }

  const owned     = itemOwnedCount(item);
  const atMax     = owned >= item.max;
  const canAfford = state.credits >= item.cost;
  if (atMax)            card.classList.add('owned-max');
  else if (!canAfford)  card.classList.add('too-expensive');
  else                  card.classList.add('affordable');

  const ownedTag = item.kind === 'consumable'
    ? (owned > 0 ? `<span class="shop-owned">x${owned}</span>` : '')
    : (owned > 0 ? `<span class="shop-owned">LV ${owned}/${item.max}</span>` : '');

  card.innerHTML =
    `<div class="shop-name">${item.name} ${ownedTag}</div>` +
    `<div class="shop-blurb">${item.blurb}</div>` +
    `<div class="shop-cost">${atMax ? 'MAX' : item.cost + ' CR'}</div>`;

  if (!atMax) card.addEventListener('click', () => buyItem(item.id));
  return card;
}

function renderShop() {
  const grid = document.getElementById('shop-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // Drip-feed status header.
  const until = cleanSeqUntilNextItem();
  const note  = document.createElement('div');
  note.className = 'shop-drip-note';
  note.textContent = until === null
    ? 'ALL REQUISITION ITEMS AUTHORISED.'
    : `NEXT ITEM AUTHORISED IN ${until} CLEAN SEQUENCE${until === 1 ? '' : 'S'}.`;
  grid.appendChild(note);

  // Grouped category sections (organised beyond colour coding alone).
  SHOP_CATEGORIES.forEach(cat => {
    const items = SHOP_ITEMS
      .filter(it => it.category === cat.key)
      .sort((a, b) => a.unlockOrder - b.unlockOrder);   // soonest to unlock first
    if (items.length === 0) return;

    const block = document.createElement('div');
    block.className = 'shop-category';

    const label = document.createElement('div');
    label.className = 'shop-category-label';
    label.textContent = cat.label;
    block.appendChild(label);

    const cards = document.createElement('div');
    cards.className = 'shop-cards';
    items.forEach(item => cards.appendChild(makeShopCard(item)));
    block.appendChild(cards);

    grid.appendChild(block);
  });
}

function buyItem(id) {
  if (state.phase !== 'BREAK_ROOM') return;
  const item = SHOP_BY_ID[id];
  if (!item) return;

  if (!itemUnlocked(item)) {
    addToLog(`${item.name}: NOT YET AUTHORISED BY REQUISITION.`, 'log-warning');
    return;
  }
  if (itemOwnedCount(item) >= item.max) {
    addToLog(`${item.name}: MAXIMUM HOLDING REACHED.`, 'log-warning');
    return;
  }
  if (state.credits < item.cost) {
    addToLog(`${item.name}: INSUFFICIENT CREDITS. NICE TRY, EMPLOYEE.`, 'log-error');
    return;
  }

  state.credits -= item.cost;

  if (item.kind === 'consumable') {
    state.inventory[id] = (state.inventory[id] || 0) + 1;
  } else {
    state.upgrades[id] = (state.upgrades[id] || 0) + 1;
    if (item.apply) item.apply();
  }

  addToLog(`REQUISITION: ${item.name} ACQUIRED. -${item.cost} CR.`, 'log-success');
  renderShop();
  renderInventory();
  updateScoreDisplay();
  saveCheckpoint();   // purchases survive a refresh
}

// ── Timer expired → consequences ─────────────────────────────
// Death is a set-piece. At the instant the clock dies the motion is *reduced*:
// the violent tearing stops and instead every panel EXCEPT the machine-status
// log flickers and glitches to darkness (the '.dying' class). The red
// MSGS.timerExpired lines then stream into the still-lit log, each bigger,
// brighter and glitchier than the last (--dying-intensity), building to a
// crescendo before the held GAME OVER splash takes the screen to black.
function triggerConsequences() {
  state.phase = 'GAME_OVER';
  clearCheckpoint();   // a finished run leaves no checkpoint (no refresh-to-revive)

  const container = document.getElementById('game-container');
  // Drop the violent in-play corruption; switch to the quieter death throes.
  container.classList.remove('glitch-active', 'glitch-severe');
  const glitchOverlay = document.getElementById('glitch-overlay');
  if (glitchOverlay) glitchOverlay.classList.add('hidden');
  container.classList.add('dying');

  const last = MSGS.timerExpired.length - 1;
  MSGS.timerExpired.forEach((msg, i) => {
    setTimeout(() => {
      const line = addToLog(msg, 'log-dying');
      if (line) line.style.setProperty('--dying-intensity', (i / last).toFixed(3));
    }, i * 500);
  });

  setTimeout(() => {
    showGameOverSplash();
  }, MSGS.timerExpired.length * 500 + 1200);
}

// ── Held GAME OVER splash ─────────────────────────────────────
// Dims the dead screen to a huge red GAME OVER (its "M" faltering) and holds
// there until the player clicks or presses a key (ackGameOver), at which point
// the recap overlay is revealed.
function showGameOverSplash() {
  // The panels are already flickered to black by the '.dying' death throes;
  // leave that class in place so they stay dark behind the splash and recap
  // until START OVER / redemption clears it. The glitch overlay is already hidden.
  const splash = document.getElementById('gameover-splash');
  splash.innerHTML =
    '<div class="gameover-text">GA<span class="go-m">M</span>E OVER</div>' +
    '<div class="gameover-hint">CLICK OR PRESS ANY KEY TO CONTINUE</div>';
  splash.classList.remove('hidden');

  state.awaitingGameOverAck = true;
  state._gameOverClick = () => ackGameOver();
  splash.addEventListener('click', state._gameOverClick);
}

function hideGameOverSplash() {
  const splash = document.getElementById('gameover-splash');
  if (!splash) return;
  if (state._gameOverClick) {
    splash.removeEventListener('click', state._gameOverClick);
    state._gameOverClick = null;
  }
  splash.classList.add('hidden');
  splash.innerHTML = '';
}

/** Dismiss the GAME OVER splash and reveal the recap. */
function ackGameOver() {
  if (!state.awaitingGameOverAck) return;
  state.awaitingGameOverAck = false;
  hideGameOverSplash();
  showGameOver();
}

// ── Game over recap screen ────────────────────────────────────
function showGameOver() {
  const isNewBest = saveHighScore(state.score);
  // ATTEMPT REDEMPTION only appears once the run is deep enough; it is a paid,
  // in-place revive whose cost doubles with each use this run (see attemptRedemption).
  const showRedeem = state.score >= REDEMPTION_UNLOCK_SCORE;
  const canAfford  = state.credits >= state.redemptionCost;

  const redeemBtn = showRedeem
    ? `<button id="redeem-btn" class="overlay-btn"${canAfford ? '' : ' disabled'}>` +
        `ATTEMPT REDEMPTION (${state.redemptionCost} CR)</button>`
    : '';
  const redeemNote = (showRedeem && !canAfford)
    ? `<div class="overlay-redeem-note">REDEMPTION REQUIRES ${state.redemptionCost} CR — ` +
        `YOU HAVE ${state.credits}.</div>`
    : '';

  const overlay = document.getElementById('overlay');
  overlay.classList.remove('hidden');
  overlay.classList.add('blackout');   // keep the dead game screen fully black behind the recap
  overlay.innerHTML = `
    <div class="overlay-content">
      <div class="overlay-title">THE MACHINE HAS BEEN RELEASED</div>
      <div class="overlay-subtitle">CONSEQUENCES CANNOT BE UNDONE</div>
      <div class="overlay-stats">
        <div>SEQUENCES COMPLETED &nbsp;&nbsp;: ${state.score}</div>
        <div>INPUT EFFICIENCY &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: ${efficiency()}</div>
        <div>CREDITS UNSPENT &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: ${state.credits}</div>
        <div>PERSONAL BEST &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: ${loadHighScore()}</div>
        <div>COMPLIANCE STATUS &nbsp;&nbsp;&nbsp;&nbsp;: NON-COMPLIANT</div>
        ${isNewBest ? '<div class="new-highscore">&#x25B6; NEW PERSONAL BEST RECORDED &#x25C0;</div>' : ''}
      </div>
      <div class="overlay-flavor">"You had one job."</div>
      <button id="start-over-btn" class="overlay-btn">START OVER</button>
      ${redeemBtn}
      ${redeemNote}
    </div>
  `;
  document.getElementById('start-over-btn').addEventListener('click', startGame);
  const redeemEl = document.getElementById('redeem-btn');
  if (redeemEl && !redeemEl.disabled) {
    redeemEl.addEventListener('click', attemptRedemption);
  }
}

// ── Redemption: a paid, in-place revive ───────────────────────
// Spends compliance credits to resume the SAME run — score, credits (minus
// cost), upgrades, inventory, keybindings and expansion progress all survive.
// The timer is restored to full and the cost doubles for the next use this run.
function attemptRedemption() {
  if (state.phase !== 'GAME_OVER') return;
  if (state.score < REDEMPTION_UNLOCK_SCORE) return;
  if (state.credits < state.redemptionCost) return;

  const paid = state.redemptionCost;
  state.credits        -= paid;
  state.redemptionCost *= REDEMPTION_COST_MULTIPLIER;

  state.phase = 'PLAYING';
  state.awaitingGameOverAck = false;
  hideGameOverSplash();
  clearScreenGlitch();
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('game-container').classList.remove('consequences');

  addToLog(`REDEMPTION PURCHASED. -${paid} CR. THE MACHINE RECONSIDERS.`, 'log-success');
  addToLog('YOU ARE RETURNED TO SERVICE. THE DEBT IS NOTED. IT ALWAYS DOUBLES.', 'log-warning');

  startTimer();    // a fresh, full countdown
  nextSequence();  // load a new sequence onto the live timer (renders everything)
}

// ============================================================
// SPOTLIGHT TUTORIAL
// ============================================================
// Teaches each mechanic the first time it appears, without leaving the game:
// a dimmed screen with a highlight box around the relevant panel and a tooltip.
// Shown once ever (tracked in localStorage); the timer freezes while a tip is up.

const TUTORIAL_STEPS = {
  basics: {
    target: '#sequence-display',
    title:  'ENTER THE SEQUENCE',
    body:   'The bracketed letter shows which key to press for the active command. Press them in order. A wrong key resets the sequence — and the countdown never stops, even between sequences.',
  },
  breakroom: {
    target: '#bindings-grid',
    title:  'BREAK ROOM — REBIND KEYS',
    body:   'The countdown is frozen here. Click two unlocked keys to swap their commands so frequent commands sit under comfortable keys. Press ENTER to return to service.',
  },
  expansion: {
    target: '#expansion-choice',
    title:  'EXPANSION UNLOCKED',
    body:   'Clean play has earned you new keys. REVEAL them now to rebind, or take them BLIND for bonus credits — hidden until each is first called.',
  },
  requisition: {
    target: '#break-room',
    title:  'REQUISITION ONLINE',
    body:   'Spend compliance credits on consumables and permanent upgrades, grouped by type. More of the catalog is authorised the longer you play without errors.',
  },
  consumables: {
    target: '#inventory-bar',
    title:  'CONSUMABLES',
    body:   'Items you bought appear here. Trigger them during play with the matching number-row key (1–9).',
  },
  numpad: {
    target: '#bindings-grid',
    title:  'NUMPAD BONUS TIER',
    body:   'The numpad has begun unlocking — a late-game bonus cluster of extra command keys for the longest runs.',
  },
};

function tutorialSeen(id) {
  try { return localStorage.getItem('kacs_tut_' + id) === '1'; }
  catch (e) { return false; }
}

function markTutorialSeen(id) {
  try { localStorage.setItem('kacs_tut_' + id, '1'); } catch (e) { /* ignore */ }
}

function queueTutorial(id) {
  if (!TUTORIAL_STEPS[id]) return;
  if (tutorialSeen(id)) return;
  if (state.tutorialQueue.includes(id)) return;
  state.tutorialQueue.push(id);
}

function showNextTutorial() {
  if (state.tutorialActive) return;
  while (state.tutorialQueue.length) {
    const id   = state.tutorialQueue[0];
    const step = TUTORIAL_STEPS[id];
    const target = step && document.querySelector(step.target);
    // Skip already-seen tips or targets that aren't currently visible.
    if (tutorialSeen(id) || !target || target.offsetParent === null) {
      state.tutorialQueue.shift();
      continue;
    }
    presentTutorial(id, step, target);
    return;
  }
}

function presentTutorial(id, step, target) {
  state.tutorialActive = true;

  // Freeze the countdown while the tip is up, so reading never costs time.
  if (state.phase === 'PLAYING' && state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
    state.tutorialPaused = true;
  }

  const overlay = document.getElementById('tutorial-overlay');
  overlay.innerHTML =
    '<div class="tut-highlight"></div>' +
    '<div class="tut-tooltip">' +
      `<div class="tut-tooltip-title">${step.title}</div>` +
      `<div class="tut-tooltip-body">${step.body}</div>` +
      '<button type="button" class="tut-tooltip-btn">GOT IT &nbsp;(ENTER)</button>' +
    '</div>';
  overlay.classList.remove('hidden');

  positionTutorial(target);
  overlay.querySelector('.tut-tooltip-btn').addEventListener('click', () => dismissTutorial());

  state._tutResize = () => positionTutorial(target);
  window.addEventListener('resize', state._tutResize);
}

function positionTutorial(target) {
  const overlay = document.getElementById('tutorial-overlay');
  const hl  = overlay.querySelector('.tut-highlight');
  const tip = overlay.querySelector('.tut-tooltip');
  if (!hl || !tip || !target) return;

  const r   = target.getBoundingClientRect();
  const pad = 6;
  const top    = Math.max(0, r.top - pad);
  const left   = Math.max(0, r.left - pad);
  const width  = r.width  + pad * 2;
  const height = r.height + pad * 2;

  hl.style.top    = top + 'px';
  hl.style.left   = left + 'px';
  hl.style.width  = width + 'px';
  hl.style.height = height + 'px';

  // Prefer the tooltip below the highlight; flip above if there isn't room.
  const tipRect = tip.getBoundingClientRect();
  let tipTop = top + height + 12;
  if (tipTop + tipRect.height > window.innerHeight) {
    tipTop = Math.max(8, top - tipRect.height - 12);
  }
  let tipLeft = left;
  if (tipLeft + tipRect.width > window.innerWidth) {
    tipLeft = Math.max(8, window.innerWidth - tipRect.width - 8);
  }
  tip.style.top  = tipTop + 'px';
  tip.style.left = tipLeft + 'px';
}

function dismissTutorial() {
  if (!state.tutorialActive) return;
  const id = state.tutorialQueue.shift();
  if (id) markTutorialSeen(id);
  state.tutorialActive = false;
  hideTutorial();

  // Resume the countdown if we paused it and play is still live.
  if (state.tutorialPaused) {
    state.tutorialPaused = false;
    if (state.phase === 'PLAYING' && !document.hidden) {
      state.timerInterval = setInterval(tickTimer, 1000);
    }
  }
  showNextTutorial();   // chain any further queued tips
}

/** Tear down the overlay/listener without advancing the queue (e.g. on restart). */
function hideTutorial() {
  const overlay = document.getElementById('tutorial-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  }
  if (state._tutResize) {
    window.removeEventListener('resize', state._tutResize);
    state._tutResize = null;
  }
  state.tutorialActive = false;
  state.tutorialQueue  = [];
}

// ============================================================
// RESET CONTROL (purge all saved progress)
// ============================================================
// The save system is otherwise invisible; the header's circular-arrow button is
// its one interactive surface. It opens a confirmation, then purges the run
// checkpoint and tutorial flags (the high score persists) and reloads.

function initResetButton() {
  const btn = document.getElementById('reset-save-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.blur();          // don't let a stray ENTER re-trigger the button
    showResetConfirm();
  });
}

function showResetConfirm() {
  if (state.confirmingReset) return;
  state.confirmingReset = true;

  // Freeze the countdown while the player decides (death shouldn't happen here).
  if (state.phase === 'PLAYING' && state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
    state.resetPausedTimer = true;
  }

  const modal = document.getElementById('reset-confirm');
  modal.innerHTML =
    '<div class="reset-modal">' +
      '<div class="reset-modal-title">RESET ALL PROGRESS?</div>' +
      '<div class="reset-modal-body">This permanently purges your saved run and ' +
        'tutorial history. Your high score is kept. The Organization offers no ' +
        'other backups. This cannot be undone.</div>' +
      '<div class="reset-modal-actions">' +
        '<button type="button" class="reset-modal-btn" id="reset-cancel">CANCEL</button>' +
        '<button type="button" class="reset-modal-btn danger" id="reset-confirm-btn">PURGE</button>' +
      '</div>' +
    '</div>';
  modal.classList.remove('hidden');

  document.getElementById('reset-cancel').addEventListener('click', cancelResetConfirm);
  document.getElementById('reset-confirm-btn').addEventListener('click', performReset);
}

function cancelResetConfirm() {
  if (!state.confirmingReset) return;
  state.confirmingReset = false;

  const modal = document.getElementById('reset-confirm');
  modal.classList.add('hidden');
  modal.innerHTML = '';

  // Resume the countdown if we paused it and play is still live.
  if (state.resetPausedTimer) {
    state.resetPausedTimer = false;
    if (state.phase === 'PLAYING' && !document.hidden && !state.tutorialActive) {
      state.timerInterval = setInterval(tickTimer, 1000);
    }
  }
}

function performReset() {
  // Purge every K.A.C.S. key (run checkpoint + tutorial flags) EXCEPT the high
  // score, which is a permanent record and survives a reset.
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('kacs_') && k !== 'kacs_highscore')
      .forEach(k => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
  // A full reload guarantees a clean slate (fresh start screen, re-armed tips).
  location.reload();
}

// ============================================================
// EVENT LISTENERS
// ============================================================

document.addEventListener('keydown', e => {
  // Ignore browser shortcuts
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  // The reset-confirmation modal captures input: ESC cancels; nothing else acts
  // (PURGE is click-only so a reflexive ENTER can't wipe everything).
  if (state.confirmingReset) {
    e.preventDefault();
    if (e.key === 'Escape') cancelResetConfirm();
    return;
  }

  // A tutorial tip captures all input: ENTER/SPACE dismiss it, everything else
  // is swallowed so the player can't act on a panel they're still being shown.
  if (state.tutorialActive) {
    e.preventDefault();
    if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
      dismissTutorial();
    }
    return;
  }

  // The held GAME OVER splash swallows the next keypress to reveal the recap.
  if (state.awaitingGameOverAck) {
    e.preventDefault();
    ackGameOver();
    return;
  }

  // Enter (main or numpad) starts the game / leaves the break room.
  if (e.key === 'Enter') {
    if (state.phase === 'START') {
      startGame();
      return;
    }
    if (state.phase === 'BREAK_ROOM') {
      leaveBreakRoom();
      return;
    }
  }

  const code = eventKeyId(e);

  // Stop game keys (and scroll keys) from triggering browser behaviour —
  // e.g. '/' quick-find, "'" find-as-you-type, space/arrow scrolling.
  if (BINDABLE_SET.has(code) ||
      ['Space','ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(code)) {
    e.preventDefault();
  }

  if (state.phase === 'START') return;
  handleKeyInput(code);
});

// Pause the game timer when the player switches tabs
document.addEventListener('visibilitychange', () => {
  if (state.phase !== 'PLAYING') return;
  if (document.hidden) {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
      state.timerPaused   = true;
      addToLog('-- MONITORING SUSPENDED: TAB INACTIVE --', 'log-warning');
    }
  } else if (state.timerPaused) {
    state.timerPaused   = false;
    state.timerInterval = setInterval(tickTimer, 1000);
    addToLog('-- MONITORING RESUMED --', 'log-info');
  }
});

// ============================================================
// BOOT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Render an empty binding grid behind the overlay for aesthetics
  initKeyBindings();
  renderKeyBindings();
  document.getElementById('highscore-num').textContent = loadHighScore();
  initResetButton();

  // Resume from the last break-room checkpoint if one survived; else fresh start.
  const saved = loadCheckpoint();
  if (saved && restoreCheckpoint(saved)) {
    resumeBreakRoom();
  } else {
    clearCheckpoint();   // discard anything unreadable/stale
    showStartScreen();
  }
});
