// netspace/nodeOverviewUI.js
// Zoom 1 — Node Overview panel.
// Shows live stats (coins, water, seeds, crops, quests) on the left and a
// read-only ASCII field snapshot on the right, with "Enter Node" and "World Map"
// navigation buttons in the bottom bar.

import { getNodeState, getWorldState, dispatchWorldAction } from '../worldState.js';
import { transitionTo } from '../ui/sceneTransitions.js';
import { FIELD_GRID_WIDTH, FIELD_GRID_CAPACITY } from '../configs/fieldGridConfig.js';
import { getCropLabel } from '../configs/cropConfig.js';
import { canConvertPlot, convertPlot, getConversionCost } from './plotConversionTunnel.js';
import { showConfirmation, showNotification } from '../ui/macNotifications.js';
import { renderModuleSlotButton } from './autofarmersUI.js';
import { registerRenderListener } from '../engine/gameClock.js';
import { getNodeCropEntries } from '../state/nodeCropView.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 500;

// ── Module state ──────────────────────────────────────────────────────────────

/** @type {HTMLElement|null} */
let _shell = null;

/** @type {number|null} */
let _refreshRenderUnsubscribe = null;

let _refreshAccumulatorMs = 0;

/** @type {string|null} */
let _mountedNodeId = null;

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _el(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls)  el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Finds `#node-overview-shell` and builds the static chrome (panels, bottom
 * bar, buttons). Safe to call multiple times — only builds once.
 */
export function initializeNodeOverview() {
    _shell = document.getElementById('node-overview-shell');
    if (!_shell) {
        console.warn('[nodeOverviewUI] #node-overview-shell not found');
        return;
    }

    // Guard: already built
    if (_shell.querySelector('.node-ov-layout')) {
        return;
    }

    const layout = _el('div', 'node-ov-layout');

    // ── Header ────────────────────────────────────────────────────────────────
    const header = _el('div', 'node-ov-header');
    const label  = _el('span', 'node-ov-node-label', '◉ …');
    label.id = 'node-ov-node-label';
    header.appendChild(label);
    layout.appendChild(header);

    // ── Body: stats + field ───────────────────────────────────────────────────
    const body = _el('div', 'node-ov-body');

    const statsPanel = _el('div', 'node-ov-stats');
    statsPanel.id = 'node-overview-stats';
    statsPanel.setAttribute('aria-label', 'Node stats');

    const fieldPanel = _el('div', 'node-ov-field');
    fieldPanel.id = 'node-overview-field';
    fieldPanel.setAttribute('aria-label', 'Field snapshot');
    fieldPanel.appendChild(_el('div', 'node-ov-field-title', 'Field Snapshot'));
    const grid = _el('div', 'node-ov-field-grid');
    grid.id = 'node-ov-field-grid';
    fieldPanel.appendChild(grid);

    body.appendChild(statsPanel);
    body.appendChild(fieldPanel);
    layout.appendChild(body);

    // ── Bottom bar ────────────────────────────────────────────────────────────
    const bar = _el('div', 'node-ov-bar');

    const zoomOutBtn = _el('button', 'node-ov-btn', '← World Map');
    zoomOutBtn.id = 'node-overview-zoom-out-btn';
    zoomOutBtn.type = 'button';
    zoomOutBtn.addEventListener('click', () => transitionTo('worldMap'));

    const enterBtn = _el('button', 'node-ov-btn node-ov-btn--primary', 'Enter Node →');
    enterBtn.id = 'node-overview-enter-btn';
    enterBtn.type = 'button';
    enterBtn.addEventListener('click', () => {
        if (!_mountedNodeId) {
            return;
        }

        const world = getWorldState();
        const isOwned = Array.isArray(world.ownedNodeIds) && world.ownedNodeIds.includes(_mountedNodeId);
        const nodeState = getNodeState(_mountedNodeId);
        if (!isOwned || !nodeState) {
            showNotification('This node is not populated yet.', 'Node Overview', 'warning');
            return;
        }

        if (world.activeNodeId !== _mountedNodeId) {
            dispatchWorldAction({
                type: 'world.patch',
                payload: {
                    updates: {
                        activeNodeId: _mountedNodeId,
                    },
                },
                meta: { source: 'nodeOverviewUI.enterNode' },
            });
        }

        transitionTo('desktop', _mountedNodeId);
    });

    bar.appendChild(zoomOutBtn);
    bar.appendChild(enterBtn);
    layout.appendChild(bar);

    _shell.appendChild(layout);
}

/**
 * Populates the overview with data for `nodeId` and starts the refresh timer.
 * @param {string} nodeId
 */
export function mountNodeOverview(nodeId) {
    if (!_shell) {
        initializeNodeOverview();
    }

    _mountedNodeId = nodeId;

    refreshStatsPanel(nodeId);
    renderFieldSnapshot(nodeId);

    if (_refreshRenderUnsubscribe !== null) {
        _refreshRenderUnsubscribe();
        _refreshRenderUnsubscribe = null;
    }

    _refreshAccumulatorMs = 0;
    _refreshRenderUnsubscribe = registerRenderListener(({ frameDeltaMs }) => {
        _refreshAccumulatorMs += Math.max(0, Number(frameDeltaMs) || 0);
        if (_refreshAccumulatorMs < REFRESH_INTERVAL_MS) {
            return;
        }

        _refreshAccumulatorMs = 0;
        if (_mountedNodeId) {
            refreshStatsPanel(_mountedNodeId);
            renderFieldSnapshot(_mountedNodeId);
        }
    });
}

