// handlers/storeHandlers.js

import { getActiveNodeState as getState, updateActiveNodeState as updateState, incrementTotalClicks } from "../worldState.js";
import { updateWaterRefillsPurchased } from "./upgradeHandlers.js";
import { trackAchievements, 
         updateSeedsBought, 
         updateCropsSold, 
         updateCoinsEarned,
        } from "./achievementHandlers.js";
import { progressionConfig } from "../configs/progressionConfig.js";
import { getCropIds, getCropLabel } from "../configs/cropConfig.js";
import { getCropInventoryCount, getCropSeedCount } from '../state/nodeCropView.js';
import {
    FIELD_GRID_CAPACITY,
    getAvailablePlotPurchaseIndices,
} from "../configs/fieldGridConfig.js";

const WATER_AUTO_BUYER_CONFIG = progressionConfig.storeEconomy.water.autoBuyer || {};
const WATER_AUTO_BUYER_SURCHARGE_MULTIPLIER = Math.max(1, Number(WATER_AUTO_BUYER_CONFIG.surchargeMultiplier) || 1.1);
const WATER_AUTO_BUYER_TRIGGER_BELOW = Math.max(1, Number(WATER_AUTO_BUYER_CONFIG.triggerBelow) || 5);
const cropTypes = getCropIds();

const DEFAULT_STORE_VALUES = {
    wheatSeedCost: progressionConfig.storeEconomy.seedCosts.wheat,
    cornSeedCost: progressionConfig.storeEconomy.seedCosts.corn,
    tomatoSeedCost: progressionConfig.storeEconomy.seedCosts.tomato,
    potatoSeedCost: progressionConfig.storeEconomy.seedCosts.potato,
    carrotSeedCost: progressionConfig.storeEconomy.seedCosts.carrot,
    waterCost: progressionConfig.storeEconomy.water.cost,
    waterQuantity: progressionConfig.storeEconomy.water.quantity,
    plotCost: progressionConfig.storeEconomy.plot.baseCost,
    wheatPrice: progressionConfig.storeEconomy.sellPrices.wheat,
    cornPrice: progressionConfig.storeEconomy.sellPrices.corn,
    tomatoPrice: progressionConfig.storeEconomy.sellPrices.tomato,
    potatoPrice: progressionConfig.storeEconomy.sellPrices.potato,
    carrotPrice: progressionConfig.storeEconomy.sellPrices.carrot,
};

let storeEffects = {
    getStoreValues: () => ({ ...DEFAULT_STORE_VALUES }),
    updateStoreValues: () => {},
    updateResourceBar: () => {},
    updateField: () => {},
    updateClicksDisplay: () => {},
    playCoinGainBurst: () => {},
    showNotification: () => {},
    showDialog: () => {},
    setPlotCostLabel: () => {},
};

function getStoreValuesSafe() {
    const values = storeEffects.getStoreValues();
    if (!values || typeof values !== 'object') {
        return { ...DEFAULT_STORE_VALUES };
    }

    return values;
}

function updateStoreValuesSafe(updates) {
    storeEffects.updateStoreValues(updates);
}

function runUiEffect(name, ...args) {
    const effectFn = storeEffects[name];
    if (typeof effectFn === 'function') {
        effectFn(...args);
    }
}

function configureStoreHandlerAdapters(adapters = {}) {
    const nextEffects = { ...storeEffects };
    Object.entries(adapters).forEach(([name, fn]) => {
        if (typeof fn === 'function') {
            nextEffects[name] = fn;
        }
    });

    storeEffects = nextEffects;
}

function isValidCropType(cropType) {
    return cropTypes.includes(cropType);
}

function buildSeedsByCropUpdate(gameState, cropType, quantityDelta) {
    return {
        ...(gameState.inventory?.seedsByCrop || {}),
        [cropType]: Math.max(0, getCropSeedCount(gameState, cropType) + Number(quantityDelta || 0)),
    };
}

function buildCropsByIdUpdate(gameState, cropType, quantityDelta) {
    return {
        ...(gameState.inventory?.cropsById || {}),
        [cropType]: Math.max(0, getCropInventoryCount(gameState, cropType) + Number(quantityDelta || 0)),
    };
}

function getSeedCostKey(cropType) {
    return isValidCropType(cropType) ? `${cropType}SeedCost` : null;
}

