// netspace/cameraController.js
// Pan/zoom/center-on-node camera state for Net-Space Zoom 2.
// On init, self-registers with netspaceRenderer so the render loop ticks
// the lerp and reads the current camera position each frame.

import { getNodePosition } from './worldGraph.js';
import { setCameraController, setNodeSelectCallback } from './netspaceRenderer.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** World units to pan per arrow key press. */
export const ARROW_PAN_STEP = 60;

const LERP_SPEED  = 8;    // exponential lerp factor (1/sec)
const MIN_ZOOM    = 0.5;
const MAX_ZOOM    = 3;

/** Hard camera bounds in world space. */
const WORLD_BOUNDS = { minX: -600, maxX: 600, minY: -900, maxY: 300 };

/** Default camera matches the renderer's _defaultCamera so the view is
 *  unchanged when the controller first takes over. */
const DEFAULT_X    = 0;
const DEFAULT_Y    = -110;
const DEFAULT_ZOOM = 1;

// ── Module state ──────────────────────────────────────────────────────────────

let _x           = DEFAULT_X;
let _y           = DEFAULT_Y;
let _targetX     = DEFAULT_X;
let _targetY     = DEFAULT_Y;
let _currentZoom = DEFAULT_ZOOM;
let _targetZoom  = DEFAULT_ZOOM;
/** @type {string|null} */
let _targetNodeId = null;

// ── Private helpers ───────────────────────────────────────────────────────────

function _lerp(a, b, t) {
    return a + (b - a) * t;
}

function _clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resets camera to default position and self-registers with the renderer so
 * the render loop can tick and read camera state each frame.
 * The optional `_renderer` argument is accepted for API consistency with the
 * dev plan but the wiring is done via direct import.
 *
 * @param {object} [_renderer]
 */
export function initializeCameraController(_renderer = null) {
    _x           = DEFAULT_X;
    _y           = DEFAULT_Y;
    _targetX     = DEFAULT_X;
    _targetY     = DEFAULT_Y;
    _currentZoom = DEFAULT_ZOOM;
    _targetZoom  = DEFAULT_ZOOM;
    _targetNodeId = null;

    // Register tick + getCameraState with the renderer loop.
    setCameraController({ tick, getCameraState });

    // Wire canvas node-click events → center camera on that node.
    setNodeSelectCallback((nodeId) => centerOnNode(nodeId, 400));
}

/**
 * Returns a snapshot of the current camera interpolation state.
 * @returns {{ x: number, y: number, currentZoom: number, targetZoom: number, targetNodeId: string|null }}
 */
export function getCameraState() {
    return {
        x:            _x,
        y:            _y,
        currentZoom:  _currentZoom,
        targetZoom:   _targetZoom,
        targetNodeId: _targetNodeId,
    };
}

/**
 * Nudges the camera target by (dx, dy) in world space, clamped to world bounds.
 * Clears any locked-on node target so the camera returns to free-pan mode.
 *
 * @param {number} dx
 * @param {number} dy
 */
export function panCamera(dx, dy) {
    _targetX      = _clamp(_targetX + dx, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
    _targetY      = _clamp(_targetY + dy, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY);
    _targetNodeId = null;
}

/**
 * Smoothly centers the camera on a node. The lerp speed controls how fast
 * it arrives; `animateDurationMs` is informational only (the exponential lerp
 * doesn't have a fixed endpoint).
 *
 * @param {string} nodeId
 * @param {number} [animateDurationMs]
 */
export function centerOnNode(nodeId, animateDurationMs = 400) { // eslint-disable-line no-unused-vars
    const pos = getNodePosition(nodeId);
    if (!pos) {
        return;
    }
    _targetX      = pos.x;
    _targetY      = pos.y;
    _targetNodeId = nodeId;
}

/**
 * Sets a zoom target, clamped to [MIN_ZOOM, MAX_ZOOM].
 * @param {number} zoomLevel
 */
export function zoomToLevel(zoomLevel) {
    _targetZoom = _clamp(zoomLevel, MIN_ZOOM, MAX_ZOOM);
}

/**
 * Advances the interpolation for this frame. Called by the renderer rAF loop.
 * @param {number} deltaMs
 */
export function tick(deltaMs) {
    const t      = 1 - Math.exp(-LERP_SPEED * deltaMs / 1000);
    _x           = _lerp(_x,           _targetX,    t);
    _y           = _lerp(_y,           _targetY,    t);
    _currentZoom = _lerp(_currentZoom, _targetZoom, t);
}
