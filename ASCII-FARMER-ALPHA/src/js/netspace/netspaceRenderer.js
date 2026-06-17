// netspace/netspaceRenderer.js
// Canvas renderer for the Net-Space Zoom 2 world map.
// Draws the world graph as a Matrix-style glowing node tree on a dark canvas.
// No external libraries — Canvas 2D API only.

import { buildNetspacePulseSymbolPool } from '../configs/netspacePulseSymbols.js';
import { getActiveNodeState } from '../worldState.js';
import { getGraphState } from './worldGraph.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const BG_COLOR          = '#050a05';
const EDGE_COLOR        = '#1a4d1a';
const GLOW_COLOR_BASE   = 'rgba(0, 255, 65, ';
const NODE_FILL         = '#00cc33';
const NODE_FILL_SEL     = '#00ff41';
const LABEL_COLOR       = '#00cc33';
const LABEL_COLOR_SEL   = '#00ff41';
const LOCKED_STROKE     = '#0d3d0d';
const LOCKED_LABEL      = '#1a5c1a';

const NODE_RADIUS  = 18;
const GLOW_LAYERS  = 4;

const PULSE_CHAR_SIZE         = 15;
const PULSE_CHAR_STEP         = 11;
const PULSE_MIN_SPEED         = 70;
const PULSE_MAX_SPEED         = 430;
const PULSE_MIN_SEGMENTS      = 2;
const PULSE_MAX_SEGMENTS      = 10;
const PULSE_MAX_TURNS         = 3;
const PULSE_SWAP_MIN_MS       = 120;
const PULSE_SWAP_MAX_MS       = 520;
const PULSE_SPAWN_MIN_MS      = 120;
const PULSE_SPAWN_MAX_MS      = 560;
const PULSE_MAX_ACTIVE        = 18;
const PULSE_PATH_MARGIN       = 36;
const PULSE_TRACE_GRID        = 28;
const PULSE_Z_LEVELS          = 2;
const PULSE_POOL_REFRESH_MS   = 750;
const PULSE_TEXT_GLOW_BLUR    = 8;

// ── Module state ──────────────────────────────────────────────────────────────

/** @type {HTMLCanvasElement|null} */
let _canvas = null;

/** @type {CanvasRenderingContext2D|null} */
let _ctx = null;

/** @type {HTMLElement|null} */
let _overlay = null;

/** @type {number|null} */
let _rafId = null;

let _lastTimestamp  = 0;
let _lastCvWidth    = 0;
let _lastCvHeight   = 0;

/**
 * Default camera used when no camera controller is present (pre-Step 9).
 * Positions viewport so the trunk–farm edge is visible.
 * @type {{ x: number, y: number, currentZoom: number }}
 */
const _defaultCamera = { x: 0, y: -110, currentZoom: 1 };

/** @type {string|null} */
let _selectedNodeId = null;

/**
 * Camera controller set by cameraController.js after init.
 * Must expose { tick(deltaMs), getCameraState() }.
 * @type {{ tick: (d: number) => void, getCameraState: () => object }|null}
 */
let _cameraController = null;

/** Timestamp of the last camera tick — separate from render's _lastTimestamp. */
let _camTickLast = 0;

/**
 * Callback invoked when the player clicks a node on the canvas.
 * @type {((nodeId: string) => void)|null}
 */
let _nodeSelectCallback = null;

/**
 * Callback invoked when the player double-clicks a node on the canvas.
 * Intended for scene entry (e.g. worldMap → nodeOverview).
 * @type {((nodeId: string) => void)|null}
 */
let _nodeEnterCallback = null;

/**
 * @typedef {{ x: number, y: number }} PulsePoint
 * @typedef {{
 *   id: number,
 *   points: PulsePoint[],
 *   segmentLengths: number[],
 *   totalLength: number,
 *   distance: number,
 *   speed: number,
 *   segments: string[],
 *   text: string,
 *   charStep: number,
 *   swapTimer: number,
 *   swapInterval: number,
 *   zLevel: number,
 * }} NetspacePulse
 */

/** @type {NetspacePulse[]} */
let _netspacePulses = [];

/** @type {Array<{ key: string, label: string, symbol: string, address: string, source: string, segment: string }>} */
let _pulseSymbolPool = [];