function getCropPriceKey(cropType) {
    return isValidCropType(cropType) ? `${cropType}Price` : null;
}

function getCropDisplayName(cropType, { plural = false } = {}) {
    return getCropLabel(cropType, { plural });
}

function getActiveFieldForMutation(gameState) {
    const activeFieldId = gameState.activeFieldId;
    const activeField = gameState.fields?.[activeFieldId];
    if (!activeField || !Array.isArray(activeField.plotStates)) {
        return null;
    }

    return {
        activeFieldId,
        activeField,
    };
}

function commitPlotStatesToActiveField(gameState, activeFieldId, activeField, plotStates) {
    const updatedFields = {
        ...gameState.fields,
        [activeFieldId]: {
            ...activeField,
            plotStates,
        },
    };

    updateState({ fields: updatedFields });
}


function buyWater() {
    const storeValues = getStoreValuesSafe();

    performWaterRefillPurchase({
        amount: storeValues.waterQuantity,
        cost: storeValues.waterCost,
        showErrorNotifications: true,
        countAsClick: true,
    });
}

function buyBulkWaterRefill(amount, cost) {
    performWaterRefillPurchase({
        amount,
        cost,
        showErrorNotifications: true,
        countAsClick: true,
    });
}

function buildWaterRefillCost(amount, { costOverride, costMultiplier = 1, surchargeMultiplier = 1 } = {}) {
    const refillAmount = Math.max(1, Number(amount) || 1);
    const parsedOverride = Number(costOverride);

    if (Number.isFinite(parsedOverride) && parsedOverride >= 0) {
        return Math.ceil(parsedOverride * Math.max(1, Number(surchargeMultiplier) || 1));
    }

    const storeValues = getStoreValuesSafe();
    const baseQuantity = Math.max(1, Number(storeValues.waterQuantity) || 10);
    const baseCost = Math.max(0, Number(storeValues.waterCost) || 0);
    const multiplier = Math.max(0, Number(costMultiplier) || 0);
    const surcharge = Math.max(1, Number(surchargeMultiplier) || 1);

    return Math.ceil((refillAmount / baseQuantity) * baseCost * multiplier * surcharge);
}

function performWaterRefillPurchase({ amount, cost, showErrorNotifications = true, countAsClick = true }) {
    const gameState = getState();
    const refillAmount = Math.max(1, Number(amount) || 1);
    const refillCost = Math.max(0, Number(cost) || 0);

    if (gameState.coins < refillCost) {
        if (showErrorNotifications) {
            runUiEffect('showNotification', 'Not enough coins to buy water!', 'Store');
        }
        return false;
    }

    if (gameState.water >= gameState.waterCapacity) {
        if (showErrorNotifications) {
            runUiEffect('showNotification', 'Water supply is already full!', 'Store', 'warning');
        }
        return false;
    }

    const newWaterLevel = Math.min(gameState.water + refillAmount, gameState.waterCapacity);

    updateState({
        coins: gameState.coins - refillCost,
        water: newWaterLevel,
        totalCoinsSpent: gameState.totalCoinsSpent + refillCost,
    });

    updateWaterRefillsPurchased();
    trackAchievements();
    runUiEffect('updateResourceBar');

    if (countAsClick) {
        incrementTotalClicks();
        runUiEffect('updateClicksDisplay');
    }

    return true;
}

function getLargestUnlockedWaterRefill() {
    const gameState = getState();
    const storeValues = getStoreValuesSafe();
    const baseQuantity = Math.max(1, Number(storeValues.waterQuantity) || 10);
    const baseCost = Math.max(0, Number(storeValues.waterCost) || 0);
    const thresholds = progressionConfig.achievements.waterRefillsPurchased || [];
    const waterRefillTiers = progressionConfig.bulkTiers.waterRefills || [];
    const availableTiers = Math.min(thresholds.length, waterRefillTiers.length);

    let largestRefill = {
        amount: baseQuantity,
        baseCost,
    };

    for (let i = 0; i < availableTiers; i++) {
        if (gameState.waterRefillsPurchased < thresholds[i]) {
            continue;
        }

        const tier = waterRefillTiers[i];
        const tierAmount = Math.max(1, Number(tier?.quantity) || 0);
        if (tierAmount <= largestRefill.amount) {
            continue;
        }

        largestRefill = {
            amount: tierAmount,
            baseCost: buildWaterRefillCost(tierAmount, { costMultiplier: tier?.costMultiplier }),
        };
    }

    return largestRefill;
}

