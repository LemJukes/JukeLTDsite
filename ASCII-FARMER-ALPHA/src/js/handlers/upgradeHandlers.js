// ./handlers/upgradeHandlers.js

import { getActiveNodeState as getState, updateActiveNodeState as updateState, incrementTotalClicks } from "../worldState.js";
import { progressionConfig } from "../configs/progressionConfig.js";

const DEFAULT_UPGRADE_EFFECTS = {
    getUpgradeValues: () => ({}),
    updateUpgradeValues: () => {},
    addWaterUpgradeButton: () => {},
    updateWaterUpgradeButton: () => {},
    renderClickUpgradesSection: () => {},
    updateResourceBar: () => {},
    updateClicksDisplay: () => {},
    showNotification: () => {},
};

let upgradeEffects = { ...DEFAULT_UPGRADE_EFFECTS };

function configureUpgradeHandlerAdapters(adapters = {}) {
    const nextEffects = { ...upgradeEffects };
    Object.entries(adapters).forEach(([name, fn]) => {
        if (typeof fn === 'function') {
            nextEffects[name] = fn;
        }
    });

    upgradeEffects = nextEffects;
}

function runUpgradeEffect(name, ...args) {
    const effectFn = upgradeEffects[name];
    if (typeof effectFn === 'function') {
        return effectFn(...args);
    }

    return undefined;
}

function finalizeClickUpgradeInteraction() {
    runUpgradeEffect('renderClickUpgradesSection');
    runUpgradeEffect('updateResourceBar');
    incrementTotalClicks();
    runUpgradeEffect('updateClicksDisplay');
}

function finalizeWaterUpgradeInteraction() {
    runUpgradeEffect('addWaterUpgradeButton');
    runUpgradeEffect('updateResourceBar');
    incrementTotalClicks();
    runUpgradeEffect('updateClicksDisplay');
}

function buyToolAutoChangerChargePack(amount, cost) {
    const gameState = getState();
    const upgradeValues = runUpgradeEffect('getUpgradeValues') || {};

    if (gameState.coins < cost) {
        runUpgradeEffect('showNotification', 'Not enough coins for this upgrade.', 'Upgrades');
        return;
    }

    updateState({
        coins: gameState.coins - cost,
        totalCoinsSpent: gameState.totalCoinsSpent + cost,
    });
    runUpgradeEffect('updateUpgradeValues', {
        toolAutoChangerCharges: upgradeValues.toolAutoChangerCharges + amount,
    });

    finalizeClickUpgradeInteraction();
}

function buyWaterAutoBuyerUpgrade() {
    const gameState = getState();
    const upgradeValues = runUpgradeEffect('getUpgradeValues') || {};

    if (!upgradeValues.waterAutoBuyerUnlocked) {
        runUpgradeEffect('showNotification', 'Water Auto-Buyer is still locked.', 'Upgrades');
        return;
    }

    if (upgradeValues.waterAutoBuyerPurchased) {
        return;
    }

    if (gameState.coins < upgradeValues.waterAutoBuyerCost) {
        runUpgradeEffect('showNotification', 'Not enough coins for this upgrade.', 'Upgrades');
        return;
    }

    updateState({
        coins: gameState.coins - upgradeValues.waterAutoBuyerCost,
        totalCoinsSpent: gameState.totalCoinsSpent + upgradeValues.waterAutoBuyerCost,
    });
    runUpgradeEffect('updateUpgradeValues', {
        waterAutoBuyerPurchased: true,
        waterAutoBuyerEnabled: false,
    });

    finalizeWaterUpgradeInteraction();
}

function buyWaterCapacityUpgrade() {
    console.log('Water Capacity Upgrade Purchased')
    const gameState = getState();
    const upgradeValues = runUpgradeEffect('getUpgradeValues') || {};
    const currentWaterUpgradeCost = Math.max(0, Number.parseInt(upgradeValues.waterUpgradeCost, 10) || 0);

    if (gameState.coins >= currentWaterUpgradeCost) {
        gameState.waterCapacity += progressionConfig.upgradesEconomy.waterCapacity.capacityIncrease;
        gameState.coins -= currentWaterUpgradeCost;
        gameState.totalCoinsSpent += currentWaterUpgradeCost;

        const newWaterUpgradeCost = Math.ceil(currentWaterUpgradeCost * progressionConfig.upgradesEconomy.waterCapacity.scalingMultiplier);
        runUpgradeEffect('updateUpgradeValues', { waterUpgradeCost: newWaterUpgradeCost });
        runUpgradeEffect('updateWaterUpgradeButton');

        updateState(gameState);
        runUpgradeEffect('updateResourceBar');
        incrementTotalClicks();
        runUpgradeEffect('updateClicksDisplay');
    } else {
        runUpgradeEffect('showNotification', 'Not enough coins for this upgrade.', 'Upgrades');
    }
}


