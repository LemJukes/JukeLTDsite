import { getCropIds } from '../configs/cropConfig.js';

function isObjectLike(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getCropLegacyFieldKeys(cropId) {
    return {
        seedKey: `${cropId}Seeds`,
        cropKey: cropId,
        seedBoughtKey: `${cropId}SeedsBought`,
        cropSoldKey: `${cropId}Sold`,
        unlockKey: `${cropId}Unlocked`,
    };
}

function buildMergedInventory(currentNodeState, updates) {
    const currentInventory = isObjectLike(currentNodeState?.inventory) ? currentNodeState.inventory : {};
    const incomingInventory = isObjectLike(updates?.inventory) ? updates.inventory : {};

    return {
        ...currentInventory,
        ...incomingInventory,
        seedsByCrop: {
            ...(isObjectLike(currentInventory.seedsByCrop) ? currentInventory.seedsByCrop : {}),
            ...(isObjectLike(incomingInventory.seedsByCrop) ? incomingInventory.seedsByCrop : {}),
        },
        cropsById: {
            ...(isObjectLike(currentInventory.cropsById) ? currentInventory.cropsById : {}),
            ...(isObjectLike(incomingInventory.cropsById) ? incomingInventory.cropsById : {}),
        },
    };
}

function buildMergedProgressByCrop(currentNodeState, updates) {
    const currentProgress = isObjectLike(currentNodeState?.progressByCrop) ? currentNodeState.progressByCrop : {};
    const incomingProgress = isObjectLike(updates?.progressByCrop) ? updates.progressByCrop : {};

    return {
        ...currentProgress,
        ...incomingProgress,
        seedsBoughtByCrop: {
            ...(isObjectLike(currentProgress.seedsBoughtByCrop) ? currentProgress.seedsBoughtByCrop : {}),
            ...(isObjectLike(incomingProgress.seedsBoughtByCrop) ? incomingProgress.seedsBoughtByCrop : {}),
        },
        cropsSoldByCrop: {
            ...(isObjectLike(currentProgress.cropsSoldByCrop) ? currentProgress.cropsSoldByCrop : {}),
            ...(isObjectLike(incomingProgress.cropsSoldByCrop) ? incomingProgress.cropsSoldByCrop : {}),
        },
    };
}

function applyLegacyCropFieldOverrides(mergedState, updates) {
    getCropIds().forEach((cropId) => {
        const {
            seedKey,
            cropKey,
            seedBoughtKey,
            cropSoldKey,
            unlockKey,
        } = getCropLegacyFieldKeys(cropId);

        if (Object.prototype.hasOwnProperty.call(updates, seedKey)) {
            mergedState.inventory.seedsByCrop[cropId] = Math.max(0, Number(updates[seedKey]) || 0);
        }

        if (Object.prototype.hasOwnProperty.call(updates, cropKey)) {
            mergedState.inventory.cropsById[cropId] = Math.max(0, Number(updates[cropKey]) || 0);
        }

        if (Object.prototype.hasOwnProperty.call(updates, seedBoughtKey)) {
            mergedState.progressByCrop.seedsBoughtByCrop[cropId] = Math.max(0, Number(updates[seedBoughtKey]) || 0);
        }

        if (Object.prototype.hasOwnProperty.call(updates, cropSoldKey)) {
            mergedState.progressByCrop.cropsSoldByCrop[cropId] = Math.max(0, Number(updates[cropSoldKey]) || 0);
        }

        if (cropId !== 'wheat' && Object.prototype.hasOwnProperty.call(updates, unlockKey)) {
            const unlockedCrops = new Set(mergedState.unlocks.crops);
            if (updates[unlockKey]) {
                unlockedCrops.add(cropId);
            } else {
                unlockedCrops.delete(cropId);
            }
            mergedState.unlocks.crops = [...unlockedCrops];
        }
    });
}

export function normalizeCropUnlockList(rawUnlocks = {}) {
    const cropIds = getCropIds();
    const unlockedFromList = Array.isArray(rawUnlocks?.crops)
        ? rawUnlocks.crops.filter((cropId) => cropIds.includes(cropId))
        : [];
    const deduped = [...new Set(unlockedFromList)];

    if (!deduped.includes('wheat') && cropIds.includes('wheat')) {
        deduped.unshift('wheat');
    }

    return deduped;
}

export function normalizeNodeCropCollections(rawNode = {}, defaults = {}) {
    const cropIds = getCropIds();
    const rawInventory = isObjectLike(rawNode?.inventory) ? rawNode.inventory : {};
    const rawProgress = isObjectLike(rawNode?.progressByCrop) ? rawNode.progressByCrop : {};

    const seedsByCrop = {};
    const cropsById = {};
    const seedsBoughtByCrop = {};
    const cropsSoldByCrop = {};
    const unlockedLegacyCrops = [];

    cropIds.forEach((cropId) => {
        const {
            seedKey,
            cropKey,
            seedBoughtKey,
            cropSoldKey,
            unlockKey,
        } = getCropLegacyFieldKeys(cropId);

        const normalizedSeedValue = Number(rawInventory?.seedsByCrop?.[cropId]);
        const normalizedCropValue = Number(rawInventory?.cropsById?.[cropId]);
        const normalizedSeedsBoughtValue = Number(rawProgress?.seedsBoughtByCrop?.[cropId]);
        const normalizedCropsSoldValue = Number(rawProgress?.cropsSoldByCrop?.[cropId]);

        seedsByCrop[cropId] = Number.isFinite(normalizedSeedValue)
            ? Math.max(0, normalizedSeedValue)
            : Math.max(
                0,
                Number(rawNode?.[seedKey])
                || Number(defaults?.inventory?.seedsByCrop?.[cropId])
                || Number(defaults?.[seedKey])
                || 0,
            );

        cropsById[cropId] = Number.isFinite(normalizedCropValue)
            ? Math.max(0, normalizedCropValue)
            : Math.max(
                0,
                Number(rawNode?.[cropKey])
                || Number(defaults?.inventory?.cropsById?.[cropId])
                || Number(defaults?.[cropKey])
                || 0,
            );

        seedsBoughtByCrop[cropId] = Number.isFinite(normalizedSeedsBoughtValue)
            ? Math.max(0, normalizedSeedsBoughtValue)
            : Math.max(
                0,
                Number(rawNode?.[seedBoughtKey])
                || Number(defaults?.progressByCrop?.seedsBoughtByCrop?.[cropId])
                || Number(defaults?.[seedBoughtKey])
                || 0,
            );

        cropsSoldByCrop[cropId] = Number.isFinite(normalizedCropsSoldValue)
            ? Math.max(0, normalizedCropsSoldValue)
            : Math.max(
                0,
                Number(rawNode?.[cropSoldKey])
                || Number(defaults?.progressByCrop?.cropsSoldByCrop?.[cropId])
                || Number(defaults?.[cropSoldKey])
                || 0,
            );

        if (cropId !== 'wheat' && rawNode?.[unlockKey] === true) {
            unlockedLegacyCrops.push(cropId);
        }
    });

    return {
        inventory: {
            seedsByCrop,
            cropsById,
        },
        progressByCrop: {
            seedsBoughtByCrop,
            cropsSoldByCrop,
        },
        unlocks: {
            crops: normalizeCropUnlockList({
                crops: [
                    ...(Array.isArray(rawNode?.unlocks?.crops) ? rawNode.unlocks.crops : []),
                    ...unlockedLegacyCrops,
                ],
            }),
        },
    };
}

export function applyLegacyCropProjections(nodeState = {}) {
    const nextNodeState = { ...nodeState };
    const seedsByCrop = {
        ...(isObjectLike(nextNodeState?.inventory?.seedsByCrop) ? nextNodeState.inventory.seedsByCrop : {}),
    };
    const cropsById = {
        ...(isObjectLike(nextNodeState?.inventory?.cropsById) ? nextNodeState.inventory.cropsById : {}),
    };
    const seedsBoughtByCrop = {
        ...(isObjectLike(nextNodeState?.progressByCrop?.seedsBoughtByCrop) ? nextNodeState.progressByCrop.seedsBoughtByCrop : {}),
    };
    const cropsSoldByCrop = {
        ...(isObjectLike(nextNodeState?.progressByCrop?.cropsSoldByCrop) ? nextNodeState.progressByCrop.cropsSoldByCrop : {}),
    };
    const unlockedCrops = normalizeCropUnlockList(nextNodeState?.unlocks);

    nextNodeState.inventory = {
        seedsByCrop,
        cropsById,
    };
    nextNodeState.progressByCrop = {
        seedsBoughtByCrop,
        cropsSoldByCrop,
    };
    nextNodeState.unlocks = {
        crops: unlockedCrops,
    };

    getCropIds().forEach((cropId) => {
        const {
            seedKey,
            cropKey,
            seedBoughtKey,
            cropSoldKey,
            unlockKey,
        } = getCropLegacyFieldKeys(cropId);

        nextNodeState[seedKey] = Math.max(0, Number(seedsByCrop[cropId]) || 0);
        nextNodeState[cropKey] = Math.max(0, Number(cropsById[cropId]) || 0);
        nextNodeState[seedBoughtKey] = Math.max(0, Number(seedsBoughtByCrop[cropId]) || 0);
        nextNodeState[cropSoldKey] = Math.max(0, Number(cropsSoldByCrop[cropId]) || 0);

        if (cropId !== 'wheat') {
            nextNodeState[unlockKey] = unlockedCrops.includes(cropId);
        }
    });

    return nextNodeState;
}

function omitLegacyCropFields(statePatch = {}) {
    const nextPatch = { ...statePatch };

    getCropIds().forEach((cropId) => {
        const {
            seedKey,
            cropKey,
            seedBoughtKey,
            cropSoldKey,
            unlockKey,
        } = getCropLegacyFieldKeys(cropId);

        delete nextPatch[seedKey];
        delete nextPatch[cropKey];
        delete nextPatch[seedBoughtKey];
        delete nextPatch[cropSoldKey];

        if (cropId !== 'wheat') {
            delete nextPatch[unlockKey];
        }
    });

    return nextPatch;
}

export function adaptNodeStateLegacyPatch(currentNodeState, updates = {}) {
    if (!isObjectLike(currentNodeState) || !isObjectLike(updates)) {
        return updates;
    }

    const mergedState = {
        ...currentNodeState,
        ...updates,
        inventory: buildMergedInventory(currentNodeState, updates),
        progressByCrop: buildMergedProgressByCrop(currentNodeState, updates),
        unlocks: {
            crops: Array.isArray(updates?.unlocks?.crops)
                ? [...updates.unlocks.crops]
                : [...normalizeCropUnlockList(currentNodeState?.unlocks)],
        },
    };

    applyLegacyCropFieldOverrides(mergedState, updates);

    const normalizedCollections = normalizeNodeCropCollections(mergedState, currentNodeState);

    return {
        ...omitLegacyCropFields(updates),
        inventory: normalizedCollections.inventory,
        progressByCrop: normalizedCollections.progressByCrop,
        unlocks: normalizedCollections.unlocks,
    };
}