function attemptWaterAutoRefillPurchase() {
    const gameState = getState();

    if (gameState.water >= WATER_AUTO_BUYER_TRIGGER_BELOW || gameState.water >= gameState.waterCapacity) {
        return false;
    }

    const largestRefill = getLargestUnlockedWaterRefill();
    const autoRefillCost = buildWaterRefillCost(largestRefill.amount, {
        costOverride: largestRefill.baseCost,
        surchargeMultiplier: WATER_AUTO_BUYER_SURCHARGE_MULTIPLIER,
    });

    return performWaterRefillPurchase({
        amount: largestRefill.amount,
        cost: autoRefillCost,
        showErrorNotifications: false,
        countAsClick: false,
    });
}

function buyBulkSeedPack(cropType, quantity, totalCost) {
    if (!isValidCropType(cropType)) {
        return;
    }

    const gameState = getState();
    const packQuantity = Math.max(1, Number(quantity) || 1);
    const packCost = Math.max(0, Number(totalCost) || 0);

    if (gameState.coins >= packCost) {
        const nextSeedsByCrop = buildSeedsByCropUpdate(gameState, cropType, packQuantity);
        updateState({
            coins: gameState.coins - packCost,
            inventory: {
                seedsByCrop: nextSeedsByCrop,
            },
            totalCoinsSpent: gameState.totalCoinsSpent + packCost,
        });
        updateSeedsBought(cropType, packQuantity);
        runUiEffect('updateResourceBar');
        incrementTotalClicks();
        runUiEffect('updateClicksDisplay');
    } else {
        runUiEffect('showNotification', `Not enough coins to buy ${getCropDisplayName(cropType)} seeds!`, 'Store');
    }
}

function sellBulkCropPack(cropType, quantity, payout) {
    if (!isValidCropType(cropType)) {
        return;
    }

    const gameState = getState();
    const sellQuantity = Math.max(1, Number(quantity) || 1);
    const sellPayout = Math.max(0, Number(payout) || 0);

    const availableAmount = getCropInventoryCount(gameState, cropType);

    if (availableAmount >= sellQuantity) {
        const nextCropsById = buildCropsByIdUpdate(gameState, cropType, -sellQuantity);
        updateState({
            coins: gameState.coins + sellPayout,
            inventory: {
                cropsById: nextCropsById,
            },
        });

        runUiEffect('playCoinGainBurst', sellPayout);

        updateCoinsEarned(sellPayout);
        updateCropsSold(cropType, sellQuantity);

        runUiEffect('updateResourceBar');
        incrementTotalClicks();
        runUiEffect('updateClicksDisplay');
    } else {
            runUiEffect('showNotification', `Not enough ${getCropDisplayName(cropType)} to sell!`, 'Store');
    }
}

function buyPlot() {
    const maxPlots = FIELD_GRID_CAPACITY;
    const gameState = getState();
    const storeValues = getStoreValuesSafe();
    const activeFieldId = gameState.activeFieldId;
    const activeField = gameState.fields?.[activeFieldId];

    if (!activeField) {
        console.log("No active field found");
        return;
    }

    let plotCost = storeValues.plotCost;
    const plots = Number(activeField.plots) || 1;

    if (plots >= progressionConfig.storeEconomy.plot.scalingStartPlotCount) {
        plotCost = Math.ceil(plotCost * progressionConfig.storeEconomy.plot.scalingMultiplier);
    }

    if (gameState.coins < plotCost) {
        runUiEffect('showNotification', 'Not enough coins to buy a plot!', 'Store');
        return;
    }

    if (plots >= maxPlots) {
        runUiEffect('showNotification', 'Field is full, cannot buy more plots', 'Field');
        console.log("Field is full, cannot buy more plots");
        return;
    }

    const availablePlotIndices = getAvailablePlotPurchaseIndices(activeField);
    if (!availablePlotIndices.length) {
        runUiEffect('showNotification', 'No adjacent plot slots are available to purchase.', 'Field Expansion');
        return;
    }

    updateState({
        plotSelectionMode: 'buyPlot',
        pendingPlotPurchase: {
            fieldId: activeFieldId,
            cost: plotCost,
        },
    });

    storeValues.plotCost = plotCost;
    updateStoreValuesSafe({
        plotCost: storeValues.plotCost,
    });

    runUiEffect('setPlotCostLabel', storeValues.plotCost);
    runUiEffect('updateField');
    runUiEffect('showNotification', 'Select an unlocked adjacent plot slot to purchase.', 'Field Expansion');
}