/**
 * Stops the refresh timer and resets the panel to a blank state.
 */
export function unmountNodeOverview() {
    if (_refreshRenderUnsubscribe !== null) {
        _refreshRenderUnsubscribe();
        _refreshRenderUnsubscribe = null;
    }

    _refreshAccumulatorMs = 0;
    _mountedNodeId = null;
}

/**
 * Updates the left stats panel with current node values.
 * @param {string} nodeId
 */
export function refreshStatsPanel(nodeId) {
    const panel = document.getElementById('node-overview-stats');
    if (!panel) return;

    const ns = getNodeState(nodeId);
    if (!ns) return;

    // Build rows
    const rows = [];

    rows.push(['Node', ns.label || nodeId]);
    rows.push(['¤ Coins', String(Math.floor(ns.coins))]);
    rows.push(['≋ Water', `${ns.water} / ${ns.waterCapacity}`]);

    // Seeds (only show unlocked + nonzero)
    getNodeCropEntries(ns).forEach((entry) => {
        if (entry.unlocked && entry.seedCount > 0) {
            rows.push([`${getCropLabel(entry.cropId, { includeSymbol: false })} seeds`, String(entry.seedCount)]);
        }
    });

    // Crops in inventory
    getNodeCropEntries(ns).forEach((entry) => {
        if (entry.unlocked && entry.cropCount > 0) {
            rows.push([getCropLabel(entry.cropId, { includeSymbol: false }), String(entry.cropCount)]);
        }
    });

    // Active quests count
    const activeQuestCount = Array.isArray(ns.questsActive) ? ns.questsActive.length : 0;
    rows.push(['Active quests', String(activeQuestCount)]);

    // Crops/sec (lifetime average)
    const playTimeSec = Math.max(1, (ns.totalPlayTimeMs || 0) / 1000);
    const cropsPerSec = ((ns.cropsSold || 0) / playTimeSec).toFixed(2);
    rows.push(['Crops/sec', cropsPerSec]);

    // Render table
    panel.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'node-ov-table';
    rows.forEach(([key, val]) => {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.textContent = key;
        const td = document.createElement('td');
        td.textContent = val;
        tr.appendChild(th);
        tr.appendChild(td);
        table.appendChild(tr);
    });
    panel.appendChild(table);

    // Update header label
    const labelEl = document.getElementById('node-ov-node-label');
    if (labelEl) labelEl.textContent = `◉ ${ns.label || nodeId}`;
}

/**
 * Renders a read-only 9×9 ASCII field grid for the given node.
 * Crop plots are non-interactive spans. Module-slot plots get stub buttons.
 * @param {string} nodeId
 */
export function renderFieldSnapshot(nodeId) {
    const grid = document.getElementById('node-ov-field-grid');
    if (!grid) return;

    const ns = getNodeState(nodeId);
    if (!ns) return;

    const field = ns.fields?.[ns.activeFieldId];
    if (!field || !Array.isArray(field.plotStates)) return;

    const plotStates = field.plotStates;

    // Only rebuild if plot count, types, or autofarmer state changed (avoids thrashing DOM)
    const signature = plotStates.map(p =>
        `${p.owned ? 1 : 0}${p.plotType?.[0] ?? 'c'}${p.symbol ?? '~'}${p.moduleSlotType ?? ''}${p.moduleState?.tier ?? ''}`
    ).join('');
    if (grid.dataset.sig === signature) return;
    grid.dataset.sig = signature;

    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `repeat(${FIELD_GRID_WIDTH}, 1fr)`;

    for (let i = 0; i < FIELD_GRID_CAPACITY; i++) {
        const plot = plotStates[i];
        const row  = Math.floor(i / FIELD_GRID_WIDTH);
        const col  = i % FIELD_GRID_WIDTH;

        if (!plot?.owned) {
            const empty = _el('span', 'node-ov-cell node-ov-cell--empty', '·');
            empty.dataset.row = row;
            empty.dataset.col = col;
            grid.appendChild(empty);
            continue;
        }

        if (plot.plotType === 'module-slot') {
            const btn = renderModuleSlotButton(nodeId, i, () => renderFieldSnapshot(nodeId));
            btn.dataset.row = row;
            btn.dataset.col = col;
            btn.dataset.plotIndex = i;
            grid.appendChild(btn);
        } else {
            // Owned crop plot — interactive: click to convert
            const sym = plot.symbol ?? '~';
            const cell = _el('button', 'node-ov-cell node-ov-cell--crop-btn', sym);
            cell.type = 'button';
            cell.dataset.row = row;
            cell.dataset.col = col;
            cell.dataset.plotIndex = i;

            const cost = getConversionCost(nodeId);
            cell.title = `Convert to module slot (¤${cost})`;

            cell.addEventListener('click', async () => {
                const check = canConvertPlot(nodeId, i);
                if (!check.ok) {
                    await showNotification(check.reason, 'Cannot Convert', 'error');
                    return;
                }
                const confirmed = await showConfirmation(
                    `Convert this plot to a module slot for ¤${check.cost}?`,
                    { title: 'Convert Plot', category: 'warning' },
                );
                if (!confirmed) return;
                convertPlot(nodeId, i);
                renderFieldSnapshot(nodeId);
            });

            grid.appendChild(cell);
        }
    }
}
