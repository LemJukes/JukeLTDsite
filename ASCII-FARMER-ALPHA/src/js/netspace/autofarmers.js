// netspace/autofarmers.js
// Base Autofarmer module system for Alpha 2.0 netspace architecture.
// Autofarmers occupy module-slot plots and autonomously work one adjacent crop
// plot per tick, advancing clockwise at a fixed starter cadence/radius.

import { getNodeState, getWorldState, dispatchWorldAction } from '../worldState.js';
import { getCropConfig, getCropIds, getGrowthSymbol } from '../configs/cropConfig.js';
import { FIELD_GRID_WIDTH } from '../configs/fieldGridConfig.js';
import { HARVEST_SYMBOLS, WATERING_SYMBOLS } from '../configs/toolConfig.js';
import { applyPlotFallowAfterHarvest } from '../domain/farming/plotFallow.js';
import { getCropSeedCount, getCropInventoryCount, isCropUnlocked } from '../state/nodeCropView.js';

export const BUILD_COST = 100;
const BASE_TICK_INTERVAL_MS = 1000;
const BASE_RANGE_RADIUS = 1;
const DEFAULT_AUTOFARMER_CROP = 'wheat';

/** Returns the flat build cost. */
export function getAutofarmCost() {
    return BUILD_COST;
}

/**
 * Returns clockwise-ordered [rowOff, colOff] pairs for ring r, starting from
 * directly above (-r, 0) and sweeping clockwise.
 *
 * @param {number} r  Ring radius (1-based)
 * @returns {[number, number][]}
 */
function computeRingClockwiseOffsets(r) {
    const offsets = [];
    // Top-right: (-r, 0) -> (-r, r)
    for (let c = 0; c <= r; c++) offsets.push([-r, c]);
    // Right col: (-r+1, r) -> (r, r)
    for (let rr = -r + 1; rr <= r; rr++) offsets.push([rr, r]);
    // Bottom: (r, r-1) -> (r, -r)
    for (let c = r - 1; c >= -r; c--) offsets.push([r, c]);
    // Left col: (r-1, -r) -> (-r, -r)
    for (let rr = r - 1; rr >= -r; rr--) offsets.push([rr, -r]);
    // Top-left: (-r, -r+1) -> (-r, -1)
    for (let c = -r + 1; c <= -1; c++) offsets.push([-r, c]);
    return offsets;
}

/**
 * Computes the clockwise-ordered list of valid plot indices reachable by an
 * autofarmer at plotIndex using the fixed base radius.
 *
 * @param {number} plotIndex
 * @param {Array} plotStates
 * @returns {number[]}
 */
export function computeClockwiseOrder(plotIndex, plotStates) {
    const originRow = Math.floor(plotIndex / FIELD_GRID_WIDTH);
    const originCol = plotIndex % FIELD_GRID_WIDTH;
    const result = [];

    for (let r = 1; r <= BASE_RANGE_RADIUS; r++) {
        for (const [rowOff, colOff] of computeRingClockwiseOffsets(r)) {
            const row = originRow + rowOff;
            const col = originCol + colOff;
            if (row < 0 || row >= FIELD_GRID_WIDTH || col < 0 || col >= FIELD_GRID_WIDTH) continue;
            const idx = row * FIELD_GRID_WIDTH + col;
            const plot = plotStates?.[idx];
            if (plot?.owned && !plot?.destroyed && plot?.plotType !== 'module-slot') {
                result.push(idx);
            }
        }
    }

    return result;
}

/**
 * Places a new autofarmer on a module-slot plot at base starter capability.
 * Deducts BUILD_COST from the node's coin balance.
 *
 * @param {string} nodeId
 * @param {number} plotIndex
 * @returns {{ ok: boolean, error?: string }}
 */
export function buildAutofarmer(nodeId, plotIndex) {
    const ns = getNodeState(nodeId);
    if (!ns) return { ok: false, error: 'Node not found.' };

    const field = ns.fields?.[ns.activeFieldId];
    if (!field || !Array.isArray(field.plotStates)) return { ok: false, error: 'No active field.' };

    const plotState = field.plotStates[plotIndex];
    if (!plotState?.owned) return { ok: false, error: 'Plot not owned.' };
    if (plotState.plotType !== 'module-slot') return { ok: false, error: 'Not a module slot.' };
    if (plotState.moduleState) return { ok: false, error: 'Slot already occupied.' };

    if (Number(ns.coins) < BUILD_COST) return { ok: false, error: 'Insufficient coins.' };

    const clockwiseOrder = computeClockwiseOrder(plotIndex, field.plotStates);

    const nextPlotStates = [...field.plotStates];
    nextPlotStates[plotIndex] = {
        ...plotState,
        moduleSlotType: 'autofarmer',
        moduleState: {
            lastTickAt: 0,
            clockwiseOrder,
            clockCursor: 0,
            isStalled: false,
            paused: false,
            crsSlots: { power: null, processing: null, memory: null },
        },
        lastUpdatedAt: Date.now(),
    };

    dispatchWorldAction({
        type: 'node.patch',
        payload: {
            nodeId,
            updates: {
                coins: Number(ns.coins) - BUILD_COST,
                totalCoinsSpent: (Number(ns.totalCoinsSpent) || 0) + BUILD_COST,
                fields: {
                    ...ns.fields,
                    [ns.activeFieldId]: { ...field, plotStates: nextPlotStates },
                },
            },
        },
        meta: { source: 'autofarmers.buildAutofarmer' },
    });

    return { ok: true };
}

