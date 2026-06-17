// ui/clicks.js
import { getActiveNodeState, getPlayTimeMs, flushPlayTime, flushPendingStatePersist } from '../worldState.js';
import { registerRenderListener, registerSimulationStepListener } from '../engine/gameClock.js';

function shouldSkipUnloadSave() {
    return typeof window !== 'undefined' && window.__asciiFarmerSkipUnloadSave === true;
}

let lastRenderedGameStartedAt = null;
let sampledPlayTimeMs = 0;
let sampledPerfNow = 0;
let hasPlayTimeSample = false;
let lastRenderedPlayTime = '';

let clicksSimulationUnsubscribe = null;
let clicksRenderUnsubscribe = null;
let cpmAccumulatorMs = 0;
let playtimeSampleAccumulatorMs = 0;

const CPM_UPDATE_INTERVAL_MS = 1000;
const PLAYTIME_SAMPLE_INTERVAL_MS = 250;

function formatPlayTime(ms) {
    const totalCs = Math.floor(ms / 10);
    const centiseconds = totalCs % 100;
    const totalSeconds = Math.floor(totalCs / 100);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);

    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    const cs = String(centiseconds).padStart(2, '0');

    return `${hh}:${mm}:${ss}.${cs}`;
}

function formatGameStartedAt(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString();
}

function calculateClicksPerMinute(totalClicksClicked, gameStartedAt) {
    const elapsedMilliseconds = Date.now() - gameStartedAt;
    const elapsedMinutes = elapsedMilliseconds / 60000;

    if (!Number.isFinite(elapsedMinutes) || elapsedMinutes <= 0) {
        return 0;
    }

    return totalClicksClicked / elapsedMinutes;
}

function createStatsRow(labelText, valueId) {
    const row = document.createElement('div');
    row.classList.add('stats-row');

    const label = document.createElement('span');
    label.classList.add('clicks-display-label');
    label.textContent = labelText;

    const value = document.createElement('span');
    value.id = valueId;

    row.appendChild(label);
    row.appendChild(value);

    return row;
}

function initializeClicksDisplay() {
    const mountTarget = document.getElementById('stats-content-inner') || document.body;

    const container = document.createElement('div');
    container.id = 'clicks-display';
    container.classList.add('clicks-display');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-label', 'Game statistics');

    const gameStartedRow = createStatsRow('Game Started', 'game-started-display-value');
    const playTimeRow = createStatsRow('Play Time', 'play-time-display-value');
    const clicksRow = createStatsRow('Clicks', 'clicks-display-count');
    const clicksPerMinuteRow = createStatsRow('Clicks / Min', 'clicks-per-minute-display-count');

    container.appendChild(gameStartedRow);
    container.appendChild(playTimeRow);
    container.appendChild(clicksRow);
    container.appendChild(clicksPerMinuteRow);
    mountTarget.appendChild(container);

    updateGameStartedDisplay();
    updateClicksDisplay();

    if (!clicksSimulationUnsubscribe) {
        clicksSimulationUnsubscribe = registerSimulationStepListener((stepMs) => {
            const dt = Math.max(0, Number(stepMs) || 0);

            cpmAccumulatorMs += dt;
            while (cpmAccumulatorMs >= CPM_UPDATE_INTERVAL_MS) {
                cpmAccumulatorMs -= CPM_UPDATE_INTERVAL_MS;
                updateClicksPerMinuteDisplay();
            }

            playtimeSampleAccumulatorMs += dt;
            while (playtimeSampleAccumulatorMs >= PLAYTIME_SAMPLE_INTERVAL_MS) {
                playtimeSampleAccumulatorMs -= PLAYTIME_SAMPLE_INTERVAL_MS;
                samplePlayTimeAnchor();
            }
        });
    }

    cpmAccumulatorMs = 0;
    playtimeSampleAccumulatorMs = 0;

    samplePlayTimeAnchor();
    updatePlayTimeDisplay();

    if (!clicksRenderUnsubscribe) {
        clicksRenderUnsubscribe = registerRenderListener(() => {
            updatePlayTimeDisplay();
        });
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            if (shouldSkipUnloadSave()) {
                return;
            }
            flushPlayTime();
            flushPendingStatePersist();
            hasPlayTimeSample = false;
            return;
        }

        samplePlayTimeAnchor();
        updatePlayTimeDisplay();
    });

    window.addEventListener('beforeunload', () => {
        if (shouldSkipUnloadSave()) {
            return;
        }
        flushPlayTime();
        flushPendingStatePersist();
    });
}

function updateGameStartedDisplay() {
    const gameStartedAt = Number(getActiveNodeState().gameStartedAt) || Date.now();
    if (gameStartedAt === lastRenderedGameStartedAt) {
        return;
    }

    const gameStartedEl = document.getElementById('game-started-display-value');
    if (gameStartedEl) {
        gameStartedEl.textContent = formatGameStartedAt(gameStartedAt);
        lastRenderedGameStartedAt = gameStartedAt;
    }
}

function updateClicksPerMinuteDisplay() {
    const gameStartedAt = Number(getActiveNodeState().gameStartedAt) || Date.now();
    const clicksPerMinuteEl = document.getElementById('clicks-per-minute-display-count');

    if (clicksPerMinuteEl) {
        const clicksPerMinute = calculateClicksPerMinute(getActiveNodeState().totalClicksClicked, gameStartedAt);
        clicksPerMinuteEl.textContent = clicksPerMinute.toFixed(1);
    }
}

function updateClicksDisplay() {
    const countEl = document.getElementById('clicks-display-count');

    if (countEl) {
        countEl.textContent = String(getActiveNodeState().totalClicksClicked);
    }

    updateGameStartedDisplay();
    updateClicksPerMinuteDisplay();
}

function samplePlayTimeAnchor() {
    sampledPlayTimeMs = getPlayTimeMs();
    sampledPerfNow = performance.now();
    hasPlayTimeSample = true;
}

function getVisualPlayTimeMs() {
    if (!hasPlayTimeSample) {
        samplePlayTimeAnchor();
    }

    const elapsed = Math.max(0, performance.now() - sampledPerfNow);
    return sampledPlayTimeMs + elapsed;
}

function updatePlayTimeDisplay() {
    const el = document.getElementById('play-time-display-value');
    if (el) {
        const nextValue = formatPlayTime(getVisualPlayTimeMs());
        if (nextValue !== lastRenderedPlayTime) {
            el.textContent = nextValue;
            lastRenderedPlayTime = nextValue;
        }
    }
}

export { initializeClicksDisplay, updateClicksDisplay };