let _pulseSpawnTimer = 0;
let _pulseSpawnInterval = 0;
let _pulsePoolRefreshTimer = 0;
let _pulseIdCounter = 0;

// ── Pulse helpers ─────────────────────────────────────────────────────────────

function _randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function _randomInteger(min, max) {
    return Math.floor(_randomBetween(min, max + 1));
}

function _snapToTraceGrid(value) {
    return Math.round(value / PULSE_TRACE_GRID) * PULSE_TRACE_GRID;
}

function _buildPulseText(segments) {
    return segments.join('');
}

function _buildWeightedSegmentCount() {
    const rolls = [
        _randomInteger(3, 7),
        _randomInteger(PULSE_MIN_SEGMENTS, PULSE_MAX_SEGMENTS),
        _randomInteger(3, 7),
    ];
    rolls.sort((left, right) => left - right);
    return Math.max(PULSE_MIN_SEGMENTS, Math.min(PULSE_MAX_SEGMENTS, rolls[1]));
}

function _refreshPulseSymbolPool() {
    _pulseSymbolPool = buildNetspacePulseSymbolPool(getActiveNodeState());

    if (_pulseSymbolPool.length === 0) {
        _pulseSymbolPool = [{
            key: 'fallback:question',
            label: 'Fallback',
            symbol: '?',
            address: 'U+003F',
            source: 'fallback',
            segment: '(?)U+003F',
        }];
    }
}

function _pickPulseSegment() {
    if (_pulseSymbolPool.length === 0) {
        _refreshPulseSymbolPool();
    }

    return _pulseSymbolPool[Math.floor(Math.random() * _pulseSymbolPool.length)].segment;
}

function _buildPulseSegments(segmentCount = _buildWeightedSegmentCount()) {
    return Array.from({ length: segmentCount }, () => _pickPulseSegment());
}

function _randomEdgePoint(width, height, edge) {
    const minX = PULSE_PATH_MARGIN;
    const maxX = Math.max(PULSE_PATH_MARGIN, width - PULSE_PATH_MARGIN);
    const minY = PULSE_PATH_MARGIN;
    const maxY = Math.max(PULSE_PATH_MARGIN, height - PULSE_PATH_MARGIN);

    switch (edge) {
        case 'top':
            return { x: _snapToTraceGrid(_randomBetween(minX, maxX)), y: 0 };
        case 'right':
            return { x: width, y: _snapToTraceGrid(_randomBetween(minY, maxY)) };
        case 'bottom':
            return { x: _snapToTraceGrid(_randomBetween(minX, maxX)), y: height };
        case 'left':
        default:
            return { x: 0, y: _snapToTraceGrid(_randomBetween(minY, maxY)) };
    }
}

function _edgeToDirection(edge) {
    switch (edge) {
        case 'top':
            return 'down';
        case 'right':
            return 'left';
        case 'bottom':
            return 'up';
        case 'left':
        default:
            return 'right';
    }
}

function _directionVector(direction) {
    switch (direction) {
        case 'up':
            return { dx: 0, dy: -1 };
        case 'down':
            return { dx: 0, dy: 1 };
        case 'left':
            return { dx: -1, dy: 0 };
        case 'right':
        default:
            return { dx: 1, dy: 0 };
    }
}

function _isHorizontal(direction) {
    return direction === 'left' || direction === 'right';
}

function _turnDirections(direction) {
    return _isHorizontal(direction) ? ['up', 'down'] : ['left', 'right'];
}

function _directionTowardEntryEdge(entryEdge) {
    return _edgeToDirection(entryEdge);
}

function _isPointInsideCanvas(point, width, height) {
    return point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height;
}

function _advancePoint(point, direction, distance) {
    const { dx, dy } = _directionVector(direction);
    return {
        x: point.x + dx * distance,
        y: point.y + dy * distance,
    };
}

function _exitPointForDirection(point, direction, width, height) {
    switch (direction) {
        case 'up':
            return { x: point.x, y: 0 };
        case 'down':
            return { x: point.x, y: height };
        case 'left':
            return { x: 0, y: point.y };
        case 'right':
        default:
            return { x: width, y: point.y };
    }
}

function _distanceBetweenPoints(pointA, pointB) {
    return Math.abs(pointA.x - pointB.x) + Math.abs(pointA.y - pointB.y);
}

