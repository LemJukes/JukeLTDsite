// schemas/v2StateShape.js
// v2 state schema: type documentation, default constants, and validation helpers.
// This file is the single source of truth for save structure in Alpha 2.0.
// worldState.js and persistence.js both import from here.

import { getCropIds } from '../configs/cropConfig.js';
import { FIELD_GRID_CAPACITY, FIELD_CENTER_INDEX } from '../configs/fieldGridConfig.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const SAVE_VERSION = 2;
export const NODE_CROP_SCHEMA_VERSION = 2;
export const DEFAULT_FARM_NODE_ID = 'farm-node-1';
export const DEFAULT_FIELD_ID = 'field-1';

export const VALID_PLOT_TYPES = /** @type {const} */ (['crop', 'module-slot']);
export const VALID_MODULE_SLOT_TYPES = /** @type {const} */ (['autofarmer']);
export const VALID_SCENE_NAMES = /** @type {const} */ (['desktop', 'nodeOverview', 'worldMap']);
export const VALID_ZOOM_LEVELS = /** @type {const} */ ([0, 1, 2]);

// ─────────────────────────────────────────────────────────────────────────────
// JSDoc Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} WorldSave
 * @property {number} version - Must be SAVE_VERSION (2)
 * @property {number} timestamp - Epoch ms of last save
 * @property {WorldState} world
 * @property {Object.<string, NodeState>} nodes
 */

/**
 * @typedef {Object} WorldState
 * @property {string} activeNodeId
 * @property {string[]} ownedNodeIds
 * @property {boolean} netSpaceUnlocked
 * @property {WorldGraph} worldGraph
 * @property {WorldStats} worldStats
 * @property {WorldTransportState} transport
 * @property {TutorialFlags} tutorialFlags
 * @property {string[]} worldAchievementsUnlocked
 * @property {string[]} completedMilestones
 * @property {0|1|2} lastActiveZoom
 */

/**
 * @typedef {Object} TutorialFlags
 * @property {boolean} upgradesIconHintShown
 * @property {boolean} questsIconHintShown
 * @property {boolean} netSpaceTutorialShown
 * @property {boolean} additionalAutofarmersUnlocked
 */

/**
 * @typedef {Object} WorldGraph
 * @property {Object.<string, WorldGraphNode>} nodes
 * @property {WorldGraphEdge[]} edges
 * @property {WorldGraphSlot[]} lockedSlots
 */

/**
 * @typedef {Object} WorldGraphNode
 * @property {string} id
 * @property {'farm'|'trunk'|'locked'} type
 * @property {string} label
 * @property {{ x: number, y: number }} position
 * @property {number|null} unlockedAt - Epoch ms; null if locked
 */

/**
 * @typedef {Object} WorldGraphEdge
 * @property {string} id
 * @property {string} from - nodeId
 * @property {string} to   - nodeId
 */

/**
 * @typedef {Object} WorldGraphSlot
 * @property {string} id
 * @property {{ x: number, y: number }} position
 * @property {string} unlockMilestoneId
 * @property {boolean} visible
 */

/**
 * @typedef {Object} WorldStats
 * @property {number} totalCoinsAcrossAllNodes
 * @property {number} totalCropsSoldAcrossAllNodes
 * @property {number|null} timeToGridMs - ms from gameStartedAt to first Net-Space access
 * @property {number|null} netSpaceFirstAccessAt - Epoch ms
 */

/**
 * @typedef {Object} WorldTransportTransfer
 * @property {string} id
 * @property {string} routeId
 * @property {string} fromNodeId
 * @property {string} toNodeId
 * @property {string} cargoId
 * @property {number} amount
 * @property {number} remainingMs
 * @property {string} status
 */

/**
 * @typedef {Object} WorldTransportRoute
 * @property {string} id
 * @property {string} fromNodeId
 * @property {string} toNodeId
 * @property {boolean} enabled
 */

/**
 * @typedef {Object} WorldTransportState
 * @property {Object.<string, WorldTransportRoute>} routes
 * @property {WorldTransportTransfer[]} transferQueue
 * @property {number} completedTransfers
 */