/**
 * Returns a summary of an autofarmer's current state, or null if none exists.
 *
 * @param {string} nodeId
 * @param {number} plotIndex
 * @returns {{ clockwiseOrder: number[], rangeRadius: number, tickIntervalMs: number, isStalled: boolean, paused: boolean, lastTickAt: number } | null}
 */
export function getAutofarmState(nodeId, plotIndex) {
    const ns = getNodeState(nodeId);
    if (!ns) return null;

    const field = ns.fields?.[ns.activeFieldId];
    const plotState = field?.plotStates?.[plotIndex];
    if (plotState?.moduleSlotType !== 'autofarmer' || !plotState.moduleState) return null;

    const ms = plotState.moduleState;
    return {
        clockwiseOrder: ms.clockwiseOrder ?? [],
        rangeRadius: BASE_RANGE_RADIUS,
        tickIntervalMs: BASE_TICK_INTERVAL_MS,
        isStalled: Boolean(ms.isStalled),
        lastTickAt: Number(ms.lastTickAt) || 0,
        paused: Boolean(ms.paused),
    };
}

function pickNextCropType(availableSeedsByCrop, nodeState) {
    if ((availableSeedsByCrop[DEFAULT_AUTOFARMER_CROP] ?? 0) > 0) {
        return DEFAULT_AUTOFARMER_CROP;
    }

    const allCropIds = getCropIds();
    return allCropIds.find((cropId) => {
        return isCropUnlocked(nodeState, cropId) && (availableSeedsByCrop[cropId] ?? 0) > 0;
    }) ?? null;
}

/**
 * Processes one engine tick for all autofarmers on the given node.
 * Called by the central game clock simulation step.
 *
 * Each autofarmer advances its clockwise cursor by one step per tick and acts
 * on that single plot. The full tick delay is always observed, even when the
 * cursor lands on a non-actionable tile.
 *
 * isStalled is set true when a resource-dependent action fails (no water / no
 * seeds) and reset to false when any resource action succeeds.
 *
 * @param {string} nodeId
 */