function _buildPulsePath(width, height) {
    const entryEdges = ['top', 'right', 'bottom', 'left'];

    for (let attempt = 0; attempt < 40; attempt += 1) {
        const entryEdge = entryEdges[_randomInteger(0, entryEdges.length - 1)];
        const start = _randomEdgePoint(width, height, entryEdge);
        const points = [start];
        let direction = _edgeToDirection(entryEdge);
        const turnCount = _randomInteger(0, PULSE_MAX_TURNS);
        let current = start;

        for (let turnIndex = 0; turnIndex < turnCount; turnIndex += 1) {
            const minLeg = PULSE_TRACE_GRID * 2;
            const maxLeg = _isHorizontal(direction)
                ? Math.max(minLeg, width * 0.32)
                : Math.max(minLeg, height * 0.32);
            const candidate = _advancePoint(current, direction, _snapToTraceGrid(_randomBetween(minLeg, maxLeg)));

            if (!_isPointInsideCanvas(candidate, width, height)) {
                break;
            }

            points.push(candidate);
            current = candidate;

            const nextChoices = _turnDirections(direction).filter((candidateDirection) => candidateDirection !== _directionTowardEntryEdge(entryEdge));
            direction = nextChoices[_randomInteger(0, nextChoices.length - 1)];
        }

        if (direction === _directionTowardEntryEdge(entryEdge)) {
            continue;
        }

        const exit = _exitPointForDirection(current, direction, width, height);
        if (_distanceBetweenPoints(current, exit) < PULSE_TRACE_GRID * 2) {
            continue;
        }

        points.push(exit);

        const segmentLengths = [];
        let totalLength = 0;
        for (let index = 1; index < points.length; index += 1) {
            const length = _distanceBetweenPoints(points[index - 1], points[index]);
            if (length <= 0) {
                totalLength = 0;
                break;
            }
            segmentLengths.push(length);
            totalLength += length;
        }

        if (totalLength > PULSE_TRACE_GRID * 6) {
            return { points, segmentLengths, totalLength };
        }
    }

    return {
        points: [{ x: 0, y: PULSE_TRACE_GRID }, { x: width, y: PULSE_TRACE_GRID }],
        segmentLengths: [width],
        totalLength: width,
    };
}

function _spawnPulse(width, height) {
    const path = _buildPulsePath(width, height);
    const segments = _buildPulseSegments();
    const text = _buildPulseText(segments);
    const speed = _randomBetween(PULSE_MIN_SPEED, PULSE_MAX_SPEED);
    const charStep = Math.max(9, PULSE_CHAR_STEP + _randomInteger(-1, 2));

    _netspacePulses.push({
        id: ++_pulseIdCounter,
        points: path.points,
        segmentLengths: path.segmentLengths,
        totalLength: path.totalLength,
        distance: 0,
        speed,
        segments,
        text,
        charStep,
        swapTimer: 0,
        swapInterval: _randomBetween(PULSE_SWAP_MIN_MS, PULSE_SWAP_MAX_MS),
        zLevel: _randomInteger(0, PULSE_Z_LEVELS - 1),
    });
}

function _resetPulseSystem(width, height) {
    _netspacePulses = [];
    _pulseSpawnTimer = 0;
    _pulseSpawnInterval = _randomBetween(PULSE_SPAWN_MIN_MS, PULSE_SPAWN_MAX_MS);
    _pulsePoolRefreshTimer = 0;
    _refreshPulseSymbolPool();

    const initialPulses = Math.max(4, Math.min(8, Math.floor(width / 240)));
    for (let index = 0; index < initialPulses; index += 1) {
        _spawnPulse(width, height);
        _netspacePulses[_netspacePulses.length - 1].distance = _randomBetween(0, _netspacePulses[_netspacePulses.length - 1].totalLength);
    }
}

function _getPulsePointAtDistance(pulse, distance) {
    let remaining = distance;

    for (let index = 1; index < pulse.points.length; index += 1) {
        const start = pulse.points[index - 1];
        const end = pulse.points[index];
        const segmentLength = pulse.segmentLengths[index - 1];
        if (remaining <= segmentLength) {
            const t = segmentLength === 0 ? 0 : remaining / segmentLength;
            return {
                x: start.x + (end.x - start.x) * t,
                y: start.y + (end.y - start.y) * t,
            };
        }

        remaining -= segmentLength;
    }

    return pulse.points[pulse.points.length - 1];
}