/**
 * @typedef {Object} NodeState
 * @property {string} id
 * @property {string} type
 * @property {string} label
 * @property {number} coins
 * @property {number} water
 * @property {number} cropSchemaVersion
 * @property {{ seedsByCrop: Object.<string, number>, cropsById: Object.<string, number> }} inventory
 * @property {{ seedsBoughtByCrop: Object.<string, number>, cropsSoldByCrop: Object.<string, number> }} progressByCrop
 * @property {{ crops: string[] }} unlocks
 * @property {number} plotDisableCoefficient
 * @property {Object.<string, FieldState>} fields
 * @property {string[]} ownedFieldIds
 * @property {string} activeFieldId
 * @property {number} nextFieldNumber
 * @property {string|null} plotSelectionMode
 * @property {number|null} pendingPlotPurchase
 * @property {boolean} fallowFatigueTutorialShown
 * @property {number} totalCoinsSpent
 * @property {number} totalCoinsEarned
 * @property {number} cropsSold
 * @property {number} seedsBought
 * @property {number} waterRefillsPurchased
 * @property {number} totalClicksClicked
 * @property {number} totalPlayTimeMs
 * @property {number} gameStartedAt
 * @property {string[]} questsUnlocked
 * @property {string[]} questsActive
 * @property {string[]} questsCompleted
 * @property {Object.<string, object>} questProgress
 * @property {number} totalCoinsFromQuests
 * @property {number} timedQuestsBeatenOnTime
 * @property {number} waterCapacity
 * @property {boolean} waterAutoBuyerUnlocked
 * @property {string} selectedTool
 * @property {string} selectedSeedType
 * @property {string[]} achievementsUnlocked
 */

/**
 * @typedef {Object} FieldState
 * @property {string} id
 * @property {string} name
 * @property {number} plots - count of owned plots
 * @property {PlotState[]} plotStates - always FIELD_GRID_CAPACITY entries
 */

/**
 * @typedef {Object} PlotState
 * @property {boolean} owned
 * @property {string} symbol
 * @property {string|null} cropType
 * @property {number} waterCount
 * @property {number} disabledUntil - epoch ms; 0 = not disabled
 * @property {string|null} lastCompletedCropType
 * @property {number} fallowPenaltySteps
 * @property {number} lastFallowDurationMs
 * @property {number} lastUpdatedAt
 * @property {boolean} destroyed
 * @property {'crop'|'module-slot'} plotType
 * @property {'autofarmer'|null} moduleSlotType
 * @property {AutofarmerModuleState|null} moduleState
 */

/**
 * @typedef {Object} AutofarmerModuleState
 * @property {number} lastTickAt
 * @property {number[]} clockwiseOrder   - Ordered clockwise list of valid plot indices in range
 * @property {number} clockCursor        - Current position in clockwiseOrder (advances one step per tick)
 * @property {boolean} isStalled         - True when last resource action failed (no water / no seeds)
 * @property {boolean} paused
 * @property {{ power: null, processing: null, memory: null }} crsSlots
 */

// ─────────────────────────────────────────────────────────────────────────────
// Default State Builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the initial world graph for a new game.
 * Farm node at origin, connected to a trunk. A few locked slots visible above.
 *
 * World-space layout (y increases downward on screen, but the trunk grows "up" = negative y):
 *
 *     slot-branch-b  slot-branch-c
 *           \              /
 *         trunk-upper
 *              |
 *         trunk-root
 *              |
 *          farm-node-1  ← origin (0, 0)
 *
 * @returns {WorldGraph}
 */
