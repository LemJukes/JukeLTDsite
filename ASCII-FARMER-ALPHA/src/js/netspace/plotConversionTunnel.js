// netspace/plotConversionTunnel.js
// Handles converting owned crop plots into module slots (and reverting them).
// Module slots are the foundation for autofarmer placement in Phase 3+.
//
// Coin cost scales with the number of existing module slots so early conversions
// are cheap and later ones become progressively more expensive.

import { getNodeState, getWorldState, dispatchWorldAction } from '../worldState.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Base coin cost for the first conversion. */
const BASE_COST = 50;

/** Additional cost per already-existing module slot. */
const COST_PER_EXISTING = 25;

/** Coin cost to dismantle an installed autofarmer. */
const DESTROY_AUTOFARMER_COST = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Counts the number of module-slot plots in the node's active field.
 * @param {string} nodeId
 * @returns {number}
 */
function _countModuleSlots(nodeId) {
    const ns = getNodeState(nodeId);
    if (!ns) return 0;
    const field = ns.fields?.[ns.activeFieldId];
    if (!field || !Array.isArray(field.plotStates)) return 0;
    return field.plotStates.filter((p) => p.plotType === 'module-slot').length;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the coin cost to convert the next crop plot in the given node.
 * Scales by the number of module slots already present in the active field.
 *
 * @param {string} nodeId
 * @returns {number}
 */
export function getConversionCost(nodeId) {
    return BASE_COST + _countModuleSlots(nodeId) * COST_PER_EXISTING;
}

/**
 * Returns the coin cost to destroy an installed autofarmer.
 * @returns {number}
 */
export function getDestroyAutofarmerCost() {
    return DESTROY_AUTOFARMER_COST;
}

/**
 * Validates whether plot `plotIndex` in `nodeId`'s active field can be
 * converted to a module slot right now.
 *
 * @param {string} nodeId
 * @param {number} plotIndex
 * @returns {{ ok: true, cost: number } | { ok: false, reason: string }}
 */
export function canConvertPlot(nodeId, plotIndex) {
    const ns = getNodeState(nodeId);
    if (!ns) return { ok: false, reason: 'Node not found.' };

    const field = ns.fields?.[ns.activeFieldId];
    if (!field || !Array.isArray(field.plotStates)) {
        return { ok: false, reason: 'No field data.' };
    }

    const plot = field.plotStates[plotIndex];
    if (!plot?.owned) return { ok: false, reason: 'Plot is not owned.' };
    if (plot.plotType !== 'crop') return { ok: false, reason: 'Already a module slot.' };
    if (plot.cropType !== null) {
        return { ok: false, reason: 'Plot has an active crop. Harvest it first.' };
    }

    const existingModuleSlots = _countModuleSlots(nodeId);
    const additionalAutofarmersUnlocked = Boolean(getWorldState().tutorialFlags?.additionalAutofarmersUnlocked);
    if (existingModuleSlots > 0 && !additionalAutofarmersUnlocked) {
        return { ok: false, reason: 'Additional module tunnels are locked for now.' };
    }

    const cost = getConversionCost(nodeId);
    if (ns.coins < cost) {
        return { ok: false, reason: `Not enough coins. Need ¤${cost} (have ¤${Math.floor(ns.coins)}).` };
    }

    return { ok: true, cost };
}

/**
 * Converts plot `plotIndex` in `nodeId`'s active field from a crop plot to a
 * module slot. Deducts the conversion cost from the node's coins.
 *
 * Returns `true` on success, `false` if the pre-flight check fails.
 *
 * @param {string} nodeId
 * @param {number} plotIndex
 * @returns {boolean}
 */
export function convertPlot(nodeId, plotIndex) {
    const check = canConvertPlot(nodeId, plotIndex);
    if (!check.ok) return false;

    const ns    = getNodeState(nodeId);
    const field = ns.fields[ns.activeFieldId];

    const newPlotStates = field.plotStates.map((p, i) =>
        i === plotIndex ? { ...p, plotType: 'module-slot' } : p,
    );
    const newFields = {
        ...ns.fields,
        [ns.activeFieldId]: { ...field, plotStates: newPlotStates },
    };

    dispatchWorldAction({
        type: 'node.patch',
        payload: {
            nodeId,
            updates: {
                coins: ns.coins - check.cost,
                fields: newFields,
            },
        },
        meta: { source: 'plotConversionTunnel.convertPlot' },
    });
    return true;
}

/**
 * Reverts a module-slot plot back to a standard crop plot. Only works if no
 * autofarmer has been installed (moduleSlotType === null). No coin refund is
 * given — the conversion cost is considered spent.
 *
 * Returns `true` on success, `false` if the plot cannot be reverted.
 *
 * @param {string} nodeId
 * @param {number} plotIndex
 * @returns {boolean}
 */
export function revertPlot(nodeId, plotIndex) {
    const ns = getNodeState(nodeId);
    if (!ns) return false;

    const field = ns.fields?.[ns.activeFieldId];
    if (!field || !Array.isArray(field.plotStates)) return false;

    const plot = field.plotStates[plotIndex];
    if (!plot?.owned) return false;
    if (plot.plotType !== 'module-slot') return false;
    if (plot.moduleSlotType !== null) {
        return false; // autofarmer installed — cannot revert
    }

    const newPlotStates = field.plotStates.map((p, i) =>
        i === plotIndex ? { ...p, plotType: 'crop', moduleSlotType: null, moduleState: null } : p,
    );
    const newFields = {
        ...ns.fields,
        [ns.activeFieldId]: { ...field, plotStates: newPlotStates },
    };

    dispatchWorldAction({
        type: 'node.patch',
        payload: {
            nodeId,
            updates: {
                fields: newFields,
            },
        },
        meta: { source: 'plotConversionTunnel.revertPlot' },
    });
    return true;
}

/**
 * Destroys an installed autofarmer, charging a dismantle fee and restoring
 * the tile to an empty module slot.
 *
 * @param {string} nodeId
 * @param {number} plotIndex
 * @returns {{ ok: true, cost: number } | { ok: false, error: string }}
 */
export function destroyAutofarmer(nodeId, plotIndex) {
    const ns = getNodeState(nodeId);
    if (!ns) return { ok: false, error: 'Node not found.' };

    const field = ns.fields?.[ns.activeFieldId];
    if (!field || !Array.isArray(field.plotStates)) return { ok: false, error: 'No active field.' };

    const plot = field.plotStates[plotIndex];
    if (!plot?.owned) return { ok: false, error: 'Plot not owned.' };
    if (plot.plotType !== 'module-slot') return { ok: false, error: 'Not a module slot.' };
    if (plot.moduleSlotType !== 'autofarmer') return { ok: false, error: 'No autofarmer installed.' };

    const destroyCost = getDestroyAutofarmerCost();
    if (Number(ns.coins) < destroyCost) {
        return { ok: false, error: `Need ¤${destroyCost} to destroy this Autofarmer.` };
    }

    const newPlotStates = field.plotStates.map((p, i) => (
        i === plotIndex
            ? {
                ...p,
                plotType: 'module-slot',
                symbol: '⚙',
                cropType: null,
                waterCount: 0,
                disabledUntil: 0,
                lastCompletedCropType: null,
                fallowPenaltySteps: 0,
                lastFallowDurationMs: 0,
                moduleSlotType: null,
                moduleState: null,
                lastUpdatedAt: Date.now(),
            }
            : p
    ));
    const newFields = {
        ...ns.fields,
        [ns.activeFieldId]: { ...field, plotStates: newPlotStates },
    };

    dispatchWorldAction({
        type: 'node.patch',
        payload: {
            nodeId,
            updates: {
                coins: Number(ns.coins) - destroyCost,
                totalCoinsSpent: (Number(ns.totalCoinsSpent) || 0) + destroyCost,
                fields: newFields,
            },
        },
        meta: { source: 'plotConversionTunnel.destroyAutofarmer' },
    });

    return { ok: true, cost: destroyCost };
}