function _mutatePulseSegment(pulse) {
    if (!Array.isArray(pulse.segments) || pulse.segments.length === 0) {
        return;
    }

    const segmentIndex = _randomInteger(0, pulse.segments.length - 1);
    pulse.segments[segmentIndex] = _pickPulseSegment();
    pulse.text = _buildPulseText(pulse.segments);
}

// ── Coordinate helper ─────────────────────────────────────────────────────────

/**
 * Converts a world-space position to canvas screen coordinates.
 * World y=-220 maps above world y=0 (tree grows upward on screen).
 *
 * @param {number} worldX
 * @param {number} worldY
 * @param {number} camX
 * @param {number} camY
 * @param {number} zoom
 * @returns {{ sx: number, sy: number }}
 */
function _toScreen(worldX, worldY, camX, camY, zoom) {
    return {
        sx: _canvas.width  / 2 + (worldX - camX) * zoom,
        sy: _canvas.height / 2 + (worldY - camY) * zoom,
    };
}

// ── Draw passes ───────────────────────────────────────────────────────────────

function _drawBackground() {
    _ctx.fillStyle = BG_COLOR;
    _ctx.fillRect(0, 0, _canvas.width, _canvas.height);
}

/** @param {number} deltaMs */
function _drawPulseTraffic(deltaMs) {
    _pulsePoolRefreshTimer += deltaMs;
    if (_pulsePoolRefreshTimer >= PULSE_POOL_REFRESH_MS) {
        _pulsePoolRefreshTimer = 0;
        _refreshPulseSymbolPool();
    }

    _pulseSpawnTimer += deltaMs;
    while (_pulseSpawnTimer >= _pulseSpawnInterval && _netspacePulses.length < PULSE_MAX_ACTIVE) {
        _pulseSpawnTimer -= _pulseSpawnInterval;
        _pulseSpawnInterval = _randomBetween(PULSE_SPAWN_MIN_MS, PULSE_SPAWN_MAX_MS);
        _spawnPulse(_canvas.width, _canvas.height);
    }

    _netspacePulses = _netspacePulses.filter((pulse) => {
        pulse.distance += pulse.speed * (deltaMs / 1000);
        pulse.swapTimer += deltaMs;

        if (pulse.swapTimer >= pulse.swapInterval) {
            pulse.swapTimer = 0;
            pulse.swapInterval = _randomBetween(PULSE_SWAP_MIN_MS, PULSE_SWAP_MAX_MS);
            _mutatePulseSegment(pulse);
        }

        return pulse.distance - pulse.text.length * pulse.charStep <= pulse.totalLength;
    });

    _ctx.save();
    _ctx.font = `${PULSE_CHAR_SIZE}px monospace`;
    _ctx.textAlign = 'center';
    _ctx.textBaseline = 'middle';
    _ctx.shadowBlur = PULSE_TEXT_GLOW_BLUR;
    _ctx.shadowColor = 'rgba(0, 255, 65, 0.35)';

    for (let zLevel = 0; zLevel < PULSE_Z_LEVELS; zLevel += 1) {
        const zAlphaBoost = zLevel === 0 ? 0 : 0.08;
        for (const pulse of _netspacePulses) {
            if (pulse.zLevel !== zLevel) {
                continue;
            }

            for (let index = 0; index < pulse.text.length; index += 1) {
                const distance = pulse.distance - index * pulse.charStep;
                if (distance < 0 || distance > pulse.totalLength) {
                    continue;
                }

                const point = _getPulsePointAtDistance(pulse, distance);
                const t = pulse.text.length <= 1 ? 0 : index / (pulse.text.length - 1);

                if (index < 3) {
                    _ctx.fillStyle = `rgba(210, 255, 230, ${(0.96 - t * 0.12 + zAlphaBoost).toFixed(2)})`;
                } else if (index < 10) {
                    _ctx.fillStyle = `rgba(0, 255, 82, ${(0.86 - t * 0.28 + zAlphaBoost).toFixed(2)})`;
                } else {
                    _ctx.fillStyle = `rgba(0, 170, 54, ${(Math.max(0.12, (1 - t) * 0.58) + zAlphaBoost).toFixed(2)})`;
                }

                _ctx.fillText(pulse.text[index], point.x, point.y);
            }
        }
    }

    _ctx.restore();
}

