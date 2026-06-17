import { progressionConfig } from '../configs/progressionConfig.js';
import { attemptWaterAutoRefillPurchase } from './storeHandlers.js';

const WATER_AUTO_BUYER_CONFIG = progressionConfig.storeEconomy.water.autoBuyer || {};
const WATER_AUTO_BUYER_TICK_MS = Math.max(250, Number(WATER_AUTO_BUYER_CONFIG.tickMs) || 500);

const DEFAULT_WATER_AUTO_BUYER_EFFECTS = {
    getUpgradeValues: () => ({}),
};

let waterAutoBuyerEngineInitialized = false;
let waterAutoBuyerAccumulatorMs = 0;
let waterAutoBuyerEffects = { ...DEFAULT_WATER_AUTO_BUYER_EFFECTS };

function configureWaterAutoBuyerAdapters(adapters = {}) {
    const nextEffects = { ...waterAutoBuyerEffects };
    Object.entries(adapters).forEach(([name, fn]) => {
        if (typeof fn === 'function') {
            nextEffects[name] = fn;
        }
    });

    waterAutoBuyerEffects = nextEffects;
}

function processWaterAutoBuyerCycle() {
    const upgradeValues = waterAutoBuyerEffects.getUpgradeValues();
    if (!upgradeValues.waterAutoBuyerUnlocked || !upgradeValues.waterAutoBuyerPurchased || !upgradeValues.waterAutoBuyerEnabled) {
        return;
    }

    attemptWaterAutoRefillPurchase();
}

function initializeWaterAutoBuyerEngine() {
    if (waterAutoBuyerEngineInitialized) {
        return;
    }

    waterAutoBuyerEngineInitialized = true;
    waterAutoBuyerAccumulatorMs = 0;
}

function runWaterAutoBuyerSimulationStep(stepMs) {
    if (!waterAutoBuyerEngineInitialized) {
        return;
    }

    waterAutoBuyerAccumulatorMs += Math.max(0, Number(stepMs) || 0);

    while (waterAutoBuyerAccumulatorMs >= WATER_AUTO_BUYER_TICK_MS) {
        waterAutoBuyerAccumulatorMs -= WATER_AUTO_BUYER_TICK_MS;
        processWaterAutoBuyerCycle();
    }
}

export { configureWaterAutoBuyerAdapters, initializeWaterAutoBuyerEngine, runWaterAutoBuyerSimulationStep };
