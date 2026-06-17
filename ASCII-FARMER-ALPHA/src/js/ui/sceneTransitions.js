// ui/sceneTransitions.js
// Orchestrates animated scene transitions: fade-to-black crossfade and
// optional farmr guidance sequences.
//
// Usage:
//   import { transitionTo, registerFarmrApi } from './sceneTransitions.js';
//   transitionTo('worldMap', nodeId);         // fast crossfade
//   transitionTo('worldMap', null, lines);    // guidance → crossfade

import { mountScene } from '../sceneManager.js';
import { setNotificationTheme } from './macNotifications.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Duration (ms) for each leg of the crossfade (out or in). Total = 2×. */
const CROSSFADE_HALF_MS = 100;

// ── Module state ──────────────────────────────────────────────────────────────

/** @type {{ triggerVisit: Function, playScriptedVisit: Function, scheduleNextVisit: Function }|null} */
let _farmrApi = null;

/** @type {HTMLElement|null} */
let _overlayEl = null;

/** Whether a transition is currently in progress (re-entry guard). */
let _isTransitioning = false;

// ── Private helpers ───────────────────────────────────────────────────────────

function getOrCreateOverlay() {
    if (!_overlayEl) {
        _overlayEl = document.createElement('div');
        _overlayEl.className = 'scene-transition-overlay';
        _overlayEl.setAttribute('aria-hidden', 'true');
        document.body.appendChild(_overlayEl);
    }
    return _overlayEl;
}

function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Registers the ambient farmr API so `showFarmrGuidance` can trigger visits.
 * Called from main.js after `initializeAmbientFarmr()`.
 *
 * @param {{ playScriptedVisit: Function, triggerVisit: Function, scheduleNextVisit: Function }} api
 */
export function registerFarmrApi(api) {
    _farmrApi = api;
}

/**
 * Fades the screen to black over `durationMs`.
 * @param {number} [durationMs]
 */
export async function fadeOut(durationMs = CROSSFADE_HALF_MS) {
    const overlay = getOrCreateOverlay();
    overlay.style.transitionDuration = `${durationMs}ms`;
    overlay.classList.add('scene-transition-overlay--visible');
    await wait(durationMs + 20);
}

/**
 * Fades the screen back in from black over `durationMs`.
 * @param {number} [durationMs]
 */
export async function fadeIn(durationMs = CROSSFADE_HALF_MS) {
    const overlay = getOrCreateOverlay();
    overlay.style.transitionDuration = `${durationMs}ms`;
    overlay.classList.remove('scene-transition-overlay--visible');
    await wait(durationMs + 20);
}

/**
 * Triggers a scripted farmr guidance sequence: farmr walks in, displays each
 * line as a speech bubble, then walks out. Returns a Promise that resolves
 * when the sequence completes.
 *
 * No-op if the farmr API is unavailable (graceful degradation).
 *
 * @param {string[]} lines - Dialogue lines to display.
 * @param {number} [delayBetweenMs=3000] - Display duration per line.
 * @returns {Promise<void>}
 */
export async function showFarmrGuidance(lines, delayBetweenMs = 3000) {
    if (!_farmrApi?.playScriptedVisit) {
        return;
    }
    return _farmrApi.playScriptedVisit(lines, delayBetweenMs);
}

/**
 * Performs an animated scene transition.
 *
 * Sequence:
 *   1. If `guidanceScript` is provided → play farmr guidance
 *   2. Fade to black (CROSSFADE_HALF_MS)
 *   3. `mountScene(sceneName, nodeId)` — switches the active layer
 *   4. Fade from black (CROSSFADE_HALF_MS)
 *
 * Re-entrant calls during an active transition are silently dropped.
 *
 * @param {'desktop'|'nodeOverview'|'worldMap'} sceneName
 * @param {string|null} [nodeId]
 * @param {string[]|null} [guidanceScript] - Optional farmr lines before fade.
 */
export async function transitionTo(sceneName, nodeId = null, guidanceScript = null) {
    if (_isTransitioning) {
        return;
    }

    _isTransitioning = true;

    try {
        if (guidanceScript && guidanceScript.length > 0) {
            await showFarmrGuidance(guidanceScript);
        }

        const isNetspace = sceneName === 'nodeOverview' || sceneName === 'worldMap';
        setNotificationTheme(isNetspace ? 'netspace' : 'desktop');

        await fadeOut(CROSSFADE_HALF_MS);
        mountScene(sceneName, nodeId);
        await fadeIn(CROSSFADE_HALF_MS);
    } finally {
        _isTransitioning = false;
    }
}