/**
 * @param {object} graphState
 * @param {number} camX
 * @param {number} camY
 * @param {number} zoom
 */
function _drawEdges(graphState, camX, camY, zoom) {
    _ctx.save();
    _ctx.strokeStyle = EDGE_COLOR;
    _ctx.lineWidth = 2.5;

    for (const edge of graphState.edges) {
        const from = graphState.nodes[edge.from];
        const to   = graphState.nodes[edge.to];
        if (!from || !to) {
            continue;
        }
        const { sx: x1, sy: y1 } = _toScreen(from.position.x, from.position.y, camX, camY, zoom);
        const { sx: x2, sy: y2 } = _toScreen(to.position.x,   to.position.y,   camX, camY, zoom);
        const midY = (y1 + y2) / 2;

        _ctx.beginPath();
        _ctx.moveTo(x1, y1);
        _ctx.bezierCurveTo(x1, midY, x2, midY, x2, y2);
        _ctx.stroke();
    }
    _ctx.restore();
}

/**
 * @param {object} graphState
 * @param {number} camX
 * @param {number} camY
 * @param {number} zoom
 */
function _drawLockedSlots(graphState, camX, camY, zoom) {
    _ctx.save();
    _ctx.setLineDash([4, 5]);

    for (const slot of graphState.lockedSlots) {
        if (!slot.visible) {
            continue;
        }
        const { sx, sy } = _toScreen(slot.position.x, slot.position.y, camX, camY, zoom);
        _ctx.strokeStyle = LOCKED_STROKE;
        _ctx.lineWidth = 2;
        _ctx.beginPath();
        _ctx.arc(sx, sy, NODE_RADIUS * zoom, 0, Math.PI * 2);
        _ctx.stroke();
        _ctx.setLineDash([]);
        _ctx.fillStyle = LOCKED_LABEL;
        _ctx.font = `${Math.round(14 * zoom)}px monospace`;
        _ctx.textAlign = 'center';
        _ctx.textBaseline = 'middle';
        _ctx.fillText('?', sx, sy);
    }
    _ctx.restore();
}

/**
 * @param {object} graphState
 * @param {number} camX
 * @param {number} camY
 * @param {number} zoom
 * @param {string|null} selectedNodeId
 */
