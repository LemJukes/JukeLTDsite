// worldState.js
// v2 state manager — single source of truth for all game state.
// Replaces state.js. All handlers and UI modules import from here.

import { savePartialSnapshot } from './persistence.js';
import { getCropIds } from './configs/cropConfig.js';
import {
    FIELD_GRID_CAPACITY,
    FIELD_CENTER_INDEX,
    countOwnedPlots,
} from './configs/fieldGridConfig.js';
import {
    SAVE_VERSION,
    NODE_CROP_SCHEMA_VERSION,
    DEFAULT_FARM_NODE_ID,
    DEFAULT_FIELD_ID,
    buildDefaultWorldState,
    buildDefaultFarmNodeState,
    buildDefaultFieldState,
    buildDefaultWorldSave,
} from './schemas/v2StateShape.js';
import {
    reduceWorldPatch,
    reduceNodePatch,
    reduceNodeFieldPatch,
    reduceNodeQuestPatch,
    reduceNodeEconomyPatch,
} from './state/nodeStateReducer.js';
import {
    normalizeNodeCropCollections,
    adaptNodeStateLegacyPatch,
} from './state/nodeStateAdapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// Internal mutable state
// ─────────────────────────────────────────────────────────────────────────────

/** @type {import('./schemas/v2StateShape.js').WorldState} */
let _world = buildDefaultWorldState();

/** @type {Object.<string, import('./schemas/v2StateShape.js').NodeState>} */
let _nodes = { [DEFAULT_FARM_NODE_ID]: buildDefaultFarmNodeState() };

let _sessionStartedAt = Date.now();
let _persistQueued = false;
let _persistDebounceTimerId = null;
let _persistFirstQueuedAt = 0;
let _persistPendingWorld = false;
let _persistPendingNodeIds = new Set();
let _worldStateLoggingEnabled = false;
let _actionSequence = 0;
let _worldStateDevSafetyEnabled = false;

const PERSIST_DEBOUNCE_MS = 250;
const PERSIST_MAX_WAIT_MS = 2000;

function shouldEnableWorldStateDevSafety() {
    if (typeof window === 'undefined' || !window.location) {
        return false;
    }

    const { protocol } = window.location;

    return protocol === 'file:' || protocol.startsWith('vscode-');
}

// ─────────────────────────────────────────────────────────────────────────────
// Microtask-batched persistence
// ─────────────────────────────────────────────────────────────────────────────

function buildNodeSnapshot(node) {
    return {
        ...node,
        inventory: {
            seedsByCrop: { ...(node.inventory?.seedsByCrop ?? {}) },
            cropsById: { ...(node.inventory?.cropsById ?? {}) },
        },
        progressByCrop: {
            seedsBoughtByCrop: { ...(node.progressByCrop?.seedsBoughtByCrop ?? {}) },
            cropsSoldByCrop: { ...(node.progressByCrop?.cropsSoldByCrop ?? {}) },
        },
        unlocks: {
            crops: [...(node.unlocks?.crops ?? [])],
        },
        fields: buildFieldsSnapshot(node.fields),
        achievementsUnlocked: [...(node.achievementsUnlocked ?? [])],
        questsUnlocked: [...(node.questsUnlocked ?? [])],
        questsActive: [...(node.questsActive ?? [])],
        questsCompleted: [...(node.questsCompleted ?? [])],
        questProgress: { ...(node.questProgress ?? {}) },
    };
}

function buildNodesSliceSnapshot(nodeIds) {
    const snapshot = {};
    nodeIds.forEach((nodeId) => {
        if (!_nodes[nodeId]) {
            return;
        }
        snapshot[nodeId] = buildNodeSnapshot(_nodes[nodeId]);
    });
    return snapshot;
}

function clearPersistDirtySlices() {
    _persistPendingWorld = false;
    _persistPendingNodeIds = new Set();
}

function persistCurrentSnapshot() {
    const partial = {};

    if (_persistPendingWorld) {
        partial.world = getWorldState();
    }

    if (_persistPendingNodeIds.size > 0) {
        partial.nodePatches = buildNodesSliceSnapshot(_persistPendingNodeIds);
    }

    if (Object.keys(partial).length === 0) {
        return;
    }

    savePartialSnapshot(partial);
    clearPersistDirtySlices();
}

export function flushPendingStatePersist() {
    if (_persistDebounceTimerId !== null) {
        clearTimeout(_persistDebounceTimerId);
        _persistDebounceTimerId = null;
    }

    if (!_persistQueued) {
        return;
    }

    _persistQueued = false;
    _persistFirstQueuedAt = 0;
    persistCurrentSnapshot();
}

function markPersistFullSnapshotDirty() {
    _persistPendingWorld = true;
    _persistPendingNodeIds = new Set(Object.keys(_nodes));
}

function markPersistDirtySlices(dirtySlices = {}) {
    const hasWorld = Boolean(dirtySlices?.world);
    const nodeIds = Array.isArray(dirtySlices?.nodeIds)
        ? dirtySlices.nodeIds.filter((nodeId) => typeof nodeId === 'string' && nodeId.length > 0)
        : [];

    if (!hasWorld && nodeIds.length === 0) {
        markPersistFullSnapshotDirty();
        return;
    }

    if (hasWorld) {
        _persistPendingWorld = true;
    }

    nodeIds.forEach((nodeId) => {
        _persistPendingNodeIds.add(nodeId);
    });
}