// Crop-Specific Seed Purchasing Handlers
function buyCropSeeds(cropType) {
    const seedCostKey = getSeedCostKey(cropType);
    if (!isValidCropType(cropType) || !seedCostKey) {
        return;
    }

    const gameState = getState();
    const storeValues = getStoreValuesSafe();
    const seedCost = Number(storeValues[seedCostKey]) || 0;

    if (gameState.coins >= seedCost) {
        const nextSeedsByCrop = buildSeedsByCropUpdate(gameState, cropType, 1);
        updateState({
            coins: gameState.coins - seedCost,
            inventory: {
                seedsByCrop: nextSeedsByCrop,
            },
            totalCoinsSpent: gameState.totalCoinsSpent + seedCost,
        });
        updateSeedsBought(cropType, 1);
        runUiEffect('updateResourceBar');
        incrementTotalClicks();
        runUiEffect('updateClicksDisplay');
    } else {
        runUiEffect('showNotification', `Not enough coins to buy ${getCropDisplayName(cropType)} seeds!`, 'Store');
    }
}

// Crop-Specific Selling Handlers
function sellCrop(cropType) {
    const priceKey = getCropPriceKey(cropType);
    if (!isValidCropType(cropType) || !priceKey) {
        return;
    }

    const gameState = getState();
    const storeValues = getStoreValuesSafe();
    const unitPrice = Number(storeValues[priceKey]) || 0;
    const availableAmount = getCropInventoryCount(gameState, cropType);

    if (availableAmount > 0) {
        const nextCropsById = buildCropsByIdUpdate(gameState, cropType, -1);
        updateState({
            coins: gameState.coins + unitPrice,
            inventory: {
                cropsById: nextCropsById,
            },
        });
        runUiEffect('playCoinGainBurst', unitPrice);
        updateCoinsEarned(unitPrice);
        updateCropsSold(cropType, 1);
        runUiEffect('updateResourceBar');
        incrementTotalClicks();
        runUiEffect('updateClicksDisplay');
    } else {
        runUiEffect('showNotification', `No ${getCropDisplayName(cropType, { plural: true })} to sell!`, 'Store');
    }
}

function sellAllCrop(cropType) {
    const unitPriceKey = getCropPriceKey(cropType);
    if (!isValidCropType(cropType) || !unitPriceKey) {
        return;
    }

    const gameState = getState();
    const storeValues = getStoreValuesSafe();
    const availableAmount = getCropInventoryCount(gameState, cropType);
    const displayName = getCropDisplayName(cropType, { plural: true });

    if (availableAmount <= 0) {
        runUiEffect('showNotification', `No ${displayName} to sell!`, 'Store');
        return;
    }

    const unitPrice = Math.max(0, Number(storeValues[unitPriceKey]) || 0);
    const payout = availableAmount * unitPrice;

    const nextCropsById = buildCropsByIdUpdate(gameState, cropType, -availableAmount);
    updateState({
        coins: gameState.coins + payout,
        inventory: {
            cropsById: nextCropsById,
        },
    });

    runUiEffect('playCoinGainBurst', payout);

    updateCoinsEarned(payout);
    updateCropsSold(cropType, availableAmount);
    runUiEffect('updateResourceBar');
    incrementTotalClicks();
    runUiEffect('updateClicksDisplay');

    runUiEffect('showDialog', {
        title: 'Sale Complete',
        message: `Sold: ${availableAmount} ${displayName}\nEarned: ${payout} coins`,
    });
}

export { buyWater, buyPlot,
         buyCropSeeds,
         sellCrop,
         sellAllCrop,
         buyBulkSeedPack, sellBulkCropPack, buyBulkWaterRefill,
         configureStoreHandlerAdapters,
         attemptWaterAutoRefillPurchase };
