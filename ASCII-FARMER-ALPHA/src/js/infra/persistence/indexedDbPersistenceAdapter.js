function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function canUseIndexedDb() {
    return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function createIndexedDbPersistenceAdapter(options = {}) {
    const {
        saveVersion,
        dbName = 'ascii-farmer-persistence-v2',
        dbVersion = 1,
        storeName = 'worldSaves',
        activeKey = 'active',
    } = options;

    let dbPromise = null;
    let initialized = false;
    let available = false;
    let cachedSnapshot = null;
    let cachedRaw = null;

    const persistenceStats = {
        writeAttempts: 0,
        writeSuccesses: 0,
        writeFailures: 0,
        lastWriteAt: 0,
        lastFailureReason: null,
    };

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

    function openDb() {
        if (dbPromise) {
            return dbPromise;
        }

        dbPromise = new Promise((resolve, reject) => {
            const request = window.indexedDB.open(dbName, dbVersion);

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName);
                }
            };

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error || new Error('indexeddb_open_failed'));
            };
        });

        return dbPromise;
    }

    async function withStore(mode, work) {
        const db = await openDb();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);

            let workResult;
            try {
                workResult = work(store, tx);
            } catch (error) {
                reject(error);
                return;
            }

            tx.oncomplete = () => resolve(workResult);
            tx.onerror = () => reject(tx.error || new Error('indexeddb_tx_failed'));
            tx.onabort = () => reject(tx.error || new Error('indexeddb_tx_aborted'));
        });
    }

    async function readEnvelope() {
        if (!available) {
            return null;
        }

        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(activeKey);

            request.onsuccess = () => {
                resolve(parseV2Save(request.result, saveVersion));
            };

            request.onerror = () => {
                reject(request.error || new Error('indexeddb_read_failed'));
            };
        });
    }

    async function writeEnvelope(snapshot) {
        if (!available) {
            return false;
        }

        await withStore('readwrite', (store) => {
            store.put(snapshot, activeKey);
        });
        return true;
    }

    async function deleteEnvelope() {
        if (!available) {
            return;
        }

        await withStore('readwrite', (store) => {
            store.delete(activeKey);
        });
    }

    async function saveCheckpointBlocking(snapshot) {
        const normalized = parseV2Save(snapshot, saveVersion);
        if (!normalized || !available) {
            return false;
        }

        recordWriteAttempt();
        try {
            await writeEnvelope(normalized);
            cachedSnapshot = normalized;
            cachedRaw = JSON.stringify(normalized);
            recordWriteSuccess();
            return true;
        } catch (error) {
            recordWriteFailure(error?.name || error?.message || 'indexeddb_saveCheckpointBlocking_failed');
            console.warn('[persistence] IndexedDB blocking checkpoint write failed.', error);
            return false;
        }
    }

    async function clearBlocking() {
        if (!available) {
            cachedSnapshot = null;
            cachedRaw = null;
            return true;
        }

        try {
            await deleteEnvelope();
            cachedSnapshot = null;
            cachedRaw = null;
            return true;
        } catch (error) {
            console.warn('[persistence] IndexedDB blocking clear failed.', error);
            return false;
        }
    }

    function buildNextDeltaSnapshot(changes) {
        if (!isObject(changes)) {
            return null;
        }

        const current = cachedSnapshot ?? {
            version: saveVersion,
            timestamp: Date.now(),
            world: {},
            nodes: {},
        };

        const nodePatches = isObject(changes.nodePatches) ? changes.nodePatches : null;
        const baseNodes = isObject(changes.nodes) ? changes.nodes : current.nodes;

        return {
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
    }

    async function initialize() {
        if (initialized) {
            return available;
        }

        initialized = true;

        if (!canUseIndexedDb()) {
            available = false;
            return false;
        }

        try {
            await openDb();
            available = true;
            cachedSnapshot = await readEnvelope();
            cachedRaw = cachedSnapshot ? JSON.stringify(cachedSnapshot) : null;
            return true;
        } catch (error) {
            available = false;
            console.warn('[persistence] IndexedDB adapter init failed; fallback will remain active.', error);
            return false;
        }
    }

    function load() {
        return cachedSnapshot;
    }

    function saveDelta(changes) {
        const next = buildNextDeltaSnapshot(changes);
        if (!next) {
            return;
        }

        cachedSnapshot = next;
        cachedRaw = JSON.stringify(next);

        if (!available) {
            return;
        }

        recordWriteAttempt();
        recordWriteSuccess();
        void writeEnvelope(next)
            .then(() => {
                // Success already counted when write was accepted for async commit.
            })
            .catch((error) => {
                recordWriteFailure(error?.name || error?.message || 'indexeddb_saveDelta_failed');
                console.warn('[persistence] IndexedDB delta write failed.', error);
            });
    }

    function saveCheckpoint(snapshot) {
        const normalized = parseV2Save(snapshot, saveVersion);
        if (!normalized) {
            return false;
        }

        cachedSnapshot = normalized;
        cachedRaw = JSON.stringify(normalized);

        if (!available) {
            return true;
        }

        recordWriteAttempt();
        recordWriteSuccess();
        void writeEnvelope(normalized)
            .then(() => {
                // Success already counted when write was accepted for async commit.
            })
            .catch((error) => {
                recordWriteFailure(error?.name || error?.message || 'indexeddb_saveCheckpoint_failed');
                console.warn('[persistence] IndexedDB checkpoint write failed.', error);
            });

        return true;
    }

    function exportSave() {
        if (!cachedRaw) {
            return null;
        }

        try {
            return btoa(cachedRaw);
        } catch {
            return null;
        }
    }

    function importSave(encoded) {
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

            cachedSnapshot = save;
            cachedRaw = JSON.stringify(save);

            if (available) {
                recordWriteAttempt();
                recordWriteSuccess();
                void writeEnvelope(save)
                    .then(() => {
                        // Success already counted when write was accepted for async commit.
                    })
                    .catch((error) => {
                        recordWriteFailure(error?.name || error?.message || 'indexeddb_import_failed');
                        console.warn('[persistence] IndexedDB import write failed.', error);
                    });
            }

            return true;
        } catch {
            recordWriteFailure('indexeddb_import_decode_failed');
            return false;
        }
    }

    function clear() {
        cachedSnapshot = null;
        cachedRaw = null;

        if (!available) {
            return;
        }

        void deleteEnvelope().catch((error) => {
            console.warn('[persistence] IndexedDB clear failed.', error);
        });
    }

    function getRaw() {
        return cachedRaw;
    }

    function restoreRaw(rawValue) {
        if (typeof rawValue === 'string') {
            try {
                const parsed = JSON.parse(rawValue);
                const save = parseV2Save(parsed, saveVersion);
                cachedSnapshot = save;
                cachedRaw = rawValue;

                if (save && available) {
                    recordWriteAttempt();
                    recordWriteSuccess();
                    void writeEnvelope(save)
                        .then(() => {
                            // Success already counted when write was accepted for async commit.
                        })
                        .catch((error) => {
                            recordWriteFailure(error?.name || error?.message || 'indexeddb_restoreRaw_failed');
                            console.warn('[persistence] IndexedDB raw restore failed.', error);
                        });
                }
                return;
            } catch {
                cachedSnapshot = null;
                cachedRaw = null;
                return;
            }
        }

        clear();
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

    function isAvailable() {
        return available;
    }

    return {
        initialize,
        isAvailable,
        saveCheckpointBlocking,
        clearBlocking,
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
    createIndexedDbPersistenceAdapter,
};