function updateWaterRefillsPurchased() {
    const gameState = getState();
    gameState.waterRefillsPurchased++;
    updateState({ waterRefillsPurchased: gameState.waterRefillsPurchased });
}

function buyExpandedClickUpgrade(level) {
    const gameState = getState();
    const upgradeValues = runUpgradeEffect('getUpgradeValues') || {};
    const unlockedKey = `expandedClickMk${level}Unlocked`;
    const purchasedKey = `expandedClickMk${level}Purchased`;
    const costKey = level === 1 ? 'expandedClickUpgradeCost' : `expandedClickMk${level}Cost`;
    const upgradeCost = upgradeValues[costKey];

    if (!upgradeValues[unlockedKey]) {
        runUpgradeEffect('showNotification', `Expanded Click Mk.${level} is still locked.`, 'Upgrades');
        return;
    }

    if (gameState.coins >= upgradeCost) {
        gameState.coins -= upgradeCost;
        gameState.totalCoinsSpent += upgradeCost;
        upgradeValues.expandedClickUpgradeLVL++;
        upgradeValues[purchasedKey] = true;
        updateState(gameState);
        runUpgradeEffect('updateUpgradeValues', upgradeValues);
        console.log(`${purchasedKey} is now: ${upgradeValues[purchasedKey]}`);

        console.log(`Expanded Click Mk.${level} Upgrade Purchased`);
        finalizeClickUpgradeInteraction();
    } else {
        runUpgradeEffect('showNotification', 'Not enough coins for this upgrade.', 'Upgrades');
    }
}

function buyExpandedClickUpgradeMk1() {
    buyExpandedClickUpgrade(1);
}

function buyExpandedClickUpgradeMk2() {
    buyExpandedClickUpgrade(2);
}

function buyExpandedClickUpgradeMk3() {
    buyExpandedClickUpgrade(3);
}

function buyExpandedClickUpgradeMk4() {
    buyExpandedClickUpgrade(4);
}

function buyExpandedClickUpgradeMk5() {
    buyExpandedClickUpgrade(5);
}

function buyExpandedClickUpgradeMk6() {
    buyExpandedClickUpgrade(6);
}

function buyToolAutoChangerUpgrade() {
    const gameState = getState();
    const upgradeValues = runUpgradeEffect('getUpgradeValues') || {};

    if (gameState.coins < upgradeValues.toolAutoChangerCost) {
        runUpgradeEffect('showNotification', 'Not enough coins for this upgrade.', 'Upgrades');
        return;
    }

    updateState({
        coins: gameState.coins - upgradeValues.toolAutoChangerCost,
        totalCoinsSpent: gameState.totalCoinsSpent + upgradeValues.toolAutoChangerCost,
    });
    runUpgradeEffect('updateUpgradeValues', { toolAutoChangerPurchased: true });
    finalizeClickUpgradeInteraction();
}

function buyToolAutoChangerChargePack100() {
    const upgradeValues = runUpgradeEffect('getUpgradeValues') || {};
    buyToolAutoChangerChargePack(100, upgradeValues.toolAutoChangerChargePack100Cost);
}

function buyToolAutoChangerChargePack500() {
    const upgradeValues = runUpgradeEffect('getUpgradeValues') || {};
    buyToolAutoChangerChargePack(500, upgradeValues.toolAutoChangerChargePack500Cost);
}

function buyToolAutoChangerChargePack1000() {
    const upgradeValues = runUpgradeEffect('getUpgradeValues') || {};
    buyToolAutoChangerChargePack(1000, upgradeValues.toolAutoChangerChargePack1000Cost);
}


export {
    configureUpgradeHandlerAdapters,
    buyWaterCapacityUpgrade,
    buyWaterAutoBuyerUpgrade,
    updateWaterRefillsPurchased,
    buyExpandedClickUpgradeMk1,
    buyExpandedClickUpgradeMk2,
    buyExpandedClickUpgradeMk3,
    buyExpandedClickUpgradeMk4,
    buyExpandedClickUpgradeMk5,
    buyExpandedClickUpgradeMk6,
    buyToolAutoChangerUpgrade,
    buyToolAutoChangerChargePack100,
    buyToolAutoChangerChargePack500,
    buyToolAutoChangerChargePack1000,
};
