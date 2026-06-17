// persistence.js
// v2 save layer. Reads and writes WorldSave objects to localStorage.
// Does NOT import from worldState.js — worldState.js imports from here.

import { SAVE_VERSION } from './schemas/v2StateShape.js';
import { createLocalStoragePersistenceAdapter } from './infra/persistence/localStoragePersistenceAdapter.js';
import { createIndexedDbPersistenceAdapter } from './infra/persistence/indexedDbPersistenceAdapter.js';

// v2 uses a distinct key so any stale v1 data is silently ignored.
const SAVE_KEY = 'asciiFarmerSave_v2';
const INDEXED_DB_NAME = 'ascii-farmer-persistence-v2';
const INDEXED_DB_STORE_NAME = 'worldSaves';
const INDEXED_DB_ACTIVE_KEY = 'active';
const INDEXED_DB_VERSION = 1;
const DEFAULT_ADAPTER_NAME = 'localStorage-fallback';
const INDEXED_ADAPTER_NAME = 'indexeddb-primary';

const fallbackAdapter = createLocalStoragePersistenceAdapter({
    saveKey: SAVE_KEY,
    saveVersion: SAVE_VERSION,
});

const indexedDbAdapter = createIndexedDbPersistenceAdapter({
    saveVersion: SAVE_VERSION,
    dbName: INDEXED_DB_NAME,
    dbVersion: INDEXED_DB_VERSION,
    storeName: INDEXED_DB_STORE_NAME,
    activeKey: INDEXED_DB_ACTIVE_KEY,
});

let activeAdapter = fallbackAdapter;
let activeAdapterName = DEFAULT_ADAPTER_NAME;
let lastPersistenceSafetyStatus = {
    activeAdapterName,
    initializedIndexedDb: false,
    migrationAction: 'not-started',
    rollbackApplied: false,
};

function cloneSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        return null;
    }

    try {
        return JSON.parse(JSON.stringify(snapshot));
    } catch {
        return null;
    }
}