/**
 * Schedules a debounced save. Bursts collapse into fewer writes while a
 * max-wait cap ensures queued updates are still flushed promptly.
 */
export function scheduleStatePersist(dirtySlices = {}) {
    markPersistDirtySlices(dirtySlices);

    const now = Date.now();

    if (!_persistQueued) {
        _persistQueued = true;
        _persistFirstQueuedAt = now;
    }

    if (_persistDebounceTimerId !== null) {
        return;
    }

    const elapsed = Math.max(0, now - _persistFirstQueuedAt);
    const remainingMaxWait = Math.max(0, PERSIST_MAX_WAIT_MS - elapsed);
    const delayMs = Math.min(PERSIST_DEBOUNCE_MS, remainingMaxWait);

    _persistDebounceTimerId = setTimeout(() => {
        _persistDebounceTimerId = null;
        flushPendingStatePersist();
    }, delayMs);
}

// ─────────────────────────────────────────────────────────────────────────────
// Private: plot normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes a raw autofarmer module state object.
 * Returns null if moduleSlotType is not 'autofarmer' or if raw is invalid.
 *
 * @param {string|null} moduleSlotType
 * @param {unknown} raw
 * @returns {import('./schemas/v2StateShape.js').AutofarmerModuleState|null}
 */
function normalizeModuleState(moduleSlotType, raw) {
    if (moduleSlotType !== 'autofarmer') {
        return null;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }

    return {
        lastTickAt: Number(raw.lastTickAt) || 0,
        clockwiseOrder: Array.isArray(raw.clockwiseOrder)
            ? raw.clockwiseOrder.filter((i) => Number.isInteger(i) && i >= 0)
            : [],
        clockCursor: Math.max(0, Number(raw.clockCursor) || 0),
        isStalled: Boolean(raw.isStalled),
        paused: Boolean(raw.paused),
        crsSlots: { power: null, processing: null, memory: null },
    };
}

/**
 * Normalizes a raw plot state, adding v2 fields (plotType, moduleSlotType,
 * moduleState) while preserving all existing crop-plot logic from v1.
 *
 * @param {unknown} plot
 * @returns {import('./schemas/v2StateShape.js').PlotState}
 */
function normalizePlotState(plot) {
    const hasExplicitOwnership = typeof plot?.owned === 'boolean';
    const isOwned = hasExplicitOwnership ? Boolean(plot.owned) : true;

    if (!isOwned) {
        return {
            owned: false,
            symbol: '~',
            cropType: null,
            waterCount: 0,
            disabledUntil: 0,
            lastCompletedCropType: null,
            fallowPenaltySteps: 0,
            lastFallowDurationMs: 0,
            lastUpdatedAt: Number(plot?.lastUpdatedAt) || Date.now(),
            destroyed: false,
            plotType: 'crop',
            moduleSlotType: null,
            moduleState: null,
        };
    }

    const rawPlotType = plot?.plotType;
    const plotType = rawPlotType === 'module-slot' ? 'module-slot' : 'crop';

    // Module-slot plots: clear crop fields, preserve module state
    if (plotType === 'module-slot') {
        const rawModuleSlotType = plot?.moduleSlotType;
        const moduleSlotType = rawModuleSlotType === 'autofarmer' ? 'autofarmer' : null;
        const moduleState = normalizeModuleState(moduleSlotType, plot?.moduleState);

        return {
            owned: true,
            symbol: '\u2699',
            cropType: null,
            waterCount: 0,
            disabledUntil: 0,
            lastCompletedCropType: null,
            fallowPenaltySteps: 0,
            lastFallowDurationMs: 0,
            lastUpdatedAt: Number(plot?.lastUpdatedAt) || Date.now(),
            destroyed: false,
            plotType: 'module-slot',
            moduleSlotType,
            moduleState,
        };
    }

    // Standard crop plot
    const isDestroyed = Boolean(plot?.destroyed) || plot?.symbol === '\u22A0';
    const cropIds = getCropIds();

    return {
        owned: true,
        symbol: isDestroyed ? '\u22A0' : (plot?.symbol ?? '~'),
        cropType: cropIds.includes(plot?.cropType) ? plot.cropType : null,
        waterCount: Number(plot?.waterCount) || 0,
        disabledUntil: Number(plot?.disabledUntil) || 0,
        lastCompletedCropType: cropIds.includes(plot?.lastCompletedCropType)
            ? plot.lastCompletedCropType
            : null,
        fallowPenaltySteps: Math.max(0, Number(plot?.fallowPenaltySteps) || 0),
        lastFallowDurationMs: Math.max(0, Number(plot?.lastFallowDurationMs) || 0),
        lastUpdatedAt: Number(plot?.lastUpdatedAt) || Date.now(),
        destroyed: isDestroyed,
        plotType: 'crop',
        moduleSlotType: null,
        moduleState: null,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Private: field normalization (ported from state.js)
// ─────────────────────────────────────────────────────────────────────────────

function clampOwnedCount(value, fallback = 1) {
    const parsed = Number(value);
    const normalized = Number.isFinite(parsed) ? parsed : Number(fallback);
    return Math.min(FIELD_GRID_CAPACITY, Math.max(0, Number(normalized) || 0));
}

function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value.filter((entry) => typeof entry === 'string' && entry.length > 0))];
}

function normalizeQuestProgress(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    const result = {};
    Object.entries(value).forEach(([questId, progress]) => {
        if (!questId || !progress || typeof progress !== 'object' || Array.isArray(progress)) {
            return;
        }
        result[questId] = { ...progress };
    });
    return result;
}