function _drawNodes(graphState, camX, camY, zoom, selectedNodeId) {
    _ctx.save();

    for (const [nodeId, node] of Object.entries(graphState.nodes)) {
        const isSelected  = nodeId === selectedNodeId;
        const { sx, sy }  = _toScreen(node.position.x, node.position.y, camX, camY, zoom);
        const fillColor   = isSelected ? NODE_FILL_SEL : NODE_FILL;
        const glowAlpha   = isSelected ? 0.28 : 0.16;

        // Glow rings (outer → inner)
        for (let g = GLOW_LAYERS; g >= 1; g--) {
            const r = NODE_RADIUS * zoom + g * 8 * zoom;
            const a = (glowAlpha * g / GLOW_LAYERS).toFixed(3);
            _ctx.beginPath();
            _ctx.arc(sx, sy, r, 0, Math.PI * 2);
            _ctx.fillStyle = `${GLOW_COLOR_BASE}${a})`;
            _ctx.fill();
        }

        // Core circle
        _ctx.beginPath();
        _ctx.arc(sx, sy, NODE_RADIUS * zoom, 0, Math.PI * 2);
        _ctx.fillStyle = fillColor;
        _ctx.fill();

        // Node glyph
        const glyph = node.type === 'farm' ? '▦' : '◉';
        _ctx.fillStyle    = BG_COLOR;
        _ctx.font         = `bold ${Math.max(10, Math.round(14 * zoom))}px monospace`;
        _ctx.textAlign    = 'center';
        _ctx.textBaseline = 'middle';
        _ctx.fillText(glyph, sx, sy);

        // Label below node
        _ctx.fillStyle    = isSelected ? LABEL_COLOR_SEL : LABEL_COLOR;
        _ctx.font         = `${Math.max(9, Math.round(11 * zoom))}px monospace`;
        _ctx.textAlign    = 'center';
        _ctx.textBaseline = 'top';
        _ctx.fillText(node.label, sx, sy + (NODE_RADIUS + 5) * zoom);
    }
    _ctx.restore();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sets up the 2D canvas context and starts the animation render loop.
 * Creates a `#netspace-overlay` DOM element as a sibling to the canvas for
 * future net-space UI panels.
 *
 * @param {HTMLCanvasElement} canvasEl
 * @returns {HTMLElement} The overlay div element
 */
export function initializeNetspaceCanvas(canvasEl) {
    _canvas         = canvasEl;
    _ctx            = canvasEl.getContext('2d');
    _lastCvWidth    = canvasEl.width;
    _lastCvHeight   = canvasEl.height;
    _lastTimestamp  = performance.now();
    _resetPulseSystem(canvasEl.width, canvasEl.height);

    // Create overlay div for future net-space UI panels
    const existing = document.getElementById('netspace-overlay');
    if (existing) {
        _overlay = existing;
    } else {
        _overlay = document.createElement('div');
        _overlay.id = 'netspace-overlay';
        _overlay.className = 'netspace-overlay';
        _overlay.setAttribute('aria-hidden', 'true');
        canvasEl.insertAdjacentElement('afterend', _overlay);
    }

    // Remove any previous listeners before attaching new ones.
    if (_canvas && _canvas !== canvasEl) {
        _canvas.removeEventListener('click', _onCanvasClick);
        _canvas.removeEventListener('dblclick', _onCanvasDoubleClick);
    }
    canvasEl.addEventListener('click', _onCanvasClick);
    canvasEl.addEventListener('dblclick', _onCanvasDoubleClick);

    // Start render loop (cancel any existing loop first)
    if (_rafId !== null) {
        cancelAnimationFrame(_rafId);
        _rafId = null;
    }
    function _loop() {
        _rafId = requestAnimationFrame(_loop);
        if (_cameraController) {
            const now   = performance.now();
            const delta = Math.min(now - _camTickLast, 50);
            _camTickLast = now;
            _cameraController.tick(delta);
            render(null, _cameraController.getCameraState(), null);
        } else {
            render(null, null, null);
        }
    }
    _rafId = requestAnimationFrame(_loop);

    return _overlay;
}

/**
 * Draws a single frame. Called by the internal rAF loop each tick.
 * May also be called externally for forced redraws (e.g., by the camera
 * controller in Step 9).
 *
 * When an argument is `null`, the live module-level value is used instead:
 * - `graphState` → reads from `getGraphState()`
 * - `cameraState` → uses `_defaultCamera` (until Step 9 wires its own)
 * - `selectedNodeId` → `null` (no selection)
 *
 * @param {object|null} graphState
 * @param {{ x: number, y: number, currentZoom: number }|null} cameraState
 * @param {string|null} selectedNodeId
 */
export function render(graphState, cameraState, selectedNodeId) {
    if (!_ctx || !_canvas) {
        return;
    }

    // Rebuild pulse routing if canvas was resized
    if (_canvas.width !== _lastCvWidth || _canvas.height !== _lastCvHeight) {
        _lastCvWidth  = _canvas.width;
        _lastCvHeight = _canvas.height;
        _resetPulseSystem(_canvas.width, _canvas.height);
    }

    const now     = performance.now();
    const deltaMs = Math.min(now - _lastTimestamp, 50);
    _lastTimestamp = now;

    const graph    = graphState    ?? getGraphState();
    const cam      = cameraState   ?? _defaultCamera;
    const selected = selectedNodeId ?? _selectedNodeId;
    const { x: camX, y: camY, currentZoom: zoom } = cam;

    _drawBackground();
    _drawPulseTraffic(deltaMs);
    _drawEdges(graph, camX, camY, zoom);
    _drawLockedSlots(graph, camX, camY, zoom);
    _drawNodes(graph, camX, camY, zoom, selected);
}

/**
 * Cancels the animation frame loop. Call when unmounting the worldMap scene.
 */
export function stopRenderer() {
    if (_rafId !== null) {
        cancelAnimationFrame(_rafId);
        _rafId = null;
    }
}

/**
 * Restarts the animation frame loop without reinitialising the canvas or
 * resetting pulse/camera state. Safe to call after stopRenderer().
 * No-ops if the canvas was never initialised or the loop is already running.
 */
export function startRenderer() {
    if (!_canvas || !_ctx || _rafId !== null) return;
    _lastTimestamp = performance.now();
    _camTickLast   = performance.now();
    function _loop() {
        _rafId = requestAnimationFrame(_loop);
        if (_cameraController) {
            const now   = performance.now();
            const delta = Math.min(now - _camTickLast, 50);
            _camTickLast = now;
            _cameraController.tick(delta);
            render(null, _cameraController.getCameraState(), null);
        } else {
            render(null, null, null);
        }
    }
    _rafId = requestAnimationFrame(_loop);
}

/**
 * Registers a camera controller whose tick() and getCameraState() will be
 * called each frame by the render loop.
 *
 * @param {{ tick: (d: number) => void, getCameraState: () => object }|null} cc
 */
export function setCameraController(cc) {
    _cameraController = cc;
    _camTickLast      = performance.now();
}

/**
 * Registers a callback invoked when the player clicks on a node.
 * The callback receives the nodeId string.
 *
 * @param {((nodeId: string) => void)|null} fn
 */
export function setNodeSelectCallback(fn) {
    _nodeSelectCallback = fn;
}

/**
 * Registers a callback invoked when the player double-clicks on a node.
 * Intended for scene entry (worldMap → nodeOverview).
 *
 * @param {((nodeId: string) => void)|null} fn
 */
export function setNodeEnterCallback(fn) {
    _nodeEnterCallback = fn;
}

/**
 * Returns the currently selected world-map node id, if any.
 * @returns {string|null}
 */
export function getSelectedNodeId() {
    return _selectedNodeId;
}

// ── Canvas hit-test ───────────────────────────────────────────────────────────

/**
 * Click handler attached to the canvas. Performs a radius hit-test against
 * all active graph nodes and fires _nodeSelectCallback if one is hit.
 *
 * @param {MouseEvent} event
 */
function _onCanvasClick(event) {
    if (!_nodeSelectCallback || !_ctx || !_canvas) {
        return;
    }
    const rect = _canvas.getBoundingClientRect();
    const cx   = event.clientX - rect.left;
    const cy   = event.clientY - rect.top;
    const cam  = _cameraController ? _cameraController.getCameraState() : _defaultCamera;
    const { x: camX, y: camY, currentZoom: zoom } = cam;

    const graph     = getGraphState();
    const hitRadius = NODE_RADIUS * zoom + 8; // slightly generous

    for (const [nodeId, node] of Object.entries(graph.nodes)) {
        const { sx, sy } = _toScreen(node.position.x, node.position.y, camX, camY, zoom);
        const dist2 = (cx - sx) ** 2 + (cy - sy) ** 2;
        if (dist2 <= hitRadius * hitRadius) {
            _selectedNodeId = nodeId;
            _nodeSelectCallback(nodeId);
            return;
        }
    }
}

/**
 * Double-click handler. Performs the same radius hit-test and fires
 * _nodeEnterCallback if a node is hit. Single-click centering still fires
 * first (browser fires click before dblclick), so the camera will already
 * be centering on the node when the transition begins.
 *
 * @param {MouseEvent} event
 */
function _onCanvasDoubleClick(event) {
    if (!_nodeEnterCallback || !_ctx || !_canvas) {
        return;
    }
    const rect = _canvas.getBoundingClientRect();
    const cx   = event.clientX - rect.left;
    const cy   = event.clientY - rect.top;
    const cam  = _cameraController ? _cameraController.getCameraState() : _defaultCamera;
    const { x: camX, y: camY, currentZoom: zoom } = cam;

    const graph     = getGraphState();
    const hitRadius = NODE_RADIUS * zoom + 8;

    for (const [nodeId, node] of Object.entries(graph.nodes)) {
        if (node.type !== 'farm') continue; // only farm nodes are enterable
        const { sx, sy } = _toScreen(node.position.x, node.position.y, camX, camY, zoom);
        const dist2 = (cx - sx) ** 2 + (cy - sy) ** 2;
        if (dist2 <= hitRadius * hitRadius) {
            _nodeEnterCallback(nodeId);
            return;
        }
    }
}