export function buildDefaultWorldGraph() {
    const now = Date.now();
    return {
        nodes: {
            'trunk-root': {
                id: 'trunk-root',
                type: 'trunk',
                label: 'TRUNK',
                position: { x: 0, y: -220 },
                unlockedAt: now,
            },
            [DEFAULT_FARM_NODE_ID]: {
                id: DEFAULT_FARM_NODE_ID,
                type: 'farm',
                label: 'NODE-01',
                position: { x: 0, y: 0 },
                unlockedAt: now,
            },
        },
        edges: [
            { id: 'edge-trunk-farm1', from: 'trunk-root', to: DEFAULT_FARM_NODE_ID },
        ],
        lockedSlots: [
            {
                id: 'slot-branch-a',
                position: { x: 0, y: -440 },
                unlockMilestoneId: 'net-space-unlocked',
                visible: false,
            },
            {
                id: 'slot-branch-b',
                position: { x: -200, y: -580 },
                unlockMilestoneId: 'first-autofarmer',
                visible: false,
            },
            {
                id: 'slot-branch-c',
                position: { x: 200, y: -580 },
                unlockMilestoneId: 'first-autofarmer',
                visible: false,
            },
        ],
    };
}

/**
 * Returns a fresh default PlotState for a given owned/unowned status.
 * @param {{ owned?: boolean }} options
 * @returns {PlotState}
 */
export function buildDefaultPlotState({ owned = false } = {}) {
    return {
        owned,
        symbol: '~',
        cropType: null,
        waterCount: 0,
        disabledUntil: 0,
        lastCompletedCropType: null,
        fallowPenaltySteps: 0,
        lastFallowDurationMs: 0,
        lastUpdatedAt: Date.now(),
        destroyed: false,
        plotType: 'crop',
        moduleSlotType: null,
        moduleState: null,
    };
}

/**
 * Returns a full default FieldState with one owned plot at center.
 * @param {{ id?: string, name?: string, ownedCount?: number }} options
 * @returns {FieldState}
 */
export function buildDefaultFieldState({ id = DEFAULT_FIELD_ID, name = 'Field 1', ownedCount = 1 } = {}) {
    const plotStates = Array.from({ length: FIELD_GRID_CAPACITY }, (_, index) => {
        const shouldOwn = ownedCount === 1 ? index === FIELD_CENTER_INDEX : index < ownedCount;
        return buildDefaultPlotState({ owned: shouldOwn });
    });

    return {
        id,
        name,
        plots: ownedCount,
        plotStates,
    };
}

/**
 * Returns the default world-level state for a new game.
 * @returns {WorldState}
 */
export function buildDefaultWorldState() {
    return {
        activeNodeId: DEFAULT_FARM_NODE_ID,
        ownedNodeIds: [DEFAULT_FARM_NODE_ID],
        netSpaceUnlocked: false,
        worldGraph: buildDefaultWorldGraph(),
        worldStats: {
            totalCoinsAcrossAllNodes: 0,
            totalCropsSoldAcrossAllNodes: 0,
            timeToGridMs: null,
            netSpaceFirstAccessAt: null,
        },
        transport: {
            routes: {},
            transferQueue: [],
            completedTransfers: 0,
        },
        tutorialFlags: {
            upgradesIconHintShown: false,
            questsIconHintShown: false,
            netSpaceTutorialShown: false,
            additionalAutofarmersUnlocked: false,
        },
        worldAchievementsUnlocked: [],
        completedMilestones: [],
        lastActiveZoom: 0,
    };
}

/**
 * Returns the default node state for the initial farm node.
 * @param {{ id?: string, label?: string }} options
 * @returns {NodeState}
 */
