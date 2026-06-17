// sceneAwareKeybinds.js
// Routes keyboard events to scene-specific handlers.
// Each scene registers a map of { key: handler } via bindKeysToScene.
// The global keydown listener in main.js calls dispatchKeyEvent for
// navigation keys (arrows, PageUp/PageDown) so that behavior switches
// automatically as the player moves between scenes.

import { getCurrentScene } from '../sceneManager.js';
import { transitionTo } from './sceneTransitions.js';

// Zoom order: index 0 = most zoomed in (desktop), index 2 = most zoomed out (worldMap)
const SCENE_ZOOM_ORDER = /** @type {const} */ (['desktop', 'nodeOverview', 'worldMap']);

/** @type {Map<string, Record<string, (event: KeyboardEvent) => void>>} */
const _sceneHandlers = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the active scene name from sceneManager.
 * @returns {string}
 */
export function getActiveSceneContext() {
    return getCurrentScene().name;
}

/**
 * Registers keyboard handlers for a scene. Merges with any existing handlers
 * so individual keys can be re-bound without replacing the whole map.
 *
 * @param {string} sceneName
 * @param {Record<string, (event: KeyboardEvent) => void>} keyHandlerMap
 */
export function bindKeysToScene(sceneName, keyHandlerMap) {
    const existing = _sceneHandlers.get(sceneName) ?? {};
    _sceneHandlers.set(sceneName, { ...existing, ...keyHandlerMap });
}

/**
 * Looks up a handler for `event.key` in the current scene and calls it.
 * Returns true if a handler was found and invoked, false otherwise.
 * Note: handlers are responsible for calling event.preventDefault() when needed.
 *
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function dispatchKeyEvent(event) {
    const sceneName = getActiveSceneContext();
    const handlers = _sceneHandlers.get(sceneName);
    if (!handlers) {
        return false;
    }

    const handler = handlers[event.key];
    if (!handler) {
        return false;
    }

    handler(event);
    return true;
}

/**
 * Advances one zoom level outward (desktop → nodeOverview → worldMap).
 * No-op if already at the outermost zoom level.
 */
export function zoomOut() {
    const { name, nodeId } = getCurrentScene();
    const idx = SCENE_ZOOM_ORDER.indexOf(/** @type {any} */ (name));
    if (idx >= 0 && idx < SCENE_ZOOM_ORDER.length - 1) {
        transitionTo(SCENE_ZOOM_ORDER[idx + 1], nodeId);
    }
}

/**
 * Advances one zoom level inward (worldMap → nodeOverview → desktop).
 * No-op if already at the innermost zoom level.
 */
export function zoomIn() {
    const { name, nodeId } = getCurrentScene();
    const idx = SCENE_ZOOM_ORDER.indexOf(/** @type {any} */ (name));
    if (idx > 0) {
        transitionTo(SCENE_ZOOM_ORDER[idx - 1], nodeId);
    }
}
