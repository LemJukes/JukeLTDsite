import { getActiveNodeState as getState, updateActiveNodeState as updateState } from '../worldState.js';
import { progressionConfig, getAchievementValues as getProgressionAchievementValues } from '../configs/progressionConfig.js';
import { trackQuestUnlocks, trackQuestAutoCompletions } from './questHandlers.js';
import { getCropIds, getCropLabel } from '../configs/cropConfig.js';
import { checkMilestones } from '../world/milestones.js';
import { isCropUnlocked, getCropSeedsBoughtCount, getCropSoldCount } from '../state/nodeCropView.js';

const cropTypes = getCropIds();

const DEFAULT_ACHIEVEMENT_EFFECTS = {
    addBulkSeedButton: () => {},
    addBulkCropSaleButton: () => {},
    addBulkWaterRefillButton: () => {},
    addSellAllCropButton: () => {},
    wrapInMacWindow: () => {},
    showNotification: () => {},
    registerDesktopWindow: () => {},
    initializeUpgradesTitle: () => {},
    initializeUpgrades: () => {},
    initializeWaterUpgradesSection: () => {},
    initializeClickUpgradesSection: () => {},
    updateUpgradeValues: () => {},
    updateToolboxDisplay: () => {},
    playCoinGainBurst: () => {},
    showDesktopIconHint: () => {},
    ensureUpgradesContainer: () => {},
    hasWaterUpgradesSection: () => false,
    hasClickUpgradesSection: () => false,
    showCropInStore: () => {},
    showCropInResource: () => {},
    enableWaterUpgradeButton: () => {},
    isUpgradesIconVisible: () => false,
};

let achievementEffects = { ...DEFAULT_ACHIEVEMENT_EFFECTS };

function configureAchievementHandlerAdapters(adapters = {}) {
    const nextEffects = { ...achievementEffects };
    Object.entries(adapters).forEach(([name, fn]) => {
        if (typeof fn === 'function') {
            nextEffects[name] = fn;
        }
    });

    achievementEffects = nextEffects;
}

function runAchievementEffect(name, ...args) {
    const effectFn = achievementEffects[name];
    if (typeof effectFn === 'function') {
        return effectFn(...args);
    }

    return undefined;
}

function getUnlockedSeedTypes(gameState) {
    return cropTypes.filter((cropType) => isCropUnlocked(gameState, cropType));
}

function getAchievementValues() {
    return getProgressionAchievementValues();
}

function announceAchievementUnlock(message) {
    runAchievementEffect('showNotification', message, 'Achievement', 'achievement');
}

function unlockAchievement(achievementId, message) {
    const gameState = getState();
    if (gameState.achievementsUnlocked.includes(achievementId)) {
        return false;
    }

    updateState({
        achievementsUnlocked: [...gameState.achievementsUnlocked, achievementId],
    });

    announceAchievementUnlock(message);
    return true;
}