export function tickAutofarmers(nodeId) {
    const ns = getNodeState(nodeId);
    if (!ns) return;

    const activeFieldId = ns.activeFieldId;
    const field = ns.fields?.[activeFieldId];
    if (!field || !Array.isArray(field.plotStates)) return;

    const now = Date.now();
    let dirty = false;

    // Shallow-copy each plot so we can mutate safely
    const plotStates = field.plotStates.map((p) => (p ? { ...p } : p));

    // Track resource deltas so we commit once at the end
    const cropIds = getCropIds();
    const cropDeltas = Object.fromEntries(cropIds.map((id) => [id, 0]));
    const seedDeltas = Object.fromEntries(cropIds.map((id) => [`${id}Seeds`, 0]));

    // Live-track available resources so multiple autofarmers do not over-spend
    let availableWater = Number(ns.water) || 0;
    const availableSeedsByCrop = Object.fromEntries(
        cropIds.map((id) => [id, getCropSeedCount(ns, id)]),
    );

    plotStates.forEach((plotState, plotIndex) => {
        if (!plotState) return;
        if (plotState.plotType !== 'module-slot') return;
        if (plotState.moduleSlotType !== 'autofarmer') return;

        const ms = plotState.moduleState;
        if (!ms || ms.paused) return;

        if ((now - (Number(ms.lastTickAt) || 0)) < BASE_TICK_INTERVAL_MS) return;

        const order = computeClockwiseOrder(plotIndex, plotStates);

        if (order.length === 0) {
            plotStates[plotIndex] = {
                ...plotState,
                moduleState: {
                    ...ms,
                    lastTickAt: now,
                    clockwiseOrder: order,
                    isStalled: true,
                },
            };
            dirty = true;
            return;
        }

        const cursor = ((Number(ms.clockCursor) || 0) + 1) % order.length;
        const targetIndex = order[cursor];
        const targetPlot = plotStates[targetIndex];

        let newIsStalled = Boolean(ms.isStalled);

        if (targetPlot?.owned && !targetPlot?.destroyed && targetPlot.plotType !== 'module-slot') {
            const disabledUntil = Number(targetPlot.disabledUntil) || 0;
            if (disabledUntil <= now) {
                const sym = targetPlot.symbol;

                if (HARVEST_SYMBOLS.includes(sym)) {
                    const cropType = targetPlot.cropType;
                    const newPlotState = {
                        ...targetPlot,
                        symbol: '~',
                        cropType: null,
                        waterCount: 0,
                        lastUpdatedAt: now,
                    };
                    applyPlotFallowAfterHarvest(newPlotState, cropType, field.plots, ns);
                    plotStates[targetIndex] = newPlotState;
                    if (cropIds.includes(cropType)) {
                        cropDeltas[cropType] += 1;
                    }
                } else if (WATERING_SYMBOLS.includes(sym)) {
                    if (availableWater < 1) {
                        newIsStalled = true;
                    } else {
                        const cropConfig = getCropConfig(targetPlot.cropType);
                        if (cropConfig) {
                            const nextWaterCount = (Number(targetPlot.waterCount) || 0) + 1;
                            const nextSymbol = nextWaterCount > cropConfig.waterStages
                                ? cropConfig.symbol
                                : getGrowthSymbol(nextWaterCount - 1);
                            plotStates[targetIndex] = {
                                ...targetPlot,
                                waterCount: nextWaterCount,
                                symbol: nextSymbol,
                                disabledUntil: 0,
                                lastUpdatedAt: now,
                            };
                            availableWater--;
                            newIsStalled = false;
                        }
                    }
                } else if (sym === '=') {
                    const seedType = pickNextCropType(availableSeedsByCrop, ns);
                    if (!seedType) {
                        newIsStalled = true;
                    } else {
                        const seedKey = `${seedType}Seeds`;
                        if ((availableSeedsByCrop[seedType] ?? 0) < 1) {
                            newIsStalled = true;
                        } else {
                            const cropConfig = getCropConfig(seedType);
                            if (cropConfig) {
                                plotStates[targetIndex] = {
                                    ...targetPlot,
                                    symbol: '.',
                                    cropType: seedType,
                                    waterCount: 0,
                                    disabledUntil: 0,
                                    lastUpdatedAt: now,
                                };
                                availableSeedsByCrop[seedType]--;
                                seedDeltas[seedKey] = (seedDeltas[seedKey] || 0) - 1;
                                newIsStalled = false;
                            }
                        }
                    }
                } else if (sym === '~') {
                    plotStates[targetIndex] = {
                        ...targetPlot,
                        symbol: '=',
                        disabledUntil: 0,
                        lastUpdatedAt: now,
                    };
                }
            }
        }

        plotStates[plotIndex] = {
            ...plotState,
            moduleState: {
                ...ms,
                lastTickAt: now,
                clockwiseOrder: order,
                clockCursor: cursor,
                isStalled: newIsStalled,
            },
        };
        dirty = true;
    });

    if (!dirty) return;

    const updates = {
        water: Math.max(0, availableWater),
        fields: {
            ...ns.fields,
            [activeFieldId]: { ...field, plotStates },
        },
    };

    let inventoryDirty = false;
    const nextSeedsByCrop = {
        ...(ns.inventory?.seedsByCrop || {}),
    };
    const nextCropsById = {
        ...(ns.inventory?.cropsById || {}),
    };

    cropIds.forEach((id) => {
        if (cropDeltas[id] !== 0) {
            nextCropsById[id] = Math.max(0, getCropInventoryCount(ns, id) + cropDeltas[id]);
            inventoryDirty = true;
        }

        const seedKey = `${id}Seeds`;
        if (seedDeltas[seedKey] !== 0) {
            nextSeedsByCrop[id] = Math.max(0, getCropSeedCount(ns, id) + seedDeltas[seedKey]);
            inventoryDirty = true;
        }
    });

    if (inventoryDirty) {
        updates.inventory = {
            ...(ns.inventory || {}),
            seedsByCrop: nextSeedsByCrop,
            cropsById: nextCropsById,
        };
    }

    dispatchWorldAction({
        type: 'node.patch',
        payload: {
            nodeId,
            updates,
        },
        meta: { source: 'autofarmers.tickAutofarmers' },
    });
}

/**
 * Advances autofarmers for all owned nodes in the current world.
 * This keeps autofarmer simulation independent from field window visibility.
 */
export function runAutofarmerSimulationStep() {
    const world = getWorldState();
    const nodeIds = Array.isArray(world?.ownedNodeIds)
        ? world.ownedNodeIds
        : [];

    nodeIds.forEach((nodeId) => {
        tickAutofarmers(nodeId);
    });
}