function getSnapshotTimestamp(snapshot) {
    const timestamp = Number(snapshot?.timestamp);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function setPersistenceSafetyStatus(partial) {
    lastPersistenceSafetyStatus = {
        ...lastPersistenceSafetyStatus,
        ...partial,
        activeAdapterName,
    };
}

function hasPersistenceAdapterShape(candidate) {
    if (!candidate || typeof candidate !== 'object') {
        return false;
    }

    return typeof candidate.load === 'function'
        && typeof candidate.saveDelta === 'function'
        && typeof candidate.saveCheckpoint === 'function'
        && typeof candidate.export === 'function'
        && typeof candidate.import === 'function';
}

function getStatsFromAdapter(adapter) {
    if (!adapter || typeof adapter.getStats !== 'function') {
        return {
            writeAttempts: 0,
            writeSuccesses: 0,
            writeFailures: 0,
            lastWriteAt: 0,
            lastFailureReason: null,
        };
    }

    return adapter.getStats();
}

export function setPersistenceAdapter(adapter, options = {}) {
    if (!hasPersistenceAdapterShape(adapter)) {
        console.warn('[persistence] Ignoring adapter without required interface methods.');
        return false;
    }

    activeAdapter = adapter;
    activeAdapterName = typeof options.name === 'string' && options.name.trim().length > 0
        ? options.name.trim()
        : 'custom';
    return true;
}

export async function initializePersistence() {
    const initialized = await indexedDbAdapter.initialize();
    if (!initialized || !indexedDbAdapter.isAvailable()) {
        setPersistenceSafetyStatus({
            initializedIndexedDb: false,
            migrationAction: 'indexeddb-unavailable',
            rollbackApplied: false,
        });
        return activeAdapterName;
    }

    const indexedSnapshot = indexedDbAdapter.load();
    const fallbackSnapshot = fallbackAdapter.load();
    const indexedTimestamp = getSnapshotTimestamp(indexedSnapshot);
    const fallbackTimestamp = getSnapshotTimestamp(fallbackSnapshot);
    const fallbackIsNewer = fallbackTimestamp > indexedTimestamp;
    const needsFallbackMigration = Boolean(
        fallbackSnapshot
        && (!indexedSnapshot || fallbackIsNewer),
    );

    let rollbackApplied = false;

    if (needsFallbackMigration) {
        const rollbackSnapshot = cloneSnapshot(indexedSnapshot);
        const migrated = typeof indexedDbAdapter.saveCheckpointBlocking === 'function'
            ? await indexedDbAdapter.saveCheckpointBlocking(fallbackSnapshot)
            : indexedDbAdapter.saveCheckpoint(fallbackSnapshot);

        if (!migrated) {
            if (rollbackSnapshot) {
                if (typeof indexedDbAdapter.saveCheckpointBlocking === 'function') {
                    rollbackApplied = await indexedDbAdapter.saveCheckpointBlocking(rollbackSnapshot);
                } else {
                    rollbackApplied = indexedDbAdapter.saveCheckpoint(rollbackSnapshot);
                }
            } else if (typeof indexedDbAdapter.clearBlocking === 'function') {
                rollbackApplied = await indexedDbAdapter.clearBlocking();
            }

            activeAdapter = fallbackAdapter;
            activeAdapterName = DEFAULT_ADAPTER_NAME;
            setPersistenceSafetyStatus({
                initializedIndexedDb: true,
                migrationAction: 'migration-failed-using-fallback',
                rollbackApplied,
            });
            return activeAdapterName;
        }

        setPersistenceSafetyStatus({
            initializedIndexedDb: true,
            migrationAction: indexedSnapshot ? 'migrated-fallback-over-indexed' : 'migrated-fallback-to-indexed',
            rollbackApplied: false,
        });
    } else {
        setPersistenceSafetyStatus({
            initializedIndexedDb: true,
            migrationAction: indexedSnapshot ? 'indexed-current' : 'no-snapshot-available',
            rollbackApplied: false,
        });
    }

    activeAdapter = indexedDbAdapter;
    activeAdapterName = INDEXED_ADAPTER_NAME;
    setPersistenceSafetyStatus({
        initializedIndexedDb: true,
    });
    return activeAdapterName;
}

export function resetPersistenceAdapter() {
    activeAdapter = fallbackAdapter;
    activeAdapterName = DEFAULT_ADAPTER_NAME;
    setPersistenceSafetyStatus({
        activeAdapterName,
    });
}

export function getPersistenceSafetyStatus() {
    return { ...lastPersistenceSafetyStatus };
}

export function createPersistenceBackup() {
    return {
        activeAdapterName,
        safetyStatus: getPersistenceSafetyStatus(),
        activeSnapshot: cloneSnapshot(activeAdapter.load()),
        fallbackSnapshot: cloneSnapshot(fallbackAdapter.load()),
    };
}

export function restorePersistenceBackup(backup) {
    if (!backup || typeof backup !== 'object') {
        return false;
    }

    if (typeof activeAdapter.clear === 'function') {
        activeAdapter.clear();
    }
    if (activeAdapter !== fallbackAdapter && typeof fallbackAdapter.clear === 'function') {
        fallbackAdapter.clear();
    }

    const nextFallbackSnapshot = backup.fallbackSnapshot ?? backup.activeSnapshot;
    if (nextFallbackSnapshot) {
        fallbackAdapter.saveCheckpoint(nextFallbackSnapshot);
    }

    if (activeAdapter !== fallbackAdapter) {
        const nextActiveSnapshot = backup.activeSnapshot ?? nextFallbackSnapshot;
        if (nextActiveSnapshot) {
            activeAdapter.saveCheckpoint(nextActiveSnapshot);
        }
    }

    return true;
}

export function getPersistenceAdapterName() {
    return activeAdapterName;
}

export function getPersistenceAdapterCapabilities() {
    return {
        canLoad: typeof activeAdapter.load === 'function',
        canSaveDelta: typeof activeAdapter.saveDelta === 'function',
        canSaveCheckpoint: typeof activeAdapter.saveCheckpoint === 'function',
        canExport: typeof activeAdapter.export === 'function',
        canImport: typeof activeAdapter.import === 'function',
    };
}

export function getPersistenceStats() {
    return { ...getStatsFromAdapter(activeAdapter) };
}

export function resetPersistenceStats() {
    if (typeof activeAdapter.resetStats === 'function') {
        activeAdapter.resetStats();
    }
}

/**
 * Loads the v2 WorldSave from localStorage.
 * Returns null if nothing is stored or the save is not a valid v2 envelope.
 *
 * @returns {import('./schemas/v2StateShape.js').WorldSave|null}
 */
export function loadSnapshot() {
    const activeSnapshot = activeAdapter.load();
    if (activeSnapshot) {
        return activeSnapshot;
    }

    if (activeAdapter !== fallbackAdapter) {
        return fallbackAdapter.load();
    }

    return null;
}

/**
 * Writes partial save updates into the stored envelope.
 * Supported payload keys:
 * - world: full world snapshot replacement
 * - nodes: full nodes map replacement
 * - nodePatches: keyed node replacements merged over current nodes map
 *
 * @param {{ world?: object, nodes?: object, nodePatches?: object }} partial
 */
export function savePartialSnapshot(partial) {
    activeAdapter.saveDelta(partial);

    if (activeAdapter !== fallbackAdapter) {
        fallbackAdapter.saveDelta(partial);
    }
}

/**
 * Writes a full save envelope snapshot in one call.
 * Intended for explicit checkpoints and adapter-level migrations.
 *
 * @param {import('./schemas/v2StateShape.js').WorldSave} snapshot
 * @returns {boolean}
 */
export function saveCheckpointSnapshot(snapshot) {
    const activeSaved = activeAdapter.saveCheckpoint(snapshot);
    if (activeAdapter !== fallbackAdapter) {
        fallbackAdapter.saveCheckpoint(snapshot);
    }

    return activeSaved;
}

/**
 * Removes the save from localStorage and clears the in-memory cache.
 */
export function clearSnapshot() {
    if (typeof activeAdapter.clear === 'function') {
        activeAdapter.clear();
    }

    if (activeAdapter !== fallbackAdapter && typeof fallbackAdapter.clear === 'function') {
        fallbackAdapter.clear();
    }
}

function getRawSnapshotValue() {
    if (typeof activeAdapter.getRaw === 'function') {
        return activeAdapter.getRaw();
    }

    return null;
}

/**
 * Encodes the current save as a base64 string for export.
 * Uses the active adapter first, then fallback adapter if needed.
 * @returns {string|null}
 */
export function exportSaveToString() {
    const activeEncoded = activeAdapter.export();
    if (activeEncoded) {
        return activeEncoded;
    }

    if (activeAdapter !== fallbackAdapter) {
        return fallbackAdapter.export();
    }

    return null;
}

/**
 * Decodes a base64 save string, validates it as a v2 save, and writes it
 * through the active adapter, mirroring to fallback when available.
 * Returns true on success.
 *
 * @param {string} encoded
 * @returns {boolean}
 */
export function importSaveFromString(encoded) {
    const activeImported = activeAdapter.import(encoded);
    if (activeImported) {
        const importedSnapshot = activeAdapter.load();
        if (importedSnapshot && activeAdapter !== fallbackAdapter) {
            fallbackAdapter.saveCheckpoint(importedSnapshot);
        }
        return true;
    }

    if (activeAdapter !== fallbackAdapter) {
        return fallbackAdapter.import(encoded);
    }

    return false;
}

/**
 * Dev utility: directly restores a raw localStorage string (as captured
 * by getRawSnapshotValue). Used by smokeTest.js for save/restore in tests.
 *
 * @param {string|null} rawValue
 */
export function restoreRawSnapshotValue(rawValue) {
    if (typeof activeAdapter.restoreRaw === 'function') {
        activeAdapter.restoreRaw(rawValue);
    }

    if (activeAdapter !== fallbackAdapter && typeof fallbackAdapter.restoreRaw === 'function') {
        fallbackAdapter.restoreRaw(rawValue);
    }
}

export {
    SAVE_KEY,
    SAVE_VERSION,
    INDEXED_DB_NAME,
    INDEXED_DB_STORE_NAME,
    INDEXED_DB_ACTIVE_KEY,
    INDEXED_DB_VERSION,
    getRawSnapshotValue,
};