function applyUpgradeUnlocks(gameState) {
    const upgradeUnlocks = progressionConfig.unlocks;
    const upgradeUpdates = {};
    const shouldRenderWaterUpgrades = gameState.waterRefillsPurchased >= upgradeUnlocks.upgradeSections.waterUpgradesByWaterRefills;
    const hasWaterUpgradesSection = Boolean(runAchievementEffect('hasWaterUpgradesSection'));
    const hasClickUpgradesSection = Boolean(runAchievementEffect('hasClickUpgradesSection'));

    if (shouldRenderWaterUpgrades && !hasWaterUpgradesSection) {
        runAchievementEffect('ensureUpgradesContainer');
        runAchievementEffect('initializeWaterUpgradesSection');
    }

    if (gameState.waterRefillsPurchased >= upgradeUnlocks.waterAutoBuyerByWaterRefills) {
        upgradeUpdates.waterAutoBuyerUnlocked = true;
    }

    const shouldRenderClickUpgrades =
        gameState.totalCoinsEarned >= upgradeUnlocks.upgradeSections.clickUpgradesByCoinsEarned ||
        gameState.totalCoinsSpent >= upgradeUnlocks.expandedClickByCoinsSpent.mk1;

    if (shouldRenderClickUpgrades && !hasClickUpgradesSection) {
        runAchievementEffect('ensureUpgradesContainer');
        runAchievementEffect('initializeClickUpgradesSection');
    }

    if (gameState.totalCoinsEarned >= upgradeUnlocks.toolAutoChangerChargePacksByCoinsEarned.pack100) {
        upgradeUpdates.toolAutoChangerChargePack100Unlocked = true;
    }

    if (gameState.totalCoinsEarned >= upgradeUnlocks.toolAutoChangerChargePacksByCoinsEarned.pack500) {
        upgradeUpdates.toolAutoChangerChargePack500Unlocked = true;
    }

    if (gameState.totalCoinsEarned >= upgradeUnlocks.toolAutoChangerChargePacksByCoinsEarned.pack1000) {
        upgradeUpdates.toolAutoChangerChargePack1000Unlocked = true;
    }

    if (gameState.totalCoinsSpent >= upgradeUnlocks.expandedClickByCoinsSpent.mk1) {
        upgradeUpdates.expandedClickMk1Unlocked = true;
    }

    if (gameState.totalCoinsSpent >= upgradeUnlocks.expandedClickByCoinsSpent.mk2) {
        upgradeUpdates.expandedClickMk2Unlocked = true;
    }

    if (gameState.totalCoinsSpent >= upgradeUnlocks.expandedClickByCoinsSpent.mk3) {
        upgradeUpdates.expandedClickMk3Unlocked = true;
    }

    if (gameState.totalCoinsSpent >= upgradeUnlocks.expandedClickByCoinsSpent.mk4) {
        upgradeUpdates.expandedClickMk4Unlocked = true;
    }

    if (gameState.totalCoinsSpent >= upgradeUnlocks.expandedClickByCoinsSpent.mk5) {
        upgradeUpdates.expandedClickMk5Unlocked = true;
    }

    if (gameState.totalCoinsSpent >= upgradeUnlocks.expandedClickByCoinsSpent.mk6) {
        upgradeUpdates.expandedClickMk6Unlocked = true;
    }

    if (Object.keys(upgradeUpdates).length > 0) {
        runAchievementEffect('updateUpgradeValues', upgradeUpdates);

        if (shouldRenderClickUpgrades || upgradeUpdates.expandedClickMk1Unlocked) {
            runAchievementEffect('initializeClickUpgradesSection');
        }

        if (shouldRenderWaterUpgrades || upgradeUpdates.waterAutoBuyerUnlocked) {
            runAchievementEffect('initializeWaterUpgradesSection');
        }
    }

    if (runAchievementEffect('isUpgradesIconVisible')) {
        void runAchievementEffect('showDesktopIconHint', {
            iconId: 'desktop-icon-upgrades',
            title: 'Upgrades Available',
            message: 'This icon opens the Upgrades window. Check here when you want to improve tools, farm systems, and automation.',
            flagName: 'upgradesIconHintShown',
            category: 'success',
        });
    }
}

function checkGeneralAchievementMilestones(gameState) {
    const achievementValues = getAchievementValues();

    achievementValues.totalCoinsSpent.forEach((threshold) => {
        if (gameState.totalCoinsSpent >= threshold) {
            unlockAchievement(
                `totalCoinsSpent-${threshold}`,
                `Achievement unlocked: Coins Spent - ${threshold}`,
            );
        }
    });

    achievementValues.totalCoinsEarned.forEach((threshold) => {
        if (gameState.totalCoinsEarned >= threshold) {
            unlockAchievement(
                `totalCoinsEarned-${threshold}`,
                `Achievement unlocked: Coins Earned - ${threshold}`,
            );
        }
    });

    achievementValues.waterRefillsPurchased.forEach((threshold) => {
        if (gameState.waterRefillsPurchased >= threshold) {
            unlockAchievement(
                `waterRefillsPurchased-${threshold}`,
                `Achievement unlocked: Water Refills Purchased - ${threshold}`,
            );
        }
    });
}