/**
 * Normalizes a single field: ensures 81 plotStates, correct ownership flags.
 *
 * @param {unknown} field
 * @param {import('./schemas/v2StateShape.js').FieldState} fallback
 * @returns {import('./schemas/v2StateShape.js').FieldState}
 */
function normalizeField(field, fallback) {
    const fallbackPlots = Math.max(1, clampOwnedCount(fallback.plots, 1));
    const basePlotStates = Array.isArray(field?.plotStates)
        ? field.plotStates
        : (Array.isArray(fallback.plotStates) ? fallback.plotStates : []);
    const hasExplicitOwnership = basePlotStates.some((p) => typeof p?.owned === 'boolean');
    const requestedOwnedCount = Math.max(
        1,
        clampOwnedCount(
            field?.plots,
            Number(fallback.plots) || (hasExplicitOwnership ? countOwnedPlots(basePlotStates) : basePlotStates.length || fallbackPlots),
        ),
    );

    const normalizedPlotStates = [];
    for (let i = 0; i < FIELD_GRID_CAPACITY; i++) {
        const existingPlot = basePlotStates[i];
        const shouldOwn = hasExplicitOwnership
            ? Boolean(existingPlot?.owned)
            : (requestedOwnedCount === 1 ? i === FIELD_CENTER_INDEX : i < requestedOwnedCount);
        normalizedPlotStates.push(
            shouldOwn
                ? normalizePlotState({ ...existingPlot, owned: true })
                : normalizePlotState({ owned: false, lastUpdatedAt: existingPlot?.lastUpdatedAt }),
        );
    }

    let normalizedPlots = countOwnedPlots(normalizedPlotStates);
    if (normalizedPlots < 1) {
        normalizedPlotStates[FIELD_CENTER_INDEX] = normalizePlotState({ owned: true });
        normalizedPlots = 1;
    }

    return {
        id: field?.id || fallback.id,
        name: field?.name || fallback.name || 'Field',
        plots: normalizedPlots,
        plotStates: normalizedPlotStates,
    };
}

/**
 * Ensures the fields map on a node has correct shape.
 * Normalizes all existing fields; guarantees field-1 always exists.
 *
 * @param {Partial<import('./schemas/v2StateShape.js').NodeState>} nodeState
 * @returns {{ fields: Object, ownedFieldIds: string[], activeFieldId: string, nextFieldNumber: number }}
 */
function ensureNodeFieldsShape(nodeState) {
    const sourceFields = nodeState?.fields && typeof nodeState.fields === 'object'
        ? nodeState.fields
        : {};

    const fallbackField = buildDefaultFieldState({
        id: DEFAULT_FIELD_ID,
        name: 'Field 1',
        ownedCount: 1,
    });

    const fieldIds = Object.keys(sourceFields);
    const normalizedFields = {};

    if (fieldIds.length === 0) {
        // No fields at all — create default
        normalizedFields[DEFAULT_FIELD_ID] = { ...fallbackField, id: DEFAULT_FIELD_ID, name: 'Field 1' };
    } else {
        fieldIds.forEach((fieldId) => {
            const fb = fieldId === DEFAULT_FIELD_ID ? fallbackField : buildDefaultFieldState({ id: fieldId, name: `Field ${fieldId}` });
            const normalized = normalizeField(sourceFields[fieldId], fb);
            normalizedFields[fieldId] = { ...normalized, id: fieldId };
        });
    }

    // Guarantee field-1 always exists
    if (!normalizedFields[DEFAULT_FIELD_ID]) {
        normalizedFields[DEFAULT_FIELD_ID] = { ...fallbackField, id: DEFAULT_FIELD_ID, name: 'Field 1' };
    }

    const ownedFieldIds = Array.isArray(nodeState?.ownedFieldIds) && nodeState.ownedFieldIds.length > 0
        ? nodeState.ownedFieldIds.filter((id) => normalizedFields[id])
        : [DEFAULT_FIELD_ID];

    if (ownedFieldIds.length === 0) {
        ownedFieldIds.push(DEFAULT_FIELD_ID);
    }

    const activeFieldId = (typeof nodeState?.activeFieldId === 'string' && normalizedFields[nodeState.activeFieldId])
        ? nodeState.activeFieldId
        : ownedFieldIds[0];

    const nextFieldNumber = Math.max(
        ownedFieldIds.length + 1,
        typeof nodeState?.nextFieldNumber === 'number' ? nodeState.nextFieldNumber : 2,
    );

    return { fields: normalizedFields, ownedFieldIds, activeFieldId, nextFieldNumber };
}

/**
 * Reconciles plot timers within a node's fields.
 * Clears expired disabledUntil values; stamps lastUpdatedAt.
 * Mutates the fields object in-place.
 *
 * @param {Object.<string, import('./schemas/v2StateShape.js').FieldState>} fields
 */
function reconcileNodeFieldTimers(fields) {
    const now = Date.now();
    Object.values(fields).forEach((field) => {
        if (!field || !Array.isArray(field.plotStates)) {
            return;
        }
        field.plotStates = field.plotStates.map((plot) => {
            const normalized = normalizePlotState(plot);
            if (normalized.disabledUntil > 0 && normalized.disabledUntil <= now) {
                normalized.disabledUntil = 0;
            }
            normalized.lastUpdatedAt = now;
            return normalized;
        });
    });
}

