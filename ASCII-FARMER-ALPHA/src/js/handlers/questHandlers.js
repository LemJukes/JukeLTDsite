import { getActiveNodeState as getState, updateActiveNodeState as updateState, incrementTotalClicks, getWorldState, dispatchWorldAction } from "../worldState.js";
import { trackAchievements } from "./achievementHandlers.js";
import { getQuestDefinitions, getQuestDefinitionById } from "../configs/questConfig.js";
import { getCropIds, getCropLabel as getConfiguredCropLabel } from "../configs/cropConfig.js";
import { checkMilestones } from "../world/milestones.js";
import { getCropInventoryCount, getCropSoldCount } from '../state/nodeCropView.js';

const QUESTS_UPDATED_EVENT = 'quests:updated';
const cropTypes = getCropIds();

const QUEST_REWARD_TYPES = {
    DOUBLE_SALE_PRICE: 'doubleSalePrice',
    FEATURE_UNLOCK: 'featureUnlock',
};

const QUEST_DECLINE_STEP = 2;

const DEFAULT_QUEST_EFFECTS = {
    getStoreValues: () => ({}),
    showConfirmation: () => Promise.resolve(false),
    showDialog: () => Promise.resolve(false),
    showQuestUnlockDialog: () => Promise.resolve(false),
    showNotification: () => {},
    updateResourceBar: () => {},
    updateClicksDisplay: () => {},
    playCoinGainBurst: () => {},
    setNetworkIconGlow: () => {},
    syncNetworkIconVisibility: () => {},
    emitQuestUpdate: () => {},
};

let questEffects = { ...DEFAULT_QUEST_EFFECTS };

function configureQuestHandlerAdapters(adapters = {}) {
    const nextEffects = { ...questEffects };
    Object.entries(adapters).forEach(([name, fn]) => {
        if (typeof fn === 'function') {
            nextEffects[name] = fn;
        }
    });

    questEffects = nextEffects;
}

function runQuestEffect(name, ...args) {
    const effectFn = questEffects[name];
    if (typeof effectFn === 'function') {
        return effectFn(...args);
    }

    return undefined;
}

function getQuestTimerConfig(quest) {
    const deliveryWindowMs = Math.max(0, Number(quest?.deliveryWindowMs) || 0);
    if (deliveryWindowMs < 1) {
        return null;
    }

    const minPercent = Math.max(0, Number(quest?.lateFeeMinPercent) || 0);
    const maxPercent = Math.max(minPercent, Number(quest?.lateFeeMaxPercent) || minPercent);

    return {
        deliveryWindowMs,
        minPercent,
        maxPercent,
    };
}

function getRandomIntInclusive(min, max) {
    const normalizedMin = Math.ceil(min);
    const normalizedMax = Math.floor(max);
    if (normalizedMax <= normalizedMin) {
        return normalizedMin;
    }

    return Math.floor(Math.random() * (normalizedMax - normalizedMin + 1)) + normalizedMin;
}