const TOTAL_TIMED_QUESTS = 12;

function checkTimedQuestAchievements(gameState) {
    const beaten = Number(gameState.timedQuestsBeatenOnTime) || 0;

    const tiers = [
        { threshold: 1, id: 'timedQuestsBeaten-1', coins: 100, label: 'On the Clock' },
        { threshold: 3, id: 'timedQuestsBeaten-3', coins: 500, label: 'Time-Critical Operator' },
        { threshold: TOTAL_TIMED_QUESTS, id: 'timedQuestsBeaten-all', coins: 10000, label: 'Deadline Champion' },
    ];

    tiers.forEach(({ threshold, id, coins, label }) => {
        if (beaten >= threshold) {
            if (unlockAchievement(id, `Achievement unlocked: ${label}! You earned ${coins.toLocaleString()} coins.`)) {
                const currentState = getState();
                updateState({
                    coins: currentState.coins + coins,
                    totalCoinsEarned: currentState.totalCoinsEarned + coins,
                });
                runAchievementEffect('playCoinGainBurst', coins);
            }
        }
    });
}

function trackAchievements() {
    const gameState = getState();

    checkCropUnlocks(gameState);
    applyUpgradeUnlocks(gameState);
    checkGeneralAchievementMilestones(gameState);
    checkSeedsBoughtAchievements(gameState);
    checkCropsSoldAchievements(gameState);
    checkWaterRefillPurchaseAchievements(gameState);
    checkWaterRefillsAchievementsAndEnableButton(gameState);
    checkTimedQuestAchievements(gameState);
    trackQuestUnlocks(gameState);
    trackQuestAutoCompletions(gameState);
    checkMilestones();
}

function updateSeedsBought(cropType, amount) {
    const gameState = getState();
    const quantity = Math.max(0, Number(amount) || 0);
    const nextSeedsBoughtByCrop = {
        ...(gameState.progressByCrop?.seedsBoughtByCrop || {}),
        [cropType]: getCropSeedsBoughtCount(gameState, cropType) + quantity,
    };

    updateState({
        seedsBought: gameState.seedsBought + quantity,
        progressByCrop: {
            seedsBoughtByCrop: nextSeedsBoughtByCrop,
        },
    });

    trackAchievements();
}

function checkSeedsBoughtAchievements(currentState) {
    const gameState = currentState ?? getState();
    const seedThresholds = progressionConfig.achievements.seedsBought;

    cropTypes.forEach((cropType) => {
        const thresholds = seedThresholds[cropType] || [];
        const seedsBoughtCount = getCropSeedsBoughtCount(gameState, cropType);

        thresholds.forEach((threshold, index) => {
            if (seedsBoughtCount >= threshold) {
                unlockAchievement(
                    `${cropType}SeedsBought-${threshold}`,
                    `${getCropLabel(cropType)} seeds bought achievement unlocked: ${threshold}`,
                );
                runAchievementEffect('addBulkSeedButton', cropType, threshold, index + 1);
            }
        });
    });
}

function updateCropsSold(cropType, amount) {
    const gameState = getState();
    const quantity = Math.max(0, Number(amount) || 0);
    const nextCropsSoldByCrop = {
        ...(gameState.progressByCrop?.cropsSoldByCrop || {}),
        [cropType]: getCropSoldCount(gameState, cropType) + quantity,
    };

    updateState({
        cropsSold: gameState.cropsSold + quantity,
        progressByCrop: {
            cropsSoldByCrop: nextCropsSoldByCrop,
        },
    });

    trackAchievements();
}