export function buildDefaultFarmNodeState({ id = DEFAULT_FARM_NODE_ID, label = 'NODE-01' } = {}) {
    const now = Date.now();
    const cropIds = getCropIds();
    const defaultSeedsByCrop = Object.fromEntries(cropIds.map((cropId) => [cropId, cropId === 'wheat' ? 1 : 0]));
    const defaultCropsById = Object.fromEntries(cropIds.map((cropId) => [cropId, 0]));
    const defaultSeedsBoughtByCrop = Object.fromEntries(cropIds.map((cropId) => [cropId, 0]));
    const defaultCropsSoldByCrop = Object.fromEntries(cropIds.map((cropId) => [cropId, 0]));

    return {
        id,
        type: 'farm',
        label,

        coins: 1,
        water: 10,
        cropSchemaVersion: NODE_CROP_SCHEMA_VERSION,

        inventory: {
            seedsByCrop: defaultSeedsByCrop,
            cropsById: defaultCropsById,
        },
        progressByCrop: {
            seedsBoughtByCrop: defaultSeedsBoughtByCrop,
            cropsSoldByCrop: defaultCropsSoldByCrop,
        },
        unlocks: {
            crops: ['wheat'],
        },

        plotDisableCoefficient: 1.15,
        fields: {
            [DEFAULT_FIELD_ID]: buildDefaultFieldState(),
        },
        ownedFieldIds: [DEFAULT_FIELD_ID],
        activeFieldId: DEFAULT_FIELD_ID,
        nextFieldNumber: 2,
        plotSelectionMode: null,
        pendingPlotPurchase: null,

        fallowFatigueTutorialShown: false,

        totalCoinsSpent: 0,
        totalCoinsEarned: 0,
        cropsSold: 0,
        seedsBought: 0,
        waterRefillsPurchased: 0,
        totalClicksClicked: 0,
        totalPlayTimeMs: 0,
        gameStartedAt: now,

        questsUnlocked: [],
        questsActive: [],
        questsCompleted: [],
        questProgress: {},
        totalCoinsFromQuests: 0,
        timedQuestsBeatenOnTime: 0,

        waterCapacity: 10,
        waterAutoBuyerUnlocked: false,

        selectedTool: 'Plow',
        selectedSeedType: 'wheat',

        achievementsUnlocked: [],
    };
}

/**
 * Returns a complete default WorldSave for a brand-new game.
 * @returns {WorldSave}
 */
