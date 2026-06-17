// sceneManager.js
// Owns all scene transitions: desktop ↔ nodeOverview ↔ worldMap.
// This is the ONLY module permitted to show or hide #desktop-shell,
// #netspace-canvas, and #node-overview-shell.

import { VALID_SCENE_NAMES } from './schemas/v2StateShape.js';

// ─────────────────────────────────────────────────────────────────────────────
// Internal state
// ─────────────────────────────────────────────────────────────────────────────

/** @type {{ name: string, nodeId: string|null }} */
let _currentScene = { name: 'desktop', nodeId: null };

/** @type {Set<(newScene: string, nodeId: string|null, prevScene: string) => void>} */
let _sceneChangeListeners = new Set();

/** @type {HTMLElement|null} */
let _desktopShell = null;

/** @type {HTMLCanvasElement|null} */
let _netspaceCanvas = null;

/** @type {HTMLElement|null} */
let _nodeOverviewShell = null;

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

function showEl(el) {
    if (el) {
        el.style.display = '';
        el.removeAttribute('aria-hidden');
    }
}

function hideEl(el) {
    if (el) {
        el.style.display = 'none';
        el.setAttribute('aria-hidden', 'true');
    }
}

function resizeCanvasToViewport() {
    if (!_netspaceCanvas) {
        return;
    }
    _netspaceCanvas.width = window.innerWidth;
    _netspaceCanvas.height = window.innerHeight;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — initialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finds and caches the scene DOM elements. Must be called once from main.js
 * after the DOM is ready. The desktop scene is assumed already visible
 * (handled by the boot sequence) so this does not alter visibility.
 */
export function initializeSceneManager() {
    _desktopShell = document.getElementById('desktop-shell');
    _netspaceCanvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('netspace-canvas'));
    _nodeOverviewShell = document.getElementById('node-overview-shell');

    // Register canvas resize handler for when worldMap scene is active
    window.addEventListener('resize', () => {
        if (_currentScene.name === 'worldMap') {
            resizeCanvasToViewport();
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — scene transitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unmounts the current scene by hiding all scene shells.
 * Call before mounting a new scene.
 */
export function unmountCurrentScene() {
    hideEl(_desktopShell);
    hideEl(_netspaceCanvas);
    hideEl(_nodeOverviewShell);
}

/**
 * Mounts a scene by name. Hides all other shells and shows the target shell.
 *
 * @param {'desktop'|'nodeOverview'|'worldMap'} sceneName
 * @param {string|null} [nodeId]
 */
export function mountScene(sceneName, nodeId = null) {
    if (!VALID_SCENE_NAMES.includes(sceneName)) {
        console.warn(`[sceneManager] Unknown scene: "${sceneName}"`);
        return;
    }

    // No-op if already on this scene with same nodeId
    if (_currentScene.name === sceneName && _currentScene.nodeId === nodeId) {
        return;
    }

    unmountCurrentScene();

    switch (sceneName) {
        case 'desktop':
            showEl(_desktopShell);
            break;

        case 'nodeOverview':
            showEl(_nodeOverviewShell);
            break;

        case 'worldMap':
            resizeCanvasToViewport();
            showEl(_netspaceCanvas);
            break;
    }

    const prevSceneName = _currentScene.name;
    _currentScene = { name: sceneName, nodeId: nodeId ?? null };
    _sceneChangeListeners.forEach((listener) => {
        try {
            listener(sceneName, nodeId ?? null, prevSceneName);
        } catch (error) {
            console.error('[sceneManager] Scene change listener failed.', error);
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registers a listener called on every scene transition.
 * Returns an unsubscribe function.
 *
 * @param {(newScene: string, nodeId: string|null, prevScene: string) => void} fn
 * @returns {() => void}
 */
export function registerSceneChangeListener(fn) {
    if (typeof fn !== 'function') {
        return () => {};
    }

    _sceneChangeListeners.add(fn);
    return () => {
        _sceneChangeListeners.delete(fn);
    };
}

/**
 * Returns a copy of the current scene descriptor.
 * @returns {{ name: string, nodeId: string|null }}
 */
export function getCurrentScene() {
    return { ..._currentScene };
}

/**
 * Returns the DOM element (or canvas) that represents the given scene shell.
 *
 * @param {'desktop'|'nodeOverview'|'worldMap'} sceneName
 * @returns {HTMLElement|HTMLCanvasElement|null}
 */
export function getSceneComponent(sceneName) {
    switch (sceneName) {
        case 'desktop':
            return _desktopShell;
        case 'nodeOverview':
            return _nodeOverviewShell;
        case 'worldMap':
            return _netspaceCanvas;
        default:
            return null;
    }
}