function checkCropsSoldAchievements(currentState) {
    const gameState = currentState ?? getState();
    const cropThresholds = progressionConfig.achievements.cropsSold;
    const SELL_ALL_UNLOCK_THRESHOLD = 500;

    cropTypes.forEach((cropType) => {
        const thresholds = cropThresholds[cropType] || [];
        const cropSoldCount = getCropSoldCount(gameState, cropType);

        thresholds.forEach((threshold, index) => {
            if (cropSoldCount >= threshold) {
                unlockAchievement(
                    `${cropType}Sold-${threshold}`,
                    `${getCropLabel(cropType)} sold achievement unlocked: ${threshold}`,
                );
                runAchievementEffect('addBulkCropSaleButton', cropType, threshold, index + 1);
            }
        });

        if (cropSoldCount >= SELL_ALL_UNLOCK_THRESHOLD) {
            runAchievementEffect('addSellAllCropButton', cropType);
        }
    });
}

function checkWaterRefillPurchaseAchievements(currentState) {
    const gameState = currentState ?? getState();
    const thresholds = progressionConfig.achievements.waterRefillsPurchased;

    thresholds.forEach((threshold, index) => {
        if (gameState.waterRefillsPurchased >= threshold) {
            if (unlockAchievement(`waterRefillsPurchased-${threshold}`, `Water refill achievement unlocked: ${threshold}`)) {
                // no-op, unlock notification already emitted
            }

            runAchievementEffect('addBulkWaterRefillButton', threshold, index + 1);
        }
    });
}

function updateCoinsEarned(amount) {
    const gameState = getState();
    const newCoinsEarned = gameState.totalCoinsEarned + amount;
    updateState({ totalCoinsEarned: newCoinsEarned });
    trackAchievements();
}

function checkCropUnlocks(currentState) {
    const gameState = currentState ?? getState();
    const cropUnlocks = progressionConfig.unlocks.cropsByTotalCoinsEarned;
    const unlockedCropTypes = new Set(getUnlockedSeedTypes(gameState));
    let unlockedSeedCount = unlockedCropTypes.size;
    let fallowFatigueTutorialShown = Boolean(gameState.fallowFatigueTutorialShown);

    cropTypes
        .filter((cropType) => cropType !== 'wheat')
        .forEach((cropType) => {
            const unlockThreshold = Number(cropUnlocks[cropType]) || 0;
            const unlockKey = `${cropType}Unlocked`;

            if (unlockedCropTypes.has(cropType) || gameState.totalCoinsEarned < unlockThreshold) {
                return;
            }

            updateState({ [unlockKey]: true });
            unlockedCropTypes.add(cropType);
            unlockedSeedCount = unlockedCropTypes.size;

            announceAchievementUnlock(`${getCropLabel(cropType)} unlocked! You can now buy ${getCropLabel(cropType)} seeds.`);

            if (!fallowFatigueTutorialShown && unlockedSeedCount > 2) {
                runAchievementEffect(
                    'showNotification',
                    'Plot matrices can become inefficient and grumpy if fed the same crop data repeatedly. '
                    + 'Repeating a crop adds Rotation Fatigue steps, which increases fallow time. '
                    + 'Rotate crops to keep fatigue low and reduce downtime.',
                    'Rotation Advisory',
                    'unlock',
                );

                updateState({ fallowFatigueTutorialShown: true });
                fallowFatigueTutorialShown = true;
            }

            runAchievementEffect('showCropInStore', cropType);
            runAchievementEffect('showCropInResource', cropType);
            runAchievementEffect('updateToolboxDisplay');
        });
}

function checkWaterRefillsAchievementsAndEnableButton(currentState) {
    const gameState = currentState ?? getState();
    const thresholds = progressionConfig.achievements.waterRefillsPurchased;

    thresholds.forEach((threshold) => {
        if (gameState.waterRefillsPurchased < threshold) {
            return;
        }

        runAchievementEffect('enableWaterUpgradeButton');
    });
}

export {
    configureAchievementHandlerAdapters,
    trackAchievements,
    getAchievementValues,
    updateSeedsBought,
    checkSeedsBoughtAchievements,
    updateCropsSold,
    checkCropsSoldAchievements,
    checkWaterRefillPurchaseAchievements,
    updateCoinsEarned,
    checkCropUnlocks,
};