export function buildDefaultWorldSave() {
    return {
        version: SAVE_VERSION,
        timestamp: Date.now(),
        world: buildDefaultWorldState(),
        nodes: {
            [DEFAULT_FARM_NODE_ID]: buildDefaultFarmNodeState(),
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isNumberFinite(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validates the structural shape of a raw parsed save object.
 * Returns a list of errors. An empty array means the save is structurally valid.
 * This does NOT normalize values — normalization happens in worldState.js.
 *
 * @param {unknown} raw
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateWorldSave(raw) {
    const errors = [];

    if (!isObject(raw)) {
        return { valid: false, errors: ['save is not an object'] };
    }

    // ── Top-level envelope ────────────────────────────────────────────────────
    if (raw.version !== SAVE_VERSION) {
        errors.push(`version mismatch: expected ${SAVE_VERSION}, got ${raw.version}`);
    }

    if (!isNumberFinite(raw.timestamp)) {
        errors.push('timestamp is not a finite number');
    }

    // ── World state ───────────────────────────────────────────────────────────
    if (!isObject(raw.world)) {
        errors.push('world is not an object');
    } else {
        const w = raw.world;

        if (typeof w.activeNodeId !== 'string' || w.activeNodeId.length === 0) {
            errors.push('world.activeNodeId is not a non-empty string');
        }

        if (!Array.isArray(w.ownedNodeIds)) {
            errors.push('world.ownedNodeIds is not an array');
        }

        if (typeof w.netSpaceUnlocked !== 'boolean') {
            errors.push('world.netSpaceUnlocked is not a boolean');
        }

        if (!isObject(w.worldGraph)) {
            errors.push('world.worldGraph is not an object');
        } else {
            if (!isObject(w.worldGraph.nodes)) {
                errors.push('world.worldGraph.nodes is not an object');
            }
            if (!Array.isArray(w.worldGraph.edges)) {
                errors.push('world.worldGraph.edges is not an array');
            }
            if (!Array.isArray(w.worldGraph.lockedSlots)) {
                errors.push('world.worldGraph.lockedSlots is not an array');
            }
        }

        if (!isObject(w.worldStats)) {
            errors.push('world.worldStats is not an object');
        }

        if (!isObject(w.transport)) {
            errors.push('world.transport is not an object');
        } else {
            if (!isObject(w.transport.routes)) {
                errors.push('world.transport.routes is not an object');
            }

            if (!Array.isArray(w.transport.transferQueue)) {
                errors.push('world.transport.transferQueue is not an array');
            }

            if (!isNumberFinite(w.transport.completedTransfers)) {
                errors.push('world.transport.completedTransfers is not a finite number');
            }
        }

        if (!Array.isArray(w.worldAchievementsUnlocked)) {
            errors.push('world.worldAchievementsUnlocked is not an array');
        }

        if (!Array.isArray(w.completedMilestones)) {
            errors.push('world.completedMilestones is not an array');
        }

        if (!VALID_ZOOM_LEVELS.includes(w.lastActiveZoom)) {
            errors.push(`world.lastActiveZoom must be 0, 1, or 2; got ${w.lastActiveZoom}`);
        }
    }

    // ── Nodes ─────────────────────────────────────────────────────────────────
    if (!isObject(raw.nodes)) {
        errors.push('nodes is not an object');
    } else {
        const nodeIds = Object.keys(raw.nodes);
        if (nodeIds.length === 0) {
            errors.push('nodes has no entries');
        }

        for (const nodeId of nodeIds) {
            const node = raw.nodes[nodeId];
            if (!isObject(node)) {
                errors.push(`nodes.${nodeId} is not an object`);
                continue;
            }

            if (node.id !== nodeId) {
                errors.push(`nodes.${nodeId}.id mismatch: expected '${nodeId}', got '${node.id}'`);
            }

            if (typeof node.type !== 'string' || node.type.length === 0) {
                errors.push(`nodes.${nodeId}.type must be a non-empty string; got '${node.type}'`);
            }

            if (!isObject(node.fields)) {
                errors.push(`nodes.${nodeId}.fields is not an object`);
            } else {
                for (const fieldId of Object.keys(node.fields)) {
                    const field = node.fields[fieldId];
                    if (!isObject(field)) {
                        errors.push(`nodes.${nodeId}.fields.${fieldId} is not an object`);
                        continue;
                    }
                    if (!Array.isArray(field.plotStates)) {
                        errors.push(`nodes.${nodeId}.fields.${fieldId}.plotStates is not an array`);
                    } else if (field.plotStates.length !== FIELD_GRID_CAPACITY) {
                        errors.push(`nodes.${nodeId}.fields.${fieldId}.plotStates length mismatch: expected ${FIELD_GRID_CAPACITY}, got ${field.plotStates.length}`);
                    } else {
                        const cropIds = getCropIds();
                        field.plotStates.forEach((plot, i) => {
                            if (!isObject(plot)) {
                                errors.push(`nodes.${nodeId}.fields.${fieldId}.plotStates[${i}] is not an object`);
                                return;
                            }
                            if (plot.plotType !== undefined && !VALID_PLOT_TYPES.includes(plot.plotType)) {
                                errors.push(`nodes.${nodeId}.fields.${fieldId}.plotStates[${i}].plotType invalid: '${plot.plotType}'`);
                            }
                            if (plot.moduleSlotType !== undefined && plot.moduleSlotType !== null && !VALID_MODULE_SLOT_TYPES.includes(plot.moduleSlotType)) {
                                errors.push(`nodes.${nodeId}.fields.${fieldId}.plotStates[${i}].moduleSlotType invalid: '${plot.moduleSlotType}'`);
                            }
                            if (plot.cropType !== null && plot.cropType !== undefined && !cropIds.includes(plot.cropType)) {
                                errors.push(`nodes.${nodeId}.fields.${fieldId}.plotStates[${i}].cropType invalid: '${plot.cropType}'`);
                            }
                        });
                    }
                }
            }

            if (!Array.isArray(node.achievementsUnlocked)) {
                errors.push(`nodes.${nodeId}.achievementsUnlocked is not an array`);
            }
            if (!Array.isArray(node.questsUnlocked)) {
                errors.push(`nodes.${nodeId}.questsUnlocked is not an array`);
            }
        }
    }

    return { valid: errors.length === 0, errors };
}
