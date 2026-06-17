import { getCropIds } from '../configs/cropConfig.js';

export function isCropUnlocked(nodeState, cropId) {
    if (cropId === 'wheat') {
        return true;
    }

    const normalizedUnlocks = Array.isArray(nodeState?.unlocks?.crops)
        ? nodeState.unlocks.crops
        : [];

    return normalizedUnlocks.includes(cropId) || Boolean(nodeState?.[`${cropId}Unlocked`]);
}

export function getCropSeedCount(nodeState, cropId) {
    const normalizedValue = Number(nodeState?.inventory?.seedsByCrop?.[cropId]);
    if (Number.isFinite(normalizedValue)) {
        return Math.max(0, normalizedValue);
    }

    return Math.max(0, Number(nodeState?.[`${cropId}Seeds`]) || 0);
}

export function getCropInventoryCount(nodeState, cropId) {
    const normalizedValue = Number(nodeState?.inventory?.cropsById?.[cropId]);
    if (Number.isFinite(normalizedValue)) {
        return Math.max(0, normalizedValue);
    }

    return Math.max(0, Number(nodeState?.[cropId]) || 0);
}

export function getCropSeedsBoughtCount(nodeState, cropId) {
    const normalizedValue = Number(nodeState?.progressByCrop?.seedsBoughtByCrop?.[cropId]);
    if (Number.isFinite(normalizedValue)) {
        return Math.max(0, normalizedValue);
    }

    return Math.max(0, Number(nodeState?.[`${cropId}SeedsBought`]) || 0);
}

export function getCropSoldCount(nodeState, cropId) {
    const normalizedValue = Number(nodeState?.progressByCrop?.cropsSoldByCrop?.[cropId]);
    if (Number.isFinite(normalizedValue)) {
        return Math.max(0, normalizedValue);
    }

    return Math.max(0, Number(nodeState?.[`${cropId}Sold`]) || 0);
}

export function getNodeCropEntries(nodeState) {
    return getCropIds().map((cropId) => ({
        cropId,
        unlocked: isCropUnlocked(nodeState, cropId),
        seedCount: getCropSeedCount(nodeState, cropId),
        cropCount: getCropInventoryCount(nodeState, cropId),
    }));
}