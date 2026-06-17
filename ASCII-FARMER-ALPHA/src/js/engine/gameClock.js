// engine/gameClock.js
// Central scheduler skeleton for Alpha 2.2 remediation.
// Phase 1 Step 1 goal: establish a single deterministic clock owner without
// changing existing gameplay behavior yet.

const DEFAULT_FIXED_STEP_MS = 100;
const MAX_FRAME_DELTA_MS = 1000;
const MAX_SIM_STEPS_PER_FRAME = 20;
const DEFAULT_CATCH_UP_CHUNK_MS = 250;

let _running = false;
let _rafId = 0;
let _lastFrameAt = 0;
let _accumulatorMs = 0;
let _fixedStepMs = DEFAULT_FIXED_STEP_MS;

let _simulationTickCount = 0;
let _frameCount = 0;
let _droppedSimulationSteps = 0;
let _lastFrameDeltaMs = 0;

/** @type {Set<(stepMs: number, nowMs: number) => void>} */
const _simulationListeners = new Set();

/** @type {Set<(renderInfo: { nowMs: number, frameDeltaMs: number, alpha: number }) => void>} */
const _renderListeners = new Set();

function clampPositiveNumber(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
        return fallback;
    }
    return n;
}

function emitSimulationStep(stepMs, nowMs) {
    _simulationListeners.forEach((listener) => {
        try {
            listener(stepMs, nowMs);
        } catch (error) {
            console.error('[gameClock] Simulation listener failed.', error);
        }
    });
}

function emitRenderFrame(nowMs, frameDeltaMs) {
    const alpha = Math.max(0, Math.min(1, _accumulatorMs / _fixedStepMs));
    _renderListeners.forEach((listener) => {
        try {
            listener({ nowMs, frameDeltaMs, alpha });
        } catch (error) {
            console.error('[gameClock] Render listener failed.', error);
        }
    });
}

function advanceSimulationByElapsed(elapsedMs, nowMs) {
    const normalizedElapsedMs = Math.max(0, Number(elapsedMs) || 0);
    if (normalizedElapsedMs <= 0) {
        return 0;
    }

    let executedSteps = 0;
    _accumulatorMs += normalizedElapsedMs;

    while (_accumulatorMs >= _fixedStepMs) {
        emitSimulationStep(_fixedStepMs, nowMs);
        _accumulatorMs -= _fixedStepMs;
        _simulationTickCount += 1;
        executedSteps += 1;
    }

    return executedSteps;
}

function clockFrame(nowMs) {
    if (!_running) {
        return;
    }

    const previousNow = _lastFrameAt || nowMs;
    const rawDeltaMs = Math.max(0, nowMs - previousNow);
    const frameDeltaMs = Math.min(rawDeltaMs, MAX_FRAME_DELTA_MS);

    _lastFrameAt = nowMs;
    _lastFrameDeltaMs = frameDeltaMs;
    _frameCount += 1;
    _accumulatorMs += frameDeltaMs;

    let simStepsThisFrame = 0;
    while (_accumulatorMs >= _fixedStepMs && simStepsThisFrame < MAX_SIM_STEPS_PER_FRAME) {
        emitSimulationStep(_fixedStepMs, nowMs);
        _accumulatorMs -= _fixedStepMs;
        _simulationTickCount += 1;
        simStepsThisFrame += 1;
    }

    if (_accumulatorMs >= _fixedStepMs) {
        const overdueSteps = Math.floor(_accumulatorMs / _fixedStepMs);
        _droppedSimulationSteps += overdueSteps;
        _accumulatorMs -= overdueSteps * _fixedStepMs;
    }

    emitRenderFrame(nowMs, frameDeltaMs);
    _rafId = window.requestAnimationFrame(clockFrame);
}

export function configureGameClock(options = {}) {
    _fixedStepMs = clampPositiveNumber(options.fixedStepMs, _fixedStepMs);
}

export function startGameClock(options = {}) {
    configureGameClock(options);

    if (_running) {
        return;
    }

    _running = true;
    _accumulatorMs = 0;
    _lastFrameAt = performance.now();
    _rafId = window.requestAnimationFrame(clockFrame);
}

export function stopGameClock() {
    if (!_running) {
        return;
    }

    _running = false;
    if (_rafId) {
        window.cancelAnimationFrame(_rafId);
        _rafId = 0;
    }
}

export async function runCatchUp(totalMs, options = {}) {
    if (_running) {
        console.warn('[gameClock] runCatchUp called while clock is running; skipping catch-up pass.');
        return {
            requestedMs: Math.max(0, Number(totalMs) || 0),
            simulatedMs: 0,
            executedSteps: 0,
            leftoverAccumulatorMs: _accumulatorMs,
            skipped: true,
        };
    }

    const requestedMs = Math.max(0, Number(totalMs) || 0);
    const chunkMs = clampPositiveNumber(options.chunkMs, DEFAULT_CATCH_UP_CHUNK_MS);
    const shouldYieldBetweenChunks = options.yieldBetweenChunks !== false;

    if (requestedMs <= 0) {
        return {
            requestedMs,
            simulatedMs: 0,
            executedSteps: 0,
            leftoverAccumulatorMs: _accumulatorMs,
            skipped: false,
        };
    }

    let remainingMs = requestedMs;
    let simulatedMs = 0;
    let executedSteps = 0;

    while (remainingMs > 0) {
        const nextChunkMs = Math.min(chunkMs, remainingMs);
        const nowMs = performance.now();
        executedSteps += advanceSimulationByElapsed(nextChunkMs, nowMs);
        simulatedMs += nextChunkMs;
        remainingMs -= nextChunkMs;

        if (shouldYieldBetweenChunks && remainingMs > 0) {
            await new Promise((resolve) => {
                window.setTimeout(resolve, 0);
            });
        }
    }

    return {
        requestedMs,
        simulatedMs,
        executedSteps,
        leftoverAccumulatorMs: _accumulatorMs,
        skipped: false,
    };
}

export function registerSimulationStepListener(listener) {
    if (typeof listener !== 'function') {
        return () => {};
    }

    _simulationListeners.add(listener);
    return () => {
        _simulationListeners.delete(listener);
    };
}

export function registerRenderListener(listener) {
    if (typeof listener !== 'function') {
        return () => {};
    }

    _renderListeners.add(listener);
    return () => {
        _renderListeners.delete(listener);
    };
}

export function getGameClockStats() {
    return {
        running: _running,
        fixedStepMs: _fixedStepMs,
        simulationTickCount: _simulationTickCount,
        frameCount: _frameCount,
        droppedSimulationSteps: _droppedSimulationSteps,
        lastFrameDeltaMs: _lastFrameDeltaMs,
        listenerCounts: {
            simulation: _simulationListeners.size,
            render: _renderListeners.size,
        },
    };
}

export function resetGameClockStats() {
    _simulationTickCount = 0;
    _frameCount = 0;
    _droppedSimulationSteps = 0;
    _lastFrameDeltaMs = 0;
}