function formatDurationMs(durationMs) {
    const totalSeconds = Math.max(0, Math.floor((Number(durationMs) || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getNormalizedOffset(offset) {
    return cropTypes.reduce((normalized, cropType) => {
        normalized[cropType] = Math.max(0, Number(offset?.[cropType]) || 0);
        return normalized;
    }, {});
}

function addOffsets(baseOffset, addOffset) {
    const base = getNormalizedOffset(baseOffset);
    const addition = getNormalizedOffset(addOffset);

    return cropTypes.reduce((combined, cropType) => {
        combined[cropType] = (base[cropType] || 0) + (addition[cropType] || 0);
        return combined;
    }, {});
}

function hasOffset(offset) {
    const normalized = getNormalizedOffset(offset);
    return cropTypes.some((cropType) => normalized[cropType] > 0);
}

function getQuestUnlockRequirementState(gameState, quest) {
    const unlockCondition = quest?.unlockCondition;
    if (!unlockCondition || unlockCondition.type !== 'cropsSold') {
        return null;
    }

    const globalOffset = getNormalizedOffset(gameState.questUnlockThresholdOffset);
    const pendingOffset = gameState.questProgressionPaused && gameState.questBlockedQuestId === quest.id
        ? getNormalizedOffset(gameState.questPendingDeclineOffset)
        : getNormalizedOffset(null);

    const effectiveRequirements = {};
    const baseRequirements = {};

    cropTypes.forEach((cropType) => {
        const base = Math.max(0, Number(unlockCondition.requirements?.[cropType]) || 0);
        const globalAmount = globalOffset[cropType] || 0;
        const pendingAmount = pendingOffset[cropType] || 0;

        baseRequirements[cropType] = base;
        effectiveRequirements[cropType] = base + globalAmount + pendingAmount;
    });

    return {
        baseRequirements,
        globalOffset,
        pendingOffset,
        effectiveRequirements,
    };
}

function getDeclineStepOffset() {
    return cropTypes.reduce((offset, cropType) => {
        offset[cropType] = QUEST_DECLINE_STEP;
        return offset;
    }, {});
}

function getUnlockTargetMessage(quest, gameState) {
    const unlockState = getQuestUnlockRequirementState(gameState, quest);
    if (!unlockState) {
        return '';
    }

    const parts = cropTypes
        .filter((cropType) => Number(unlockState.effectiveRequirements[cropType]) > 0)
        .map((cropType) => `${unlockState.effectiveRequirements[cropType]} ${getCropLabel(cropType)}`);
    return parts.join(', ');
}

function getQuestDeclineCount(gameState, questId) {
    return Math.max(0, Number(gameState.questProgress?.[questId]?.declinedCount) || 0);
}

function getPauseReleaseState(gameState, completedQuestId) {
    if (!gameState.questProgressionPaused || gameState.questBlockedQuestId !== completedQuestId) {
        return null;
    }

    const pending = getNormalizedOffset(gameState.questPendingDeclineOffset);
    return {
        questUnlockThresholdOffset: addOffsets(gameState.questUnlockThresholdOffset, pending),
        questPendingDeclineOffset: getNormalizedOffset(null),
        questProgressionPaused: false,
        questBlockedQuestId: null,
    };
}

function isQuestUnlocked(gameState, questId) {
    return Array.isArray(gameState.questsUnlocked) && gameState.questsUnlocked.includes(questId);
}

function isQuestCompleted(gameState, questId) {
    return Array.isArray(gameState.questsCompleted) && gameState.questsCompleted.includes(questId);
}

function isQuestActive(gameState, questId) {
    return Array.isArray(gameState.questsActive) && gameState.questsActive.includes(questId);
}

function getCropLabel(cropType) {
    return getConfiguredCropLabel(cropType, { plural: true });
}

export function confirmQuestCancellation(questId) {
    const gameState = getState();
    const quest = getQuestDefinitionById(questId);

    if (!quest || !isQuestActive(gameState, questId)) {
        runQuestEffect('showNotification', 'That request is not currently active.', 'Quests');
        return Promise.resolve(false);
    }

    if (quest.autoComplete) {
        runQuestEffect('showNotification', 'This request cannot be declined.', 'Quests');
        return Promise.resolve(false);
    }

    const prompt = `Cancel contract for ${quest.name}?`;
    return runQuestEffect('showConfirmation', prompt, { title: 'Cancel Contract' })
        .then((confirmed) => {
            if (!confirmed) {
                return false;
            }

            return declineQuest(questId);
        });
}

function hasMetUnlockCondition(gameState, quest) {
    const unlockCondition = quest.unlockCondition;
    if (!unlockCondition) {
        return true;
    }

    if (unlockCondition.requiresQuestCompleted) {
        const requiredQuestId = unlockCondition.requiresQuestCompleted;
        if (!isQuestCompleted(gameState, requiredQuestId)) {
            return false;
        }
    }

    if (unlockCondition.type !== 'cropsSold') {
        return false;
    }

    const unlockState = getQuestUnlockRequirementState(gameState, quest);
    return cropTypes.every((cropType) => {
        const requiredAmount = Number(unlockState?.effectiveRequirements?.[cropType]) || 0;
        if (requiredAmount < 1) {
            return true;
        }

        return getCropSoldCount(gameState, cropType) >= requiredAmount;
    });
}

function unlockQuest(questId) {
    const quest = getQuestDefinitionById(questId);
    if (!quest) {
        return false;
    }

    const gameState = getState();
    if (isQuestUnlocked(gameState, questId) || isQuestCompleted(gameState, questId)) {
        return false;
    }

    const timerConfig = getQuestTimerConfig(quest);

    const questProgressEntry = {
        ...(gameState.questProgress?.[questId] || {}),
        unlockedAt: Date.now(),
    };
    if (!quest.autoComplete) {
        questProgressEntry.acceptedAt = Date.now();
    }
    if (timerConfig) {
        questProgressEntry.deliveryWindowMs = timerConfig.deliveryWindowMs;
    }

    updateState({
        questsUnlocked: [...gameState.questsUnlocked, questId],
        questsActive: isQuestActive(gameState, questId)
            ? [...gameState.questsActive]
            : [...gameState.questsActive, questId],
        questProgress: {
            ...gameState.questProgress,
            [questId]: questProgressEntry,
        },
    });

    runQuestEffect('emitQuestUpdate');
    runQuestEffect('showQuestUnlockDialog', quest)
        .then((action) => {
            if (action === 'cancel-contract') {
                void confirmQuestCancellation(quest.id);
            }
        });
    return true;
}

function trackQuestUnlocks(currentState) {
    const gameState = currentState ?? getState();

    if (gameState.questProgressionPaused && gameState.questBlockedQuestId) {
        const blockedQuest = getQuestDefinitionById(gameState.questBlockedQuestId);
        if (!blockedQuest || isQuestCompleted(gameState, blockedQuest.id) || isQuestActive(gameState, blockedQuest.id)) {
            return;
        }

        if (hasMetUnlockCondition(gameState, blockedQuest)) {
            unlockQuest(blockedQuest.id);
        }
        return;
    }

    getQuestDefinitions().forEach((quest) => {
        if (isQuestUnlocked(gameState, quest.id) || isQuestCompleted(gameState, quest.id)) {
            return;
        }

        if (hasMetUnlockCondition(gameState, quest)) {
            unlockQuest(quest.id);
        }
    });
}

function declineQuest(questId) {
    const gameState = getState();
    const quest = getQuestDefinitionById(questId);

    if (!quest || !isQuestActive(gameState, questId)) {
        runQuestEffect('showNotification', 'That request is not currently active.', 'Quests');
        return false;
    }

    if (quest.autoComplete) {
        runQuestEffect('showNotification', 'This request cannot be declined.', 'Quests');
        return false;
    }

    const nextPendingOffset = addOffsets(gameState.questPendingDeclineOffset, getDeclineStepOffset());
    const nextDeclinedCount = getQuestDeclineCount(gameState, questId) + 1;
    const nextQuestProgress = {
        ...gameState.questProgress,
        [questId]: {
            ...(gameState.questProgress?.[questId] || {}),
            declinedAt: Date.now(),
            declinedCount: nextDeclinedCount,
        },
    };

    updateState({
        questsActive: gameState.questsActive.filter((id) => id !== questId),
        questsUnlocked: gameState.questsUnlocked.filter((id) => id !== questId),
        questProgress: nextQuestProgress,
        questProgressionPaused: true,
        questBlockedQuestId: questId,
        questPendingDeclineOffset: nextPendingOffset,
    });

    runQuestEffect('emitQuestUpdate');

    runQuestEffect('showNotification', `${quest.name} contract canceled.`, 'Contract Canceled', 'quest');

    trackAchievements();
    return true;
}

function getQuestRequirementRows(questId, currentState) {
    const quest = getQuestDefinitionById(questId);
    const gameState = currentState ?? getState();
    if (!quest) {
        return [];
    }

    return cropTypes.reduce((rows, cropType) => {
        const requiredAmount = Number(quest.requirements?.[cropType]) || 0;
        if (requiredAmount < 1) {
            return rows;
        }

        const currentAmount = getCropInventoryCount(gameState, cropType);
        rows.push({
            cropType,
            label: getCropLabel(cropType),
            currentAmount,
            requiredAmount,
            isReady: currentAmount >= requiredAmount,
        });

        return rows;
    }, []);
}

function canDeliverQuest(questId, currentState) {
    const quest = getQuestDefinitionById(questId);
    if (quest?.autoComplete) {
        return false;
    }

    const requirementRows = getQuestRequirementRows(questId, currentState);
    if (!requirementRows.length) {
        return false;
    }

    return requirementRows.every((row) => row.isReady);
}

function calculateQuestPayout(questId) {
    const quest = getQuestDefinitionById(questId);
    if (!quest) {
        return 0;
    }

    const storeValues = runQuestEffect('getStoreValues') || {};
    const priceKeyByCrop = {
        wheat: 'wheatPrice',
        corn: 'cornPrice',
        tomato: 'tomatoPrice',
    };

    return cropTypes.reduce((total, cropType) => {
        const requiredAmount = Number(quest.requirements?.[cropType]) || 0;
        if (requiredAmount < 1) {
            return total;
        }

        const priceKey = priceKeyByCrop[cropType];
        const storePrice = Math.max(0, Number(storeValues[priceKey]) || 0);
        return total + (requiredAmount * storePrice * 2);
    }, 0);
}

function getRewardSummary(questId) {
    const quest = getQuestDefinitionById(questId);
    if (!quest) {
        return '';
    }

    if (quest.autoComplete) {
        return quest.reward?.description || 'Unlocks new feature';
    }

    const payout = calculateQuestPayout(questId);
    const payoutText = `${payout} coins total (2x store sale value)`;
    const timerConfig = getQuestTimerConfig(quest);
    const timedPenaltyText = timerConfig
        ? ` Late deliveries reduce payout by ${timerConfig.minPercent}-${timerConfig.maxPercent}%.`
        : '';

    if (quest.reward?.type === QUEST_REWARD_TYPES.DOUBLE_SALE_PRICE) {
        return `${payoutText}.${timedPenaltyText}`.trim();
    }

    if (quest.reward?.description) {
        return `${quest.reward.description} + ${payoutText}.${timedPenaltyText}`.trim();
    }

    return `${payoutText}.${timedPenaltyText}`.trim();
}

function applyQuestReward(quest) {
    if (!quest?.reward?.type) {
        return;
    }

    const gameState = getState();
    const questId = quest.id;
    const nextQuestProgress = {
        ...gameState.questProgress,
        [questId]: {
            ...(gameState.questProgress?.[questId] || {}),
            rewardAppliedAt: Date.now(),
        },
    };

    updateState({
        questProgress: nextQuestProgress,
    });

    if (quest.reward.type === QUEST_REWARD_TYPES.FEATURE_UNLOCK && quest.reward.feature === 'netSpace') {
        dispatchWorldAction({
            type: 'world.patch',
            payload: {
                updates: {
                    netSpaceUnlocked: true,
                },
            },
            meta: { source: 'questHandlers.applyQuestReward.featureUnlock' },
        });
        runQuestEffect('syncNetworkIconVisibility');
        runQuestEffect('setNetworkIconGlow', !getWorldState().tutorialFlags?.netSpaceTutorialShown);
    }
}

function getQuestDisplayData(questId, currentState) {
    const quest = getQuestDefinitionById(questId);
    const gameState = currentState ?? getState();
    if (!quest) {
        return null;
    }

    const unlockState = getQuestUnlockRequirementState(gameState, quest);

    const timerConfig = getQuestTimerConfig(quest);
    const acceptedAt = Number(gameState.questProgress?.[questId]?.acceptedAt) || 0;
    const elapsedMs = acceptedAt > 0 ? Math.max(0, Date.now() - acceptedAt) : 0;
    const remainingMs = timerConfig ? Math.max(0, timerConfig.deliveryWindowMs - elapsedMs) : 0;
    const isLateDelivery = Boolean(timerConfig && acceptedAt > 0 && elapsedMs > timerConfig.deliveryWindowMs);

    return {
        ...quest,
        requirementRows: getQuestRequirementRows(questId, gameState),
        rewardSummary: getRewardSummary(questId),
        canDeliver: canDeliverQuest(questId, gameState),
        canDecline: !quest.autoComplete,
        isCompleted: isQuestCompleted(gameState, questId),
        isActive: isQuestActive(gameState, questId),
        isBlockedQuest: gameState.questProgressionPaused && gameState.questBlockedQuestId === questId,
        unlockTargetSummary: unlockState
            ? cropTypes.map((cropType) => `${unlockState.effectiveRequirements[cropType]} ${getCropLabel(cropType)}`).join(', ')
            : '',
        isTimedQuest: Boolean(timerConfig),
        deliveryWindowLabel: timerConfig ? formatDurationMs(timerConfig.deliveryWindowMs) : '',
        lateFeeRangeLabel: timerConfig ? `${timerConfig.minPercent}-${timerConfig.maxPercent}%` : '',
        timeRemainingLabel: timerConfig ? formatDurationMs(remainingMs) : '',
        isLateDelivery,
    };
}

function getQuestPanelData(currentState) {
    const gameState = currentState ?? getState();
    const activeQuestIds = Array.isArray(gameState.questsActive) ? [...gameState.questsActive] : [];
    const blockedQuest = gameState.questBlockedQuestId
        ? getQuestDefinitionById(gameState.questBlockedQuestId)
        : null;

    return {
        unlockedCount: Array.isArray(gameState.questsUnlocked) ? gameState.questsUnlocked.length : 0,
        completedCount: Array.isArray(gameState.questsCompleted) ? gameState.questsCompleted.length : 0,
        progressionPaused: Boolean(gameState.questProgressionPaused),
        blockedQuestName: blockedQuest?.name || '',
        blockedQuestUnlockTarget: blockedQuest ? getUnlockTargetMessage(blockedQuest, gameState) : '',
        pendingOffsetSummary: hasOffset(gameState.questPendingDeclineOffset)
            ? cropTypes.map((cropType) => `+${getNormalizedOffset(gameState.questPendingDeclineOffset)[cropType]} ${getCropLabel(cropType)}`).join(', ')
            : '',
        activeQuests: activeQuestIds
            .map((questId) => getQuestDisplayData(questId, gameState))
            .filter(Boolean),
    };
}

function hasMetCompletionCondition(gameState, quest) {
    const cc = quest.completionCondition;
    if (!cc) {
        return false;
    }

    return false;
}

function autoCompleteQuest(questId) {
    const quest = getQuestDefinitionById(questId);
    const gameState = getState();
    if (!quest || !isQuestActive(gameState, questId)) {
        return false;
    }

    const nextQuestProgress = {
        ...gameState.questProgress,
        [questId]: {
            ...(gameState.questProgress?.[questId] || {}),
            completedAt: Date.now(),
        },
    };
    const pauseReleaseState = getPauseReleaseState(gameState, questId);

    updateState({
        questsActive: gameState.questsActive.filter((id) => id !== questId),
        questsCompleted: [...gameState.questsCompleted, questId],
        questProgress: nextQuestProgress,
        ...(pauseReleaseState || {}),
    });

    applyQuestReward(quest);
    runQuestEffect('emitQuestUpdate');
    runQuestEffect('showNotification', `${quest.name} complete! ${quest.reward?.description || ''}.`, 'Quest Complete', 'quest');
    return true;
}

function trackQuestAutoCompletions(currentState) {
    const gameState = currentState ?? getState();

    getQuestDefinitions().forEach((quest) => {
        if (!quest.autoComplete) {
            return;
        }

        if (!isQuestActive(gameState, quest.id)) {
            return;
        }

        if (hasMetCompletionCondition(gameState, quest)) {
            autoCompleteQuest(quest.id);
        }
    });
}

function deliverQuest(questId) {
    const quest = getQuestDefinitionById(questId);
    const gameState = getState();
    if (!quest || !isQuestActive(gameState, questId)) {
        runQuestEffect('showNotification', 'That request is not currently active.', 'Quests');
        return false;
    }

    if (!canDeliverQuest(questId, gameState)) {
        runQuestEffect('showNotification', 'You do not have the full harvest ready yet.', 'Quests');
        return false;
    }

    const grossPayout = calculateQuestPayout(questId);
    const timerConfig = getQuestTimerConfig(quest);
    const acceptedAt = Number(gameState.questProgress?.[questId]?.acceptedAt) || 0;
    const deliveredAt = Date.now();

    let wasLate = false;
    let lateFeePercent = 0;
    let lateFeeAmount = 0;
    let payout = grossPayout;

    if (timerConfig && acceptedAt > 0) {
        const elapsedMs = Math.max(0, deliveredAt - acceptedAt);
        if (elapsedMs > timerConfig.deliveryWindowMs) {
            wasLate = true;
            lateFeePercent = getRandomIntInclusive(timerConfig.minPercent, timerConfig.maxPercent);
            lateFeeAmount = Math.floor((grossPayout * lateFeePercent) / 100);
            payout = Math.max(0, grossPayout - lateFeeAmount);
        }
    }

    const requirementRows = getQuestRequirementRows(questId, gameState);
    const totalDelivered = requirementRows.reduce((sum, row) => sum + row.requiredAmount, 0);
    const nextQuestProgress = {
        ...gameState.questProgress,
        [questId]: {
            ...(gameState.questProgress?.[questId] || {}),
            completedAt: deliveredAt,
            deliveredAt,
            wasLate,
            lateFeePercent,
            lateFeeAmount,
            grossPayout,
            netPayout: payout,
        },
    };
    const pauseReleaseState = getPauseReleaseState(gameState, questId);

    updateState({
        coins: gameState.coins + payout,
        totalCoinsEarned: gameState.totalCoinsEarned + payout,
        totalCoinsFromQuests: (Number(gameState.totalCoinsFromQuests) || 0) + payout,
        wheat: gameState.wheat - (Number(quest.requirements?.wheat) || 0),
        corn: gameState.corn - (Number(quest.requirements?.corn) || 0),
        tomato: gameState.tomato - (Number(quest.requirements?.tomato) || 0),
        questsActive: gameState.questsActive.filter((activeQuestId) => activeQuestId !== questId),
        questsCompleted: [...gameState.questsCompleted, questId],
        questProgress: nextQuestProgress,
        ...(pauseReleaseState || {}),
        ...(timerConfig && !wasLate ? { timedQuestsBeatenOnTime: (Number(gameState.timedQuestsBeatenOnTime) || 0) + 1 } : {}),
    });

    runQuestEffect('playCoinGainBurst', payout);

    if (wasLate) {
        runQuestEffect(
            'showNotification',
            `${quest.name} delivered late. ${lateFeePercent}% fee applied (${lateFeeAmount} coins). Final payout: ${payout} coins.`,
            'Quest Complete',
            'quest',
        );
    } else {
        runQuestEffect('showNotification', `${quest.name} delivered for ${payout} coins.`, 'Quest Complete', 'quest');
    }

    applyQuestReward(quest);
    checkMilestones();

    runQuestEffect('updateResourceBar');
    trackAchievements();
    incrementTotalClicks();
    runQuestEffect('updateClicksDisplay');
    runQuestEffect('emitQuestUpdate');
    return true;
}

export {
    QUESTS_UPDATED_EVENT,
    configureQuestHandlerAdapters,
    trackQuestUnlocks,
    trackQuestAutoCompletions,
    unlockQuest,
    declineQuest,
    canDeliverQuest,
    calculateQuestPayout,
    getQuestDisplayData,
    getQuestPanelData,
    deliverQuest,
};