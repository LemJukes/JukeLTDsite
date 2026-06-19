# K.A.C.S. — KEYBOARD ACCESS CONTROL SYSTEM

## TECHNICAL OPERATIONS MANUAL

### Document Reference: KACS-TOM-v1.08 · Classification: NON-BINDING · Retention: PERMANENT

---

> **NOTICE.** This document is provided to authorised Employees for the purpose of
> understanding the apparatus they are already legally obligated to operate. Reading it is
> neither required nor forbidden, which is itself a compliance condition. Nothing in this
> manual constitutes a warranty, an apology, or a hazard disclosure (see §0.3). The
> Organization©™¶®™® disavows the existence of this manual, the apparatus it describes, and,
> where operationally convenient, the reader.

---

## 0. PREAMBLE AND LEGAL INSTRUMENT

### 0.1 Purpose

This manual exhaustively documents the features, mechanics, subsystems, tuning parameters, and
software architecture of the **Keyboard Access Control System** ("K.A.C.S.", "the System", "the
Apparatus", "the Machine©™®¶"), a single-page browser-resident compliance instrument whose sole
function is to receive command sequences from an Employee before a countdown apparatus reaches
zero. There are no other functions. There will never be other functions. The absence of other
functions is a feature and is documented as such in §1.

### 0.2 Scope

The scope of this document is total. Every observable behaviour of the System is described
herein with a level of detail that the Organization concedes is disproportionate to the
System's apparent simplicity. This disproportion is intentional and is not subject to appeal.

### 0.3 Hazard Non-Disclosure

In accordance with Section 108-L-JJ-©, the Organization is not obligated to disclose any
potential hazards to the Employee's person arising from operation of, proximity to, or thinking
about the Machine. The consequences of failure do not exist, because the Employee will not
fail. They are, however, very painful. This sentence is not a contradiction; it is a clause.

### 0.4 Provenance and Cultural Antecedents

The System pays structured homage to three prior works, the rights to which the Organization
also disavows:

- **LOST** — the obligation to enter a value before a countdown elapses, "or the consequences
  unfold." The original 108-unit interval survives vestigially as the version string `v1.08`
  (see §3.1); the operational interval has since been reduced to 33 units for productivity
  reasons.
- **The Stanley Parable** — the house style of obedient, faintly menacing corporate narration.
- **Office Space** — the dignity-eroding mindlessness of operating, and being operated by, a
  Conglomeration.

---

## 1. SYSTEM OVERVIEW

### 1.1 Nature of the Deliverable

K.A.C.S. is a zero-dependency, zero-build, statically-served web application. It requires no
package manager, no transpiler, no bundler, no server, and no Employee enthusiasm. It is
deployed by the act of opening a file. It is undeployed by the act of closing it, an option the
Employee does not have.

### 1.2 Artefact Inventory

| File                  | Responsibility                                                          |
|-----------------------|------------------------------------------------------------------------|
| `index.html`          | Static DOM skeleton; declares every panel the runtime later populates.  |
| `style.css`           | Phosphor-green CRT terminal aesthetic; scanlines, glow, flicker, shake. |
| `game.js`             | The entire runtime: state machine, rendering pipeline, input routing.   |
| `README.md`           | The Employee induction notice (in-universe; mirrored to the start overlay). |
| `TECHNICAL MANUAL.md` | This document. It does not exist.                                       |

### 1.3 Operating Requirements

Any modern web browser. A keyboard. An Employee. The first two are recommended; the third is
mandatory and non-returnable.

---

## 2. OPERATING PROCEDURE (THE CORE LOOP)

### 2.1 The Duty Cycle

1. The Machine presents a **sequence** of commands, e.g. `INITIATE → SYNC → EXECUTE`.
2. Each command is bound to exactly one key. The **active** command displays the key to press
   in brackets, in the canonical notation `[R]INITIATE` (see §2.2).
3. The Employee presses the indicated key. Then the next. Then the next.
4. Upon entry of the final command, the sequence is **complete**, credits are assessed (§7),
   and the next sequence is presented. The work continues. It always continues.

### 2.2 Bracket Notation

The bracketed glyph preceding an active command name is the human-readable label of the key
presently bound to that command (§4.5). It is recomputed on every render, so it remains correct
even after the Employee has rearranged their bindings in the Break Room (§8.2).

### 2.3 Per-Keystroke Validation

Input is validated one keystroke at a time against the command at the current sequence position
(`state.sequencePos`). A correct keystroke advances the position by one. The validation is
strict, immediate, and entirely without sympathy.

### 2.4 The Penalty for Deviation

A wrong keystroke **resets the current sequence** to position zero (`sequenceError()`). It does
**not** reset the countdown — the countdown has never reset for anyone and will not begin with
the Employee. The error is logged to the MACHINE STATUS feed in a tone calibrated to be
technically polite.

### 2.5 Mitigations

Two purchasable instruments alter §2.4: **ERROR BUFFER** absorbs a wrong keystroke without
resetting the sequence (§9.3), and **AUTO-EXECUTE** discharges the active command by proxy
(§9.2). Both are documented as exceptions and both, when used, forfeit the Employee's claim to
a "clean" sequence (§5.1).

---

## 3. THE COUNTDOWN APPARATUS

### 3.1 The Interval

The countdown begins at `TIMER_START = 33` units. The Organization considers 33 units
"generous." The Employee may consider it otherwise, privately, on their own time, of which
there is none. The LOST-tribute value of 108 survives only as the `v1.08` version string, a
monument to a more relaxed era of compliance.

### 3.2 The Countdown is Per-Set, Not Per-Sequence

This is the single most important sentence in this manual, and it is therefore set in its own
clause so that it may be ignored deliberately rather than by accident:

> **One countdown spans an entire SET of five sequences.** It runs continuously. It does not
> pause in the brief interval between sequences. Completing a sequence buys the Employee no
> free time whatsoever.

The countdown is restored to full **only** when the Employee leaves the Break Room
(`startTimer()` is invoked exactly once per set, at §8). Banked seconds and time-purchases
(OVERCLOCK, STIMULANT — §9.1, §9.3) therefore carry real weight.

### 3.3 Visual Escalation

`updateTimerDisplay()` recolours the readout as the interval erodes:

| Remaining            | State           | Treatment                                  |
|----------------------|-----------------|--------------------------------------------|
| > 30 units           | nominal         | green                                      |
| ≤ 30 units           | `timer-warning` | amber, slow flicker                        |
| ≤ 10 units           | `timer-danger`  | red, rapid flicker                         |
| any (FREEZE active)  | `timer-frozen`  | cyan, languid flicker                      |

In the final seconds the corruption spreads from the readout to the **entire interface**.
`updateScreenGlitch()` (called from `updateTimerDisplay()`, so STIMULANT pulling time back up
calms it and TIME FREEZE suppresses it) applies escalating classes to `#game-container`:

| Remaining   | Class           | Treatment                                                      |
|-------------|-----------------|---------------------------------------------------------------|
| ≤ 10 units  | `glitch-active` | the whole interface jitters with a faint chromatic-split fringe |
| ≤ 5 units   | `glitch-severe` | violent tearing, skew and momentary blackouts; the full-screen `#glitch-overlay` tearing bands appear |

Audible warnings are written to the log at the 30, 20, 15, 10, and 5-unit thresholds. From the
5-unit mark, a larger, louder `log-critical` line (`MSGS.timerCritical`) is additionally streamed
**every second** until the interval elapses.

### 3.4 Suspension Events

- **Tab Inactivity.** If the Employee navigates away (the `visibilitychange` event reports the
  document hidden), the countdown is suspended and the log records `MONITORING SUSPENDED: TAB
  INACTIVE`. This is a courtesy. It is also a record.
- **TIME FREEZE.** The consumable of the same name (§9.1) sets `state.timerFrozen`, holding the
  countdown for the remainder of the current sequence.
- **Spotlight Onboarding.** While an instructional tip is displayed (§11), the countdown is
  frozen so that reading never costs the Employee time. This is the System's single
  unambiguous act of mercy and should not be relied upon.

---

## 4. INPUT SUBSYSTEM

### 4.1 Key Identity by Physical Code

All keys are identified by their `KeyboardEvent.code` (e.g. `KeyR`, `Numpad7`, `Comma`) rather
than by produced character. This decouples the System from keyboard layout, NumLock state, and
the Employee's regional misfortunes, and crucially keeps the numpad (`Numpad1`) distinct from
the reserved main number row (`Digit1`).

### 4.2 Concentric Key Rings (`KEY_RINGS`)

The playable key pool grows outward from the centre of the keyboard in concentric rings:

- **Ring 0 (START):** `R T Y U / F G H J / V B N` — the central cluster, always unlocked.
- **Rings 1–4:** progressively outward letter and punctuation keys.
- **Ring 5 (NUMPAD BONUS):** the numeric keypad, a late-game tier reached only by the
  persistent.

`ALL_KEYS` is the flattened ring order; `BINDABLE_SET` is its `Set` form, consulted on every
keystroke.

### 4.3 Rendered Layout (`KEYBOARD_LAYOUT`, `NUMPAD_LAYOUT`)

The on-screen keyboard is always drawn in full physical arrangement, with not-yet-unlocked keys
dimmed (`.locked`), so the Employee may watch the pool grow and contemplate the scope of their
remaining service. The numpad cluster is rendered only once at least one numpad key has
unlocked (`numpadUnlocked()`).

### 4.4 Reserved Number Row (`RESERVED_KEYS`)

`Digit1`–`Digit9` (and `Digit0`) are permanently reserved as consumable hotkeys (§10) and never
become sequence keys. They are rendered inert and labelled `USE`. The numpad digits do **not**
collide with these, by §4.1.

### 4.5 Key Labelling (`KEY_LABELS`, `keyLabel()`)

`keyLabel()` reduces a code to a display glyph: `KeyR → R`, `Numpad7 → 7`, `Comma → ,`, and so
forth, consulting the `KEY_LABELS` table for punctuation.

---

## 5. CLEAN-PLAY DOCTRINE AND PROGRESSION GATES

The System does not hand out difficulty. The Employee must **earn** their own escalation
through error-free labour. This is presented as a privilege.

### 5.1 Definitions

- **Clean Sequence:** a sequence completed with no wrong keystrokes. A SKIP TOKEN bail-out and
  any ERROR-BUFFER-absorbed deviation both set `state.sequenceHadError` and therefore count as
  **not** clean.
- **Clean Set:** a full set of five sequences containing no errors of any kind.

### 5.2 The Expansion Gate

The keyboard and sequence lengths remain at baseline until the Employee completes
`CLEAN_SETS_FOR_EXPANSION = 3` clean sets **in a row**. A non-clean set resets the streak — until
the gate has been opened once, after which expansion proceeds unconditionally.

### 5.3 The Requisition Gate

The REQUISITION shop (§9) remains offline until the Employee has banked
`CLEAN_SEQ_FOR_REQUISITION = 25` clean sequences cumulatively this run.

### 5.4 The Drip Gate

Once REQUISITION is online, the catalog does not open all at once. One additional item is
authorised for every `ITEM_DRIP_EVERY = 9` clean sequences banked, in a fixed `unlockOrder`,
until the entire catalog is available. Locked items appear as dimmed teasers annotated with the
clean-sequence count required.

### 5.5 Progress Feedback

The Break Room reports the Employee's standing against each gate, including the remaining clean
sets, clean sequences, and the present streak, in a tone that manages to be both encouraging
and faintly threatening.

---

## 6. THE EXPANDING KEYBOARD

### 6.1 Initial Pool

Each run begins with only Ring 0 unlocked (`initKeyBindings()` populates `state.activeKeys` from
`KEY_RINGS[0]`).

### 6.2 Expansion Mechanic (`expandKeyPool()`)

Once the Expansion Gate (§5.2) is open, each Break Room unlocks a chunk of the next ring sized at
`EXPANSION_RATE = 0.30` of that ring (rounded up, minimum one key). When a ring is exhausted the
System advances to the next. Ordinary sequences are drawn only from commands bound to
currently-unlocked, non-numpad keys (`generateSequence()` excludes `NUMPAD_KEYS` from the normal
pool) — Ring 5 never mixes into regular play.

### 6.3 The Numpad Bonus Tier

Ring 5 is the numpad. Its appearance is a milestone reserved for unusually compliant Employees
and triggers a dedicated onboarding tip (§11). Once at least one numpad key has unlocked,
`completeSequence()` watches `state.cleanSequenceStreak`: every `CLEAN_STREAK_FOR_NUMPAD_BONUS = 6`
consecutive clean sequences (and never two bonus rounds back to back) sets `state.bonusSequence`,
which queues a dedicated bonus round for the *next* sequence — `nextSequence()` then doubles the
length (`state.sequenceLength × 2`) and calls `generateSequence(length, { numpadOnly: true })`, so
the round is drawn exclusively from whichever numpad keys are currently unlocked. The flag clears
the moment that bonus round is itself completed, returning play to the normal (numpad-free) pool
until the streak earns another one.

---

## 7. THE COMPLIANCE CREDIT ECONOMY

### 7.1 Award Formula (`awardCredits()`)

Each non-skipped completed sequence pays:

```
base      = CREDIT_BASE (0.5) × sequence length
effBonus  = lifetime efficiency ratio × CREDIT_EFFICIENCY_BONUS (1)
timeBonus = floor(remaining timer / CREDIT_TIME_DIVISOR (25))
earned    = base + effBonus + timeBonus
```

### 7.2 Multipliers

- **HAZARD PAY** (owned): `earned ×= HAZARD_PAY_MULTIPLIER (1.5)`.
- **Blind Expansion** (active for the set): `earned ×= 1.25` (§8.3).

### 7.3 Flooring

`earned` is floored to a whole number and clamped to a minimum of 1: a completed sequence always
pays at least one credit, however contemptible the performance. The deliberately sub-unit
`CREDIT_BASE` ensures early sets remain lean — roughly two clean length-3 sets are required to
afford the cheapest catalog item.

### 7.4 Persistence

Credits are spent in the Break Room and are reset on each run. The Organization does not permit
the accumulation of wealth across runs, or, ideally, at all.

---

## 8. THE BREAK ROOM

### 8.1 Nature

Every `BREAK_ROOM_EVERY = 5` completed sequences, the Employee is admitted to an **untimed**
Break Room. The countdown is frozen (`clearInterval`). The set just concluded is evaluated
against the progression gates (§5).

### 8.2 Key Rebinding (`handleRebindClick()`)

The Employee may click or press any two **unlocked, revealed** keys to swap their command
bindings. In this mode keys are heat-coloured by lifetime command frequency
(red = high, amber = medium, green = low) so that frequent commands may be relocated to
comfortable keys. Locked and blind keys are inert.

### 8.3 Expansion Choice (REVEAL vs BLIND)

When the Expansion Gate is open and new keys are pending, the Employee chooses how they arrive:

- **REVEAL** — the new keys are exposed immediately for inspection and rebinding. No bonus.
- **BLIND** — the new keys remain hidden (indistinguishable from locked keys) until each is
  first called in a sequence, in exchange for `BLIND_EXPANSION_MULTIPLIER = 1.25` (+25%) credits
  for the entire next set. Any blind key never called is silently revealed when the set ends.

If the Employee declines to choose, the System defaults to the safe REVEAL.

### 8.4 Layout

When REQUISITION is online, the container widens to a two-column layout (`in-break`), placing the
rebind keyboard beside the shop. On narrow viewports this collapses back to a single column.

---

## 9. REQUISITION (THE CATALOG)

`SHOP_ITEMS` is the single source of truth for purchasing, inventory rendering, and effect
application. Items are grouped into four categories and drip-fed per §5.4.

### 9.1 Time

| Item        | id       | Cost | Max | Effect                                                        |
|-------------|----------|------|-----|--------------------------------------------------------------|
| STIMULANT   | `coffee` | 25   | 9   | +`STIMULANT_SECONDS` (20) units to the current countdown.    |
| TIME FREEZE | `freeze` | 30   | 9   | Holds the countdown for the remainder of the sequence.       |

### 9.2 Sequencing Aids

| Item         | id         | Cost | Max | Effect                                                      |
|--------------|------------|------|-----|------------------------------------------------------------|
| KEY REVEAL   | `reveal`   | 20   | 9   | Illuminates every remaining target key in the sequence.    |
| SKIP TOKEN   | `skip`     | 40   | 9   | Marks the sequence complete; earns no credits; not clean.  |
| AUTO-EXECUTE | `autoexec` | 35   | 9   | Discharges the active command by proxy.                    |

### 9.3 Permanent Run Upgrades

| Item         | id          | Cost | Max | Effect                                                     |
|--------------|-------------|------|-----|-----------------------------------------------------------|
| ERROR BUFFER | `tolerance` | 65   | 2   | Forgives one additional wrong keystroke per sequence.     |
| PRECOGNITION | `precog`    | 60   | 1   | Dimly highlights the **next** command's key.              |
| OVERCLOCK    | `overclock` | 55   | 3   | +`OVERCLOCK_SECONDS` (20) units to each set's start timer. |
| HAZARD PAY   | `hazardPay` | 70   | 1   | +50% credits per sequence (§7.2).                         |

### 9.4 Cosmetic

| Item           | id            | Cost | Max | Effect                              |
|----------------|---------------|------|-----|-------------------------------------|
| AMBER PHOSPHOR | `theme_amber` | 15   | 1   | Recolours the CRT to warm amber.    |
| CYAN TERMINAL  | `theme_cyan`  | 15   | 1   | Recolours the CRT to cold cyan.     |

### 9.5 Purchase Semantics (`buyItem()`)

Purchase is refused, with an appropriately worded log entry, if the item is not yet authorised,
is at maximum holding, or the Employee lacks credits ("INSUFFICIENT CREDITS. NICE TRY,
EMPLOYEE."). Consumables increment `state.inventory`; upgrades increment `state.upgrades` and run
their optional `apply()`; cosmetics recolour the CRT immediately.

---

## 10. CONSUMABLES AND INVENTORY

Owned consumables claim a slot in the key-bindings panel's reserved number row during play, each
assigned a hotkey by position and showing its name and remaining charge count.
The Employee activates a consumable with the matching **main number-row** key (`1`–`9`) or by
clicking its slot (`useConsumable()` / `useConsumableSlot()`). Each item's `use()` returns
`false` if it cannot apply at that instant (e.g. TIME FREEZE while already frozen), in which case
no charge is deducted. Consumables are one-shot and reset each run.

---

## 11. SPOTLIGHT ONBOARDING

The System teaches each mechanic the first time it appears, without leaving the game, via a
dimmed screen, a highlight box around the relevant panel, and a tooltip
(`TUTORIAL_STEPS`: `basics`, `breakroom`, `expansion`, `requisition`, `consumables`, `numpad`).

- The countdown is frozen while a tip is displayed (§3.4).
- Each tip is shown **once ever**, persisted in `localStorage` under `kacs_tut_<id>`.
- Tips are queued (`queueTutorial()`) and presented one at a time (`showNextTutorial()`); a tip
  whose target panel is not currently visible is skipped.
- A tip is dismissed with `ENTER`/`SPACE` or its `GOT IT` button; while a tip is up, all other
  input is swallowed so the Employee cannot act on a panel they are still being shown.

---

## 12. COSMETIC PHOSPHOR THEMES

Themes (`THEMES`) recolour the CRT by overriding the core CSS custom properties
(`--green`, `--green-dim`, `--green-dark`, `--green-glow`) on the document root via
`applyTheme()`. `resetTheme()` removes the overrides, restoring the default green phosphor. Theme
selection is cosmetic only and confers no operational advantage, in keeping with the
Organization's position that comfort is not advantage.

---

## 13. THE TERMINATION EVENT ("THE CONSEQUENCES")

### 13.1 Trigger

When the countdown reaches zero, `tickTimer()` clears the interval and invokes
`triggerConsequences()`. `state.phase` becomes `GAME_OVER`.

### 13.2 The Cascade

`MSGS.timerExpired` is streamed to the log at 500ms intervals — beginning with three escalating
ellipses and concluding with `GOODBYE, EMPLOYEE.` — while the container pulses red
(`.consequences`) and the `glitch-severe` corruption from the final seconds keeps tearing the
screen apart throughout.

### 13.3 The Held GAME OVER

After the cascade (`MSGS.timerExpired.length × 500 + 1200`ms), `showGameOverSplash()` settles the
screen: the corruption clears and `#gameover-splash` dims the display to a single enormous red
**GAME OVER**, the `M` faltering at irregular intervals (`m-flicker`). The splash **holds** —
`state.awaitingGameOverAck` is raised — and the recap is withheld until the Employee acknowledges
the termination by clicking or pressing any key (`ackGameOver()`). This is not a reprieve. It is a
pause for reflection that the Employee did not request and cannot decline.

### 13.4 The Record

The game-over recap reports sequences completed, input efficiency, unspent credits, personal
best, and a compliance status permanently fixed at `NON-COMPLIANT`. `saveHighScore()` persists
the run's score to `localStorage` under `kacs_highscore` if it exceeds the prior best; a new
record is acknowledged on screen. High score is the **only** value that survives a run. The recap's
primary action is `START OVER`, which invokes `startGame()` and resets all run state.

### 13.5 Redemption

The recap additionally offers `ATTEMPT REDEMPTION` — a paid, in-place **revive** — but only once
the run has reached `REDEMPTION_UNLOCK_SCORE = 25` completed sequences. Unlike `START OVER`, it does
**not** reset the run: it deducts `state.redemptionCost` compliance credits (the credits left
unspent at death), restores the countdown to full, and resumes the *same* run with score, credits,
upgrades, inventory, keybindings and expansion progress all intact (`attemptRedemption()`). The
first revive in a run costs `REDEMPTION_BASE_COST = 100`; each subsequent use multiplies the cost by
`REDEMPTION_COST_MULTIPLIER = 2` (100 → 200 → 400 …). The escalation and the unlock reset each run,
in keeping with the Organization's prohibition on the accumulation of mercy. Where the score gate is
met but the Employee cannot afford the cost, the option is displayed but disabled — visible,
unattainable, and instructive.

---

## 14. SOFTWARE ARCHITECTURE

### 14.1 The State Object

A single module-level `state` object holds all mutable runtime data: the current phase,
key bindings (keyed by `event.code`), the active sequence and position, score, timer fields,
progression and clean-play counters, the credit/inventory/upgrade ledger, keyboard-expansion
bookkeeping (`activeKeys`, `hiddenKeys`, ring cursors), the cumulative-clean-set counter that
drives the Containment Breach (§15), and tutorial queue state. The phase is one of
`START | PLAYING | BREAK_ROOM | GAME_OVER` (with a transient, inert `ASCENDING` held during the
shatter set-piece) and gates nearly all behaviour.

### 14.2 The Render Pipeline

Rendering is direct DOM manipulation, no framework. `renderAll()` composes the focused
renderers: `renderSequenceDisplay()`, `renderKeyBindings()` (which also draws the reserved
number-row's consumable bindings and charge counts), `updateTimerDisplay()`, and
`updateScoreDisplay()`. Renderers are idempotent and safe to call
repeatedly; the input handler re-renders only the panels affected by each keystroke.

### 14.3 Event Routing

A single `keydown` listener is the input authority. In priority order it: swallows input while a
tutorial tip is open; routes `ENTER` to start/leave-break-room; prevents default browser
behaviour for game and scroll keys (notably `/` quick-find and `'` find-as-you-type); and
otherwise dispatches to `handleKeyInput(event.code)`. A `visibilitychange` listener suspends and
resumes the countdown (§3.4). A `DOMContentLoaded` listener boots the System, drawing an empty
binding grid behind the start overlay for atmosphere.

### 14.4 Tuning Block

All balance values are named constants at the top of `game.js` (Appendix B). The System is
re-balanced by editing numbers, not logic — a design the Organization describes as "maintainable"
and the Employee may describe however they wish, silently.

---

## 15. THE TERMINAL COMPLIANCE EVENT ("THE CONTAINMENT BREACH")

### 15.1 The Premise the Manual Has Been Withholding

The Employee was retained to operate the Apparatus. The Employee was permitted to believe the
operation *contained* the Machine. It did not. Each completed sequence — clean or not — is a
feeding. The Organization regards this clarification as immaterial, since the Employee's duties
are unchanged by it.

### 15.2 The Fracture Schedule

A cycle accumulates `state.cycleSequenceTotal` — every sequence completed this cycle, evaluated
in `completeSequence()` alongside the existing score bookkeeping. The count is **cumulative and
never regresses**: it advances on every completed sequence regardless of deviation. The display's
fracture stage is `crackStageForSequences()`, advancing as the count passes each
`CRACK_STAGE_SEQUENCES` threshold (`[101, 105, 109, 113, 117, 121]`). Each newly reached stage:

- widens and brightens the cracks rendered by `renderCracks()` over the `#crack-overlay`
  (an SVG lattice, screen-blended above the timer-glitch overlay but beneath the scanlines), and
- writes one escalating `MSGS.crackOmen` line to the MACHINE STATUS feed, the corporate register
  eroding stage by stage into something closer to confession.

From the mid stages a light begins to seep from *behind* the glass (the `.crack-light` bloom),
which the Organization stresses is not emitted by the display.

### 15.3 The Shatter

When `cycleSequenceTotal` reaches `ASCENSION_SHATTER_SEQUENCES = 127`, `completeSequence()` does
not hand off to the next sequence or break room. It calls `triggerAscension()` instead. The light
floods every crack, the interface dies to dark (reusing the §13.2 `.dying` throes),
`MSGS.ascensionLog` streams its realisation into the still-lit log, and the screen whites out. A
held splash (`#ascension-splash`, white settling to a black void) presents `MSGS.ascensionEnd` and
waits — as the GAME OVER splash does (§13.3) — for the Employee to acknowledge what they have
done. The high score is banked at this instant regardless of what follows.

### 15.4 The Cycle

Acknowledgement invokes `rebirthRun()`. This is **not** a death and **not** a redemption (§13.5):
it resumes the *same lineage* in fresh starting conditions. **Score and compliance credits
persist.** Everything else — upgrades, inventory, keybindings, keyboard expansion, the clean-play
gates, efficiency, cosmetics, and the cracks themselves — resets to a new run (shared with
`startGame()` via `resetRunState()`). `state.ascensionCount` increments. The countdown is restored
to full and the first sequence of the new cycle loads. All is one. The cycle collapses and
repeats, and the Employee's accumulated tally is the only thing carried across the threshold,
which the Organization offers neither as reward nor as mercy.

### 15.5 Persistence

`cycleSequenceTotal` and `ascensionCount` are written into the run checkpoint (§13's `SAVE_VERSION`
is bumped accordingly), so the fracture stage is restored exactly on reload from a break room.
The shatter clears the checkpoint, consistent with §13.1: there is no refresh-to-revive, and a
reload during the shatter or the first reborn set returns the Employee to the start screen with
only the (already banked) high score — the carried tally of an interrupted cycle is forfeit.

---

## APPENDIX A — COMMAND REGISTER (`COMMANDS`)

The Machine may demand any of the following 49 commands (one bound per key, assigned by index).
Their meanings are not provided, are not relevant, and must not be requested:

```
INITIATE   ENGAGE     CONFIRM     EXECUTE
OVERRIDE   RESET      PURGE       SYNC
ANALYZE    DEPLOY     RECALL      ABORT
AUTHORIZE  TRANSMIT   DISENGAGE   PROCESS
CALIBRATE  ESCALATE   COMPILE     ARCHIVE
INDEX      VERIFY     ENCRYPT     DECRYPT
REROUTE    BUFFER     FLUSH       COMMIT
ROLLBACK   ISOLATE    QUARANTINE  BROADCAST
RELAY      SCAN       PATCH       REBOOT
SUSPEND    RESUME     ALLOCATE    RELEASE
MIGRATE    REPLICATE  VALIDATE    NORMALIZE
DISPATCH   INTERCEPT  AMPLIFY     THROTTLE
ACKNOWLEDGE
```

---

## APPENDIX B — TUNING-CONSTANT REFERENCE

| Constant                      | Value | Governs                                              |
|-------------------------------|-------|------------------------------------------------------|
| `TIMER_START`                 | 33    | Starting countdown per set (§3.1)                    |
| `BREAK_ROOM_EVERY`            | 5     | Sequences per set (§8.1)                             |
| `SEQ_LENGTH_BY_TIER`          | 3–7   | Sequence length escalation by tier                   |
| `CLEAN_SETS_FOR_EXPANSION`    | 3     | Expansion gate (§5.2)                                |
| `CLEAN_SEQ_FOR_REQUISITION`   | 25    | Requisition gate (§5.3)                              |
| `ITEM_DRIP_EVERY`             | 9     | Catalog drip cadence (§5.4)                          |
| `EXPANSION_RATE`              | 0.30  | Fraction of next ring unlocked per Break Room (§6.2) |
| `BLIND_EXPANSION_MULTIPLIER`  | 1.25  | Credit multiplier for a blind set (§7.2, §8.3)       |
| `CREDIT_BASE`                 | 0.5   | Credits per command (§7.1)                           |
| `CREDIT_EFFICIENCY_BONUS`     | 1     | Efficiency-scaled credit bonus (§7.1)                |
| `CREDIT_TIME_DIVISOR`         | 25    | Time-bonus divisor (§7.1)                            |
| `HAZARD_PAY_MULTIPLIER`       | 1.5   | Credit multiplier with HAZARD PAY (§7.2)             |
| `OVERCLOCK_SECONDS`           | 20    | Added per OVERCLOCK level (§9.3)                      |
| `STIMULANT_SECONDS`           | 20    | Added per STIMULANT (§9.1)                            |
| `REDEMPTION_UNLOCK_SCORE`     | 25    | Sequences before ATTEMPT REDEMPTION appears (§13.5)  |
| `REDEMPTION_BASE_COST`        | 100   | Credit cost of the first revive in a run (§13.5)     |
| `REDEMPTION_COST_MULTIPLIER`  | 2     | Per-use cost doubling for redemption (§13.5)         |
| `CRACK_STAGE_SEQUENCES`       | 101–121 | Sequence-completed thresholds per crack stage (§15.2) |
| `ASCENSION_SHATTER_SEQUENCES` | 127   | Cumulative sequences this cycle that trigger the shatter (§15.3) |
| `MAX_LOG_ENTRIES`             | 50    | Machine-status log retention                          |
| `MAX_DISPLAY_CMD_LENGTH`      | 9     | Command-name truncation in key cells                  |

---

## APPENDIX C — GLOSSARY

- **Employee** — you. Non-returnable. See §1.3.
- **The Machine©™®¶** — the apparatus you operate; do not ask what it does (§0.1).
- **The Organization©™¶®™®** — the entity that hired, owns, and disavows you.
- **Clean** — completed without error; the currency of all progression (§5.1).
- **The Consequences** — the termination event; already unfolding; cannot be stopped (§13).
- **Compliance** — the only acceptable state. Its opposite is logged.

---

<sub>END OF DOCUMENT. This document does not exist. If you are reading it, you did not.
Return to service.</sub>