/**
 * Builds a serializable snapshot of a node's fields (deep-normalizes all plots).
 *
 * @param {Object.<string, import('./schemas/v2StateShape.js').FieldState>} fields
 * @returns {Object.<string, import('./schemas/v2StateShape.js').FieldState>}
 */
function buildFieldsSnapshot(fields) {
    const snapshot = {};
    Object.entries(fields).forEach(([fieldId, field]) => {
        snapshot[fieldId] = {
            id: field.id,
            name: field.name,
            plots: field.plots,
            plotStates: Array.isArray(field.plotStates)
                ? field.plotStates.map((p) => normalizePlotState(p))
                : [],
        };
    });
    return snapshot;
}

// ─────────────────────────────────────────────────────────────────────────────
// Private: node state normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes a raw node object by merging against defaults and running
 * field/plot normalization. Returns a fully-shaped NodeState.
 *
 * @param {unknown} raw
 * @param {string} nodeId
 * @returns {import('./schemas/v2StateShape.js').NodeState}
 */
function normalizeNodeState(raw, nodeId) {
    const defaults = buildDefaultFarmNodeState({ id: nodeId });

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        const fieldsShape = ensureNodeFieldsShape(defaults);
        reconcileNodeFieldTimers(fieldsShape.fields);
        return { ...defaults, ...fieldsShape };
    }

    // Merge scalar fields from raw onto defaults
    const merged = { ...defaults };
    const numericKeys = [
        'coins', 'water',
        'plotDisableCoefficient', 'nextFieldNumber',
        'totalCoinsSpent', 'totalCoinsEarned', 'cropsSold',
        'seedsBought',
        'waterRefillsPurchased', 'totalClicksClicked', 'totalPlayTimeMs',
        'waterCapacity', 'totalCoinsFromQuests', 'timedQuestsBeatenOnTime',
    ];
    const boolKeys = [
        'fallowFatigueTutorialShown', 'waterAutoBuyerUnlocked',
    ];
    const stringKeys = ['selectedTool', 'selectedSeedType', 'label'];

    numericKeys.forEach((k) => {
        const v = Number(raw[k]);
        if (Number.isFinite(v)) {
            merged[k] = v;
        }
    });
    boolKeys.forEach((k) => {
        if (typeof raw[k] === 'boolean') {
            merged[k] = raw[k];
        }
    });
    stringKeys.forEach((k) => {
        if (typeof raw[k] === 'string' && raw[k].length > 0) {
            merged[k] = raw[k];
        }
    });

    // Normalize gameStartedAt
    const parsedStartedAt = Number(raw.gameStartedAt);
    if (Number.isFinite(parsedStartedAt) && parsedStartedAt > 0) {
        merged.gameStartedAt = parsedStartedAt;
    }

    // Normalize quest/achievement arrays
    merged.questsUnlocked = normalizeStringArray(raw.questsUnlocked);
    merged.questsActive = normalizeStringArray(raw.questsActive);
    merged.questsCompleted = normalizeStringArray(raw.questsCompleted);
    merged.questProgress = normalizeQuestProgress(raw.questProgress);
    merged.achievementsUnlocked = normalizeStringArray(raw.achievementsUnlocked);

    // Preserve plotSelectionMode / pendingPlotPurchase
    merged.plotSelectionMode = raw.plotSelectionMode ?? null;
    merged.pendingPlotPurchase = raw.pendingPlotPurchase != null
        ? Number(raw.pendingPlotPurchase) || null
        : null;

    // Attach raw fields for ensureNodeFieldsShape
    merged.fields = raw.fields ?? {};
    merged.ownedFieldIds = raw.ownedFieldIds ?? [];
    merged.activeFieldId = raw.activeFieldId ?? DEFAULT_FIELD_ID;

    const normalizedCropCollections = normalizeNodeCropCollections(raw, defaults);
    merged.inventory = normalizedCropCollections.inventory;
    merged.progressByCrop = normalizedCropCollections.progressByCrop;
    merged.unlocks = normalizedCropCollections.unlocks;
    merged.cropSchemaVersion = NODE_CROP_SCHEMA_VERSION;

    const fieldsShape = ensureNodeFieldsShape(merged);
    reconcileNodeFieldTimers(fieldsShape.fields);

    const nodeType = typeof raw?.type === 'string' && raw.type.length > 0
        ? raw.type
        : defaults.type;

    return {
        ...merged,
        id: nodeId,
        type: nodeType,
        fields: fieldsShape.fields,
        ownedFieldIds: fieldsShape.ownedFieldIds,
        activeFieldId: fieldsShape.activeFieldId,
        nextFieldNumber: fieldsShape.nextFieldNumber,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Private: world state normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes a raw world state object. Preserves valid fields; fills gaps
 * with defaults.
 *
 * @param {unknown} raw
 * @returns {import('./schemas/v2StateShape.js').WorldState}
 */
function normalizeWorldState(raw) {
    const defaults = buildDefaultWorldState();

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return defaults;
    }

    const activeNodeId = typeof raw.activeNodeId === 'string' && raw.activeNodeId.length > 0
        ? raw.activeNodeId
        : defaults.activeNodeId;

    const ownedNodeIds = Array.isArray(raw.ownedNodeIds) && raw.ownedNodeIds.length > 0
        ? raw.ownedNodeIds.filter((id) => typeof id === 'string' && id.length > 0)
        : defaults.ownedNodeIds;

    const netSpaceUnlocked = typeof raw.netSpaceUnlocked === 'boolean'
        ? raw.netSpaceUnlocked
        : false;

    const lastActiveZoom = [0, 1, 2].includes(raw.lastActiveZoom) ? raw.lastActiveZoom : 0;

    const completedMilestones = Array.isArray(raw.completedMilestones)
        ? raw.completedMilestones.filter((m) => typeof m === 'string')
        : [];

    const rawTutorialFlags = raw.tutorialFlags;
    const tutorialFlags = (rawTutorialFlags && typeof rawTutorialFlags === 'object' && !Array.isArray(rawTutorialFlags))
        ? {
            upgradesIconHintShown: Boolean(rawTutorialFlags.upgradesIconHintShown),
            questsIconHintShown: Boolean(rawTutorialFlags.questsIconHintShown),
            netSpaceTutorialShown: Boolean(rawTutorialFlags.netSpaceTutorialShown),
            additionalAutofarmersUnlocked: Boolean(rawTutorialFlags.additionalAutofarmersUnlocked),
        }
        : { ...defaults.tutorialFlags };

    const worldAchievementsUnlocked = Array.isArray(raw.worldAchievementsUnlocked)
        ? raw.worldAchievementsUnlocked.filter((a) => typeof a === 'string')
        : [];

    // Normalize worldStats
    const rawStats = raw.worldStats;
    const worldStats = (rawStats && typeof rawStats === 'object' && !Array.isArray(rawStats))
        ? {
            totalCoinsAcrossAllNodes: Math.max(0, Number(rawStats.totalCoinsAcrossAllNodes) || 0),
            totalCropsSoldAcrossAllNodes: Math.max(0, Number(rawStats.totalCropsSoldAcrossAllNodes) || 0),
            timeToGridMs: rawStats.timeToGridMs != null ? Number(rawStats.timeToGridMs) || null : null,
            netSpaceFirstAccessAt: rawStats.netSpaceFirstAccessAt != null ? Number(rawStats.netSpaceFirstAccessAt) || null : null,
        }
        : { ...defaults.worldStats };

    const rawTransport = raw.transport;
    const transport = (rawTransport && typeof rawTransport === 'object' && !Array.isArray(rawTransport))
        ? {
            routes: (rawTransport.routes && typeof rawTransport.routes === 'object' && !Array.isArray(rawTransport.routes))
                ? { ...rawTransport.routes }
                : {},
            transferQueue: Array.isArray(rawTransport.transferQueue)
                ? rawTransport.transferQueue
                    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
                    .map((entry) => ({ ...entry }))
                : [],
            completedTransfers: Math.max(0, Number(rawTransport.completedTransfers) || 0),
        }
        : {
            routes: { ...(defaults.transport?.routes || {}) },
            transferQueue: Array.isArray(defaults.transport?.transferQueue)
                ? defaults.transport.transferQueue.map((entry) => ({ ...entry }))
                : [],
            completedTransfers: Math.max(0, Number(defaults.transport?.completedTransfers) || 0),
        };

    // Normalize worldGraph — keep raw if it looks valid, else use default
    let worldGraph = defaults.worldGraph;
    const rawGraph = raw.worldGraph;
    if (rawGraph && typeof rawGraph === 'object' && !Array.isArray(rawGraph)
        && typeof rawGraph.nodes === 'object' && rawGraph.nodes !== null
        && Array.isArray(rawGraph.edges)
        && Array.isArray(rawGraph.lockedSlots)) {
        worldGraph = rawGraph;
    }

    return {
        activeNodeId,
        ownedNodeIds,
        netSpaceUnlocked,
        worldGraph,
        worldStats,
        transport,
        worldAchievementsUnlocked,
        tutorialFlags,
        completedMilestones,
        lastActiveZoom,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Private: snapshot builder for persistence
// ─────────────────────────────────────────────────────────────────────────────

function buildNodesSnapshot() {
    const snapshot = {};
    Object.entries(_nodes).forEach(([nodeId, node]) => {
        snapshot[nodeId] = buildNodeSnapshot(node);
    });
    return snapshot;
}

function deepFreezeObjectGraph(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) {
        return value;
    }

    seen.add(value);
    Object.getOwnPropertyNames(value).forEach((key) => {
        deepFreezeObjectGraph(value[key], seen);
    });
    return Object.freeze(value);
}

function validateCommittedStateOrThrow(context = 'unknown') {
    if (!_world || typeof _world !== 'object') {
        throw new Error(`[worldState] ${context}: world state is missing.`);
    }

    if (!_world.activeNodeId || !_nodes[_world.activeNodeId]) {
        throw new Error(`[worldState] ${context}: activeNodeId does not resolve to a node.`);
    }

    Object.entries(_nodes).forEach(([nodeId, nodeState]) => {
        if (!nodeState || typeof nodeState !== 'object') {
            throw new Error(`[worldState] ${context}: node ${nodeId} is missing.`);
        }

        if (!nodeState.fields || typeof nodeState.fields !== 'object') {
            throw new Error(`[worldState] ${context}: node ${nodeId} fields map is invalid.`);
        }

        if (!nodeState.activeFieldId || !nodeState.fields[nodeState.activeFieldId]) {
            throw new Error(`[worldState] ${context}: node ${nodeId} activeFieldId is invalid.`);
        }

        Object.entries(nodeState.fields).forEach(([fieldId, fieldState]) => {
            if (!fieldState || !Array.isArray(fieldState.plotStates) || fieldState.plotStates.length !== FIELD_GRID_CAPACITY) {
                throw new Error(`[worldState] ${context}: node ${nodeId} field ${fieldId} plotStates shape is invalid.`);
            }
        });

        if (!Array.isArray(nodeState.questsUnlocked)
            || !Array.isArray(nodeState.questsActive)
            || !Array.isArray(nodeState.questsCompleted)) {
            throw new Error(`[worldState] ${context}: node ${nodeId} quest arrays are invalid.`);
        }

        if (!nodeState.questProgress || typeof nodeState.questProgress !== 'object' || Array.isArray(nodeState.questProgress)) {
            throw new Error(`[worldState] ${context}: node ${nodeId} questProgress is invalid.`);
        }
    });
}

function finalizeCommittedState(context = 'unknown') {
    if (!_worldStateDevSafetyEnabled) {
        return;
    }

    validateCommittedStateOrThrow(context);
    deepFreezeObjectGraph(_world);
    deepFreezeObjectGraph(_nodes);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — initialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bootstraps world state from a loaded save snapshot, or from defaults if
 * null is passed. Called once from main.js on boot.
 *
 * @param {import('./schemas/v2StateShape.js').WorldSave|null} snapshot
 */
export function initializeWorldState(snapshot) {
    _worldStateDevSafetyEnabled = shouldEnableWorldStateDevSafety();

    if (!snapshot || typeof snapshot !== 'object' || snapshot.version !== SAVE_VERSION) {
        const fresh = buildDefaultWorldSave();
        _world = fresh.world;
        _nodes = fresh.nodes;
        _sessionStartedAt = Date.now();
        finalizeCommittedState('initializeWorldState:fresh');
        return;
    }

    _world = normalizeWorldState(snapshot.world);

    const rawNodes = (snapshot.nodes && typeof snapshot.nodes === 'object') ? snapshot.nodes : {};

    // Ensure at least the primary farm node exists
    const nodeIds = Object.keys(rawNodes).length > 0
        ? Object.keys(rawNodes)
        : [DEFAULT_FARM_NODE_ID];

    _nodes = {};
    nodeIds.forEach((nodeId) => {
        _nodes[nodeId] = normalizeNodeState(rawNodes[nodeId], nodeId);
    });

    if (!_nodes[DEFAULT_FARM_NODE_ID]) {
        _nodes[DEFAULT_FARM_NODE_ID] = normalizeNodeState(null, DEFAULT_FARM_NODE_ID);
    }

    // Validate activeNodeId against actual nodes
    if (!_nodes[_world.activeNodeId]) {
        _world.activeNodeId = DEFAULT_FARM_NODE_ID;
    }

    _sessionStartedAt = Date.now();
    finalizeCommittedState('initializeWorldState:snapshot');
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a shallow copy of the world-level state.
 * @returns {import('./schemas/v2StateShape.js').WorldState}
 */
export function getWorldState() {
    return { ..._world };
}

/**
 * Returns a shallow copy of the node state for the given id, or null.
 * @param {string} nodeId
 * @returns {import('./schemas/v2StateShape.js').NodeState|null}
 */
export function getNodeState(nodeId) {
    return _nodes[nodeId] ? { ..._nodes[nodeId] } : null;
}

/**
 * Returns the state for the currently active node.
 * @returns {import('./schemas/v2StateShape.js').NodeState}
 */
export function getActiveNodeState() {
    return { ..._nodes[_world.activeNodeId] };
}

/**
 * Returns shallow copies of all node states keyed by id.
 * @returns {Object.<string, import('./schemas/v2StateShape.js').NodeState>}
 */
export function getAllNodeStates() {
    const result = {};
    Object.entries(_nodes).forEach(([id, node]) => {
        result[id] = { ...node };
    });
    return result;
}

/**
 * Returns the full serializable save snapshot (world + all nodes).
 * @returns {import('./schemas/v2StateShape.js').WorldSave}
 */
export function getWorldSaveSnapshot() {
    return {
        version: SAVE_VERSION,
        timestamp: Date.now(),
        world: getWorldState(),
        nodes: buildNodesSnapshot(),
    };
}

export function setWorldStateLoggingEnabled(enabled) {
    _worldStateLoggingEnabled = Boolean(enabled);
}

export function isWorldStateLoggingEnabled() {
    return _worldStateLoggingEnabled;
}

export function isWorldStateDevSafetyEnabled() {
    return _worldStateDevSafetyEnabled;
}

export function setWorldStateDevSafetyEnabled(enabled) {
    _worldStateDevSafetyEnabled = Boolean(enabled);
    finalizeCommittedState('setWorldStateDevSafetyEnabled');
}

function maybeLogWorldState(reason) {
    if (!_worldStateLoggingEnabled) {
        return;
    }

    console.log('[worldState]', reason, getWorldSaveSnapshot());
}

function isObjectLike(value) {
    return value !== null && typeof value === 'object';
}

function warnSharedMutableUpdate(scope, key) {
    console.warn(
        `[worldState] ${scope} received a shared mutable reference for "${key}". `
        + 'Pass a cloned value to avoid accidental mutation leaks.',
    );
}

function warnOnSharedReferences(scope, target, updates) {
    if (!isObjectLike(target) || !isObjectLike(updates)) {
        return;
    }

    Object.keys(updates).forEach((key) => {
        const incoming = updates[key];
        if (!isObjectLike(incoming)) {
            return;
        }

        if (incoming === target[key]) {
            warnSharedMutableUpdate(scope, key);
        }
    });
}

function buildActionEnvelope(actionLike, options = {}) {
    if (!actionLike || typeof actionLike !== 'object') {
        return null;
    }

    const type = typeof actionLike.type === 'string' && actionLike.type.length > 0
        ? actionLike.type
        : null;
    if (!type) {
        return null;
    }

    _actionSequence += 1;

    return {
        type,
        payload: actionLike.payload,
        meta: {
            timestamp: Number(actionLike?.meta?.timestamp) || Date.now(),
            source: typeof actionLike?.meta?.source === 'string' && actionLike.meta.source.length > 0
                ? actionLike.meta.source
                : (typeof options.source === 'string' && options.source.length > 0 ? options.source : 'unknown'),
            sequence: _actionSequence,
        },
    };
}

function applyWorldPatch(updates, scopeLabel) {
    if (!updates || typeof updates !== 'object') {
        return false;
    }

    warnOnSharedReferences(scopeLabel, _world, updates);
    _world = reduceWorldPatch(_world, updates);
    return true;
}

function applyNodePatch(nodeId, updates, scopeLabel) {
    if (!updates || typeof updates !== 'object') {
        return false;
    }
    if (!_nodes[nodeId]) {
        return false;
    }

    warnOnSharedReferences(scopeLabel, _nodes[nodeId], updates);
    _nodes[nodeId] = reduceNodePatch(
        _nodes[nodeId],
        adaptNodeStateLegacyPatch(_nodes[nodeId], updates),
    );

    const fieldsShape = ensureNodeFieldsShape(_nodes[nodeId]);
    reconcileNodeFieldTimers(fieldsShape.fields);

    _nodes[nodeId].fields = fieldsShape.fields;
    _nodes[nodeId].ownedFieldIds = fieldsShape.ownedFieldIds;
    _nodes[nodeId].activeFieldId = fieldsShape.activeFieldId;
    _nodes[nodeId].nextFieldNumber = fieldsShape.nextFieldNumber;
    return true;
}

function applyActionEnvelope(actionEnvelope) {
    if (!actionEnvelope) {
        return false;
    }

    const { type, payload } = actionEnvelope;

    switch (type) {
        case 'world.patch':
            return applyWorldPatch(payload?.updates, 'dispatch(world.patch)');
        case 'node.patch':
            return applyNodePatch(payload?.nodeId, payload?.updates, `dispatch(node.patch:${payload?.nodeId || 'unknown'})`);
        case 'node.active.patch':
            return applyNodePatch(_world.activeNodeId, payload?.updates, `dispatch(node.active.patch:${_world.activeNodeId})`);
        case 'node.field.patch': {
            const nodeId = payload?.nodeId;
            if (!_nodes[nodeId] || !payload?.updates || typeof payload.updates !== 'object') {
                return false;
            }

            _nodes[nodeId] = reduceNodeFieldPatch(
                _nodes[nodeId],
                adaptNodeStateLegacyPatch(_nodes[nodeId], payload.updates),
            );
            const fieldsShape = ensureNodeFieldsShape(_nodes[nodeId]);
            reconcileNodeFieldTimers(fieldsShape.fields);
            _nodes[nodeId].fields = fieldsShape.fields;
            _nodes[nodeId].ownedFieldIds = fieldsShape.ownedFieldIds;
            _nodes[nodeId].activeFieldId = fieldsShape.activeFieldId;
            _nodes[nodeId].nextFieldNumber = fieldsShape.nextFieldNumber;
            return true;
        }
        case 'node.active.field.patch': {
            const nodeId = _world.activeNodeId;
            if (!_nodes[nodeId] || !payload?.updates || typeof payload.updates !== 'object') {
                return false;
            }

            _nodes[nodeId] = reduceNodeFieldPatch(
                _nodes[nodeId],
                adaptNodeStateLegacyPatch(_nodes[nodeId], payload.updates),
            );
            const fieldsShape = ensureNodeFieldsShape(_nodes[nodeId]);
            reconcileNodeFieldTimers(fieldsShape.fields);
            _nodes[nodeId].fields = fieldsShape.fields;
            _nodes[nodeId].ownedFieldIds = fieldsShape.ownedFieldIds;
            _nodes[nodeId].activeFieldId = fieldsShape.activeFieldId;
            _nodes[nodeId].nextFieldNumber = fieldsShape.nextFieldNumber;
            return true;
        }
        case 'node.quest.patch': {
            const nodeId = payload?.nodeId;
            if (!_nodes[nodeId] || !payload?.updates || typeof payload.updates !== 'object') {
                return false;
            }

            _nodes[nodeId] = reduceNodeQuestPatch(
                _nodes[nodeId],
                adaptNodeStateLegacyPatch(_nodes[nodeId], payload.updates),
            );
            return true;
        }
        case 'node.active.quest.patch': {
            const nodeId = _world.activeNodeId;
            if (!_nodes[nodeId] || !payload?.updates || typeof payload.updates !== 'object') {
                return false;
            }

            _nodes[nodeId] = reduceNodeQuestPatch(
                _nodes[nodeId],
                adaptNodeStateLegacyPatch(_nodes[nodeId], payload.updates),
            );
            return true;
        }
        case 'node.economy.patch': {
            const nodeId = payload?.nodeId;
            if (!_nodes[nodeId] || !payload?.updates || typeof payload.updates !== 'object') {
                return false;
            }

            _nodes[nodeId] = reduceNodeEconomyPatch(
                _nodes[nodeId],
                adaptNodeStateLegacyPatch(_nodes[nodeId], payload.updates),
            );
            return true;
        }
        case 'node.active.economy.patch': {
            const nodeId = _world.activeNodeId;
            if (!_nodes[nodeId] || !payload?.updates || typeof payload.updates !== 'object') {
                return false;
            }

            _nodes[nodeId] = reduceNodeEconomyPatch(
                _nodes[nodeId],
                adaptNodeStateLegacyPatch(_nodes[nodeId], payload.updates),
            );
            return true;
        }
        case 'node.active.incrementTotalClicks': {
            const nodeId = _world.activeNodeId;
            if (!_nodes[nodeId]) {
                return false;
            }

            _nodes[nodeId] = reduceNodeEconomyPatch(_nodes[nodeId], {
                totalClicksClicked: (Number(_nodes[nodeId].totalClicksClicked) || 0) + 1,
            });
            return true;
        }
        case 'node.active.flushPlayTime': {
            const nodeId = _world.activeNodeId;
            if (!_nodes[nodeId]) {
                return false;
            }

            _nodes[nodeId] = reduceNodeEconomyPatch(_nodes[nodeId], {
                totalPlayTimeMs: getPlayTimeMs(),
            });
            _sessionStartedAt = Date.now();
            return true;
        }
        default:
            return false;
    }
}

function getPersistDirtySlicesForAction(actionEnvelope) {
    const activeNodeId = _world.activeNodeId;

    switch (actionEnvelope?.type) {
        case 'world.patch':
            return { world: true, nodeIds: [] };
        case 'node.patch':
            return {
                world: false,
                nodeIds: typeof actionEnvelope?.payload?.nodeId === 'string'
                    ? [actionEnvelope.payload.nodeId]
                    : [],
            };
        case 'node.active.patch':
        case 'node.active.field.patch':
        case 'node.active.quest.patch':
        case 'node.active.economy.patch':
        case 'node.active.incrementTotalClicks':
        case 'node.active.flushPlayTime':
            return { world: false, nodeIds: [activeNodeId] };
        case 'node.field.patch':
        case 'node.quest.patch':
        case 'node.economy.patch':
            return {
                world: false,
                nodeIds: typeof actionEnvelope?.payload?.nodeId === 'string'
                    ? [actionEnvelope.payload.nodeId]
                    : [],
            };
        default:
            return { world: true, nodeIds: [activeNodeId] };
    }
}

export function dispatchWorldAction(actionLike, options = {}) {
    const actionEnvelope = buildActionEnvelope(actionLike, options);
    if (!actionEnvelope) {
        return null;
    }

    const previousWorld = _world;
    const previousNodes = _nodes;
    let didChange = false;

    try {
        didChange = applyActionEnvelope(actionEnvelope);
        if (!didChange) {
            return null;
        }

        finalizeCommittedState(`dispatch:${actionEnvelope.type}`);
    } catch (error) {
        _world = previousWorld;
        _nodes = previousNodes;
        throw error;
    }

    if (!didChange) {
        return null;
    }

    scheduleStatePersist(getPersistDirtySlicesForAction(actionEnvelope));
    maybeLogWorldState(`dispatch:${actionEnvelope.type}`);
    return actionEnvelope;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — writes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shorthand: updates the currently active node.
 * @param {Partial<import('./schemas/v2StateShape.js').NodeState>} updates
 */
export function updateActiveNodeState(updates) {
    dispatchWorldAction({
        type: 'node.active.patch',
        payload: { updates },
    }, {
        source: 'updateActiveNodeState',
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — play time tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns total play time in ms for the active node, including current session.
 * @returns {number}
 */
export function getPlayTimeMs() {
    const stored = Math.max(0, Number(_nodes[_world.activeNodeId]?.totalPlayTimeMs) || 0);
    return stored + Math.max(0, Date.now() - _sessionStartedAt);
}

/**
 * Flushes accumulated session play time into the active node's totalPlayTimeMs
 * and schedules a save.
 */
export function flushPlayTime() {
    dispatchWorldAction({
        type: 'node.active.flushPlayTime',
        payload: {},
    }, {
        source: 'flushPlayTime',
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — convenience helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Increments the total click counter on the active node and schedules a save.
 */
export function incrementTotalClicks() {
    dispatchWorldAction({
        type: 'node.active.incrementTotalClicks',
        payload: {},
    }, {
        source: 'incrementTotalClicks',
    });
}

/**
 * Re-normalizes field shapes and reconciles plot timers for all nodes.
 * Equivalent to v1's reconcileAllFieldsProgress().
 */
export function reconcileAllFieldsProgress() {
    Object.keys(_nodes).forEach((nodeId) => {
        const nextNodeState = { ..._nodes[nodeId] };
        const fieldsShape = ensureNodeFieldsShape(nextNodeState);
        reconcileNodeFieldTimers(fieldsShape.fields);
        _nodes[nodeId] = {
            ...nextNodeState,
            fields: fieldsShape.fields,
            ownedFieldIds: fieldsShape.ownedFieldIds,
            activeFieldId: fieldsShape.activeFieldId,
            nextFieldNumber: fieldsShape.nextFieldNumber,
        };
    });

    finalizeCommittedState('reconcileAllFieldsProgress');
}

/**
 * Logs the full world save snapshot to the console (dev utility).
 */
export function logWorldState() {
    maybeLogWorldState('manual');
}
