function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canUseStorage(storage) {
    return Boolean(storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function');
}

function parseV2Save(raw, saveVersion) {
    if (!isObject(raw)) {
        return null;
    }

    if (raw.version !== saveVersion) {
        return null;
    }

    if (!isObject(raw.world) || !isObject(raw.nodes)) {
        return null;
    }

    return raw;
}

function createLocalStoragePersistenceAdapter(options = {}) {
    const {
        saveKey,
        saveVersion,
        storageProvider = () => ((typeof window !== 'undefined' && window.localStorage) ? window.localStorage : null),
    } = options;

    let cachedSnapshot = null;
    const persistenceStats = {
        writeAttempts: 0,
        writeSuccesses: 0,
        writeFailures: 0,
        lastWriteAt: 0,
        lastFailureReason: null,
    };

    function getStorage() {
        try {
            return storageProvider();
        } catch {
            return null;
        }
    }

    function recordWriteAttempt() {
        persistenceStats.writeAttempts += 1;
        persistenceStats.lastWriteAt = Date.now();
    }

    function recordWriteSuccess() {
        persistenceStats.writeSuccesses += 1;
        persistenceStats.lastFailureReason = null;
    }

    function recordWriteFailure(reason) {
        persistenceStats.writeFailures += 1;
        persistenceStats.lastFailureReason = String(reason || 'unknown_write_error');
    }

    function load() {
        if (cachedSnapshot) {
            return cachedSnapshot;
        }

        const storage = getStorage();
        if (!canUseStorage(storage)) {
            return null;
        }

        try {
            const raw = storage.getItem(saveKey);
            if (!raw) {
                return null;
            }

            const parsed = JSON.parse(raw);
            const save = parseV2Save(parsed, saveVersion);
            cachedSnapshot = save;
            return save;
        } catch (error) {
            console.warn('[persistence] Failed to load savegame; using defaults.', error);
            return null;
        }
    }

    function saveDelta(changes) {
        const storage = getStorage();
        if (!canUseStorage(storage) || !isObject(changes)) {
            return;
        }

        const current = cachedSnapshot ?? {
            version: saveVersion,
            timestamp: Date.now(),
            world: {},
            nodes: {},
        };

        const nodePatches = isObject(changes.nodePatches) ? changes.nodePatches : null;
        const baseNodes = isObject(changes.nodes) ? changes.nodes : current.nodes;

        const next = {
            version: saveVersion,
            timestamp: Date.now(),
            world: isObject(changes.world) ? changes.world : current.world,
            nodes: nodePatches
                ? {
                    ...(isObject(baseNodes) ? baseNodes : {}),
                    ...nodePatches,
                }
                : baseNodes,
        };

        recordWriteAttempt();
        try {
            storage.setItem(saveKey, JSON.stringify(next));
            cachedSnapshot = next;
            recordWriteSuccess();
        } catch (error) {
            recordWriteFailure(error?.name || error?.message || 'saveDelta_failed');
            console.warn('[persistence] Failed to write savegame.', error);
        }
    }

    function saveCheckpoint(snapshot) {
        const storage = getStorage();
        if (!canUseStorage(storage)) {
            return false;
        }

        const normalized = parseV2Save(snapshot, saveVersion);
        if (!normalized) {
            return false;
        }

        recordWriteAttempt();
        try {
            storage.setItem(saveKey, JSON.stringify(normalized));
            cachedSnapshot = normalized;
            recordWriteSuccess();
            return true;
        } catch (error) {
            recordWriteFailure(error?.name || error?.message || 'saveCheckpoint_failed');
            console.warn('[persistence] Failed to write checkpoint.', error);
            return false;
        }
    }

    function exportSave() {
        const raw = getRaw();
        if (!raw) {
            return null;
        }

        try {
            return btoa(raw);
        } catch {
            return null;
        }
    }

    function importSave(encoded) {
        const storage = getStorage();
        if (!canUseStorage(storage)) {
            return false;
        }

        if (typeof encoded !== 'string' || encoded.trim().length === 0) {
            return false;
        }

        try {
            const raw = atob(encoded.trim());
            const parsed = JSON.parse(raw);
            const save = parseV2Save(parsed, saveVersion);
            if (!save) {
                return false;
            }

            recordWriteAttempt();
            storage.setItem(saveKey, JSON.stringify(save));
            cachedSnapshot = save;
            recordWriteSuccess();
            return true;
        } catch {
            recordWriteFailure('importSave_failed');
            return false;
        }
    }

    function clear() {
        const storage = getStorage();
        if (!canUseStorage(storage)) {
            return;
        }

        storage.removeItem(saveKey);
        cachedSnapshot = null;
    }

    function getRaw() {
        const storage = getStorage();
        if (!canUseStorage(storage)) {
            return null;
        }

        return storage.getItem(saveKey);
    }

    function restoreRaw(rawValue) {
        const storage = getStorage();
        if (!canUseStorage(storage)) {
            return;
        }

        if (typeof rawValue === 'string') {
            recordWriteAttempt();
            storage.setItem(saveKey, rawValue);
            try {
                const parsed = JSON.parse(rawValue);
                cachedSnapshot = parseV2Save(parsed, saveVersion);
            } catch {
                cachedSnapshot = null;
            }
            recordWriteSuccess();
            return;
        }

        storage.removeItem(saveKey);
        cachedSnapshot = null;
    }

    function getStats() {
        return { ...persistenceStats };
    }

    function resetStats() {
        persistenceStats.writeAttempts = 0;
        persistenceStats.writeSuccesses = 0;
        persistenceStats.writeFailures = 0;
        persistenceStats.lastWriteAt = 0;
        persistenceStats.lastFailureReason = null;
    }

    return {
        load,
        saveDelta,
        saveCheckpoint,
        export: exportSave,
        import: importSave,
        clear,
        getRaw,
        restoreRaw,
        getStats,
        resetStats,
    };
}

export {
    createLocalStoragePersistenceAdapter,
};
