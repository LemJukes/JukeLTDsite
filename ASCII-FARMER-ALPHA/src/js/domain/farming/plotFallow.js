import { progressionConfig } from '../../configs/progressionConfig.js';
import { getCropIds } from '../../configs/cropConfig.js';

const cropTypes = getCropIds();

function getPlotDisabledTime(activeFieldPlots) {
    const { fallowTime } = progressionConfig.storeEconomy.plot;
    const ownedPlots = Math.max(fallowTime.minPlotCount, Number(activeFieldPlots) || fallowTime.minPlotCount);
    const clampedPlots = Math.min(
        fallowTime.maxPlotCount,
        Math.max(fallowTime.minPlotCount, ownedPlots),
    );

    if (clampedPlots === fallowTime.minPlotCount) {
        return fallowTime.minDurationMs;
    }

    const plotRange = fallowTime.maxPlotCount - fallowTime.minPlotCount;
    const progress = (clampedPlots - fallowTime.minPlotCount) / plotRange;

    return fallowTime.minDurationMs + ((fallowTime.maxDurationMs - fallowTime.minDurationMs) * progress);
}

function getUnlockedSeedTypeCount(gameState = {}) {
    return cropTypes.filter((cropType) => cropType === 'wheat' || Boolean(gameState?.[`${cropType}Unlocked`])).length;
}

function isFallowFatigueUnlocked(gameState = {}) {
    return getUnlockedSeedTypeCount(gameState) > 2;
}

function getFallowCapDurationMs(baseFallowDurationMs) {
    const { fallowTime } = progressionConfig.storeEconomy.plot;
    const capMultiplier = Math.max(1, Number(fallowTime.durationCapMultiplier) || 3);
    return Math.max(baseFallowDurationMs, baseFallowDurationMs * capMultiplier);
}

function getFallowPenaltyStepDurationMs(baseFallowDurationMs) {
    const { fallowTime } = progressionConfig.storeEconomy.plot;
    const stepMultiplier = Math.max(0, Number(fallowTime.repeatPenaltyStepMultiplier) || 0);
    return Math.max(0, baseFallowDurationMs * stepMultiplier);
}

function getMaxFallowPenaltySteps(baseFallowDurationMs) {
    const capDurationMs = getFallowCapDurationMs(baseFallowDurationMs);
    const stepDurationMs = getFallowPenaltyStepDurationMs(baseFallowDurationMs);

    if (stepDurationMs <= 0) {
        return 0;
    }

    return Math.max(0, Math.floor((capDurationMs - baseFallowDurationMs) / stepDurationMs));
}

function getNormalizedFallowPenaltySteps(plotState, activeFieldPlots, gameState = {}) {
    if (!isFallowFatigueUnlocked(gameState)) {
        return 0;
    }

    const baseFallowDurationMs = getPlotDisabledTime(activeFieldPlots);
    const maxPenaltySteps = getMaxFallowPenaltySteps(baseFallowDurationMs);
    return Math.min(maxPenaltySteps, Math.max(0, Number(plotState?.fallowPenaltySteps) || 0));
}

function getPlotFallowDurationMs(plotState, activeFieldPlots, gameState = {}) {
    const baseFallowDurationMs = getPlotDisabledTime(activeFieldPlots);
    if (!isFallowFatigueUnlocked(gameState)) {
        return baseFallowDurationMs;
    }

    const penaltySteps = getNormalizedFallowPenaltySteps(plotState, activeFieldPlots, gameState);
    const stepDurationMs = getFallowPenaltyStepDurationMs(baseFallowDurationMs);
    const capDurationMs = getFallowCapDurationMs(baseFallowDurationMs);

    return Math.min(capDurationMs, Math.max(baseFallowDurationMs, baseFallowDurationMs + (penaltySteps * stepDurationMs)));
}

function applyPlotFallowAfterHarvest(plotState, harvestedCropType, activeFieldPlots, gameState = {}) {
    const normalizedCropType = cropTypes.includes(harvestedCropType) ? harvestedCropType : null;
    const previousCropType = cropTypes.includes(plotState?.lastCompletedCropType)
        ? plotState.lastCompletedCropType
        : null;
    const baseFallowDurationMs = getPlotDisabledTime(activeFieldPlots);
    const maxPenaltySteps = getMaxFallowPenaltySteps(baseFallowDurationMs);
    let nextPenaltySteps = Math.max(0, Number(plotState?.fallowPenaltySteps) || 0);

    if (!isFallowFatigueUnlocked(gameState) || !normalizedCropType) {
        nextPenaltySteps = 0;
    } else if (previousCropType === normalizedCropType) {
        nextPenaltySteps = Math.min(maxPenaltySteps, nextPenaltySteps + 1);
    } else if (previousCropType) {
        nextPenaltySteps = Math.max(0, nextPenaltySteps - 1);
    } else {
        nextPenaltySteps = 0;
    }

    const nextPlotState = {
        ...plotState,
        lastCompletedCropType: normalizedCropType,
        fallowPenaltySteps: nextPenaltySteps,
    };

    const appliedFallowDurationMs = getPlotFallowDurationMs(
        {
            ...nextPlotState,
            fallowPenaltySteps: nextPenaltySteps,
        },
        activeFieldPlots,
        gameState,
    );

    return {
        ...nextPlotState,
        lastFallowDurationMs: appliedFallowDurationMs,
        disabledUntil: Date.now() + appliedFallowDurationMs,
    };
}

export {
    isFallowFatigueUnlocked,
    getPlotDisabledTime,
    getNormalizedFallowPenaltySteps,
    getPlotFallowDurationMs,
    applyPlotFallowAfterHarvest,
};
