import {
    clearSnapshot,
    createPersistenceBackup,
    loadSnapshot,
    restorePersistenceBackup,
    savePartialSnapshot,
} from '../persistence.js';
import { initializeWorldState as applyStateSnapshot, getActiveNodeState as getState, getWorldSaveSnapshot as getStateSnapshot, updateActiveNodeState as updateState } from '../worldState.js';
import {
    applyStoreValuesSnapshot,
    getStoreValuesSnapshot,
} from '../ui/store.js';
import {
    applyUpgradeValuesSnapshot,
    getUpgradeValuesSnapshot,
    updateUpgradeValues,
} from '../ui/upgrades.js';
import { refreshQuestWindow } from '../ui/quests.js';
import { updateField, refreshFieldTitlebarControl } from '../ui/field.js';
import { updateResourceBar } from '../ui/resource.js';
import { trackAchievements } from '../handlers/achievementHandlers.js';
import { deliverQuest } from '../handlers/questHandlers.js';
import { progressionConfig } from '../configs/progressionConfig.js';
import { getCropConfig, getCropIds, getCropLabel } from '../configs/cropConfig.js';
import { getQuestDefinitions } from '../configs/questConfig.js';
import { TOOLS } from '../configs/toolConfig.js';
import { selectSeedType, selectTool } from '../ui/toolbox.js';
import { getCropInventoryCount, getCropSeedCount, isCropUnlocked } from '../state/nodeCropView.js';

const DEV_API_NAME = '__asciiFarmerDev';
const DEV_STORAGE_KEYS = [
    'colorScheme',
    'optionsWindowCollapsed',
    'statsWindowCollapsed',
    'achievementsWindowCollapsed',
];
const QUEST_SMOKE_ID = 'produce-for-gigagrocery';
const DEFAULT_AUDIT_CLICKS_PER_MINUTE = 120;

let lastSmokeReport = null;
let lastFewestClicksAuditReport = null;
let activeRunPromise = null;
let activeFewestClicksAuditPromise = null;

function isPrivateNetworkHostname(hostname = '') {
    return /^10\./.test(hostname)
        || /^192\.168\./.test(hostname)
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

function isLocalDevEnvironment() {
    if (typeof window === 'undefined' || !window.location) {
        return false;
    }

    const { protocol, hostname, search } = window.location;
    const normalizedHostname = String(hostname || '').toLowerCase();
    const params = new URLSearchParams(search || '');

    if (params.get('devSmoke') === '1') {
        return true;
    }

    if (protocol === 'file:' || protocol.startsWith('vscode-')) {
        return true;
    }

    return normalizedHostname === 'localhost'
        || normalizedHostname === '127.0.0.1'
        || normalizedHostname === '0.0.0.0'
        || normalizedHostname === '::1'
        || normalizedHostname === '[::1]'
        || normalizedHostname.endsWith('.local')
        || normalizedHostname.endsWith('.lan')
        || isPrivateNetworkHostname(normalizedHostname);
}

function nextUiTick() {
    return new Promise((resolve) => {
        if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
            setTimeout(resolve, 16);
            return;
        }

        window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
    });
}

function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function createCropCountMap(overrides = {}) {
    const cropIds = getCropIds();
    return Object.fromEntries(cropIds.map((cropId) => [cropId, Math.max(0, Number(overrides[cropId]) || 0)]));
}

function createUnlockedCropList(unlockedCropIds = []) {
    const cropIds = new Set(getCropIds());
    const unlocked = new Set(['wheat']);

    (Array.isArray(unlockedCropIds) ? unlockedCropIds : []).forEach((cropId) => {
        if (cropIds.has(cropId)) {
            unlocked.add(cropId);
        }
    });

    return [...unlocked];
}

async function waitFor(predicate, timeoutMs = 3000, intervalMs = 50) {
    const startedAt = Date.now();

    while ((Date.now() - startedAt) <= timeoutMs) {
        const result = await predicate();
        if (result) {
            return result;
        }

        await sleep(intervalMs);
    }

    throw new Error(`Timed out after ${timeoutMs}ms.`);
}

function captureStorageValues(keys) {
    const values = {};

    if (typeof window === 'undefined' || !window.localStorage) {
        return values;
    }

    keys.forEach((key) => {
        values[key] = window.localStorage.getItem(key);
    });

    return values;
}

function restoreStorageValues(values = {}) {
    if (typeof window === 'undefined' || !window.localStorage) {
        return;
    }

    Object.entries(values).forEach(([key, value]) => {
        if (typeof value === 'string') {
            window.localStorage.setItem(key, value);
            return;
        }

        window.localStorage.removeItem(key);
    });
}

function syncDarkModeButtonState() {
    const button = document.getElementById('dark-mode-toggle');
    if (!button) {
        return;
    }

    const isDark = document.body.classList.contains('dark');
    button.textContent = isDark ? '☼' : '☽';
    button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    button.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
}

function syncUi() {
    updateField();
    refreshFieldTitlebarControl();
    refreshQuestWindow();
    updateResourceBar();
    syncDarkModeButtonState();
}

function captureRuntimeBackup() {
    return {
        persistenceBackup: createPersistenceBackup(),
        storageValues: captureStorageValues(DEV_STORAGE_KEYS),
        bodyClassName: document.body.className,
        stateSnapshot: getStateSnapshot(),
        storeSnapshot: getStoreValuesSnapshot(),
        upgradeSnapshot: getUpgradeValuesSnapshot(),
    };
}

function restoreRuntimeBackup(backup) {
    if (!backup) {
        return;
    }

    applyStateSnapshot(backup.stateSnapshot);
    applyStoreValuesSnapshot(backup.storeSnapshot);
    applyUpgradeValuesSnapshot(backup.upgradeSnapshot);
    document.body.className = backup.bodyClassName || '';
    syncUi();
    restoreStorageValues(backup.storageValues);
    restorePersistenceBackup(backup.persistenceBackup);
}

function buildCleanPlotState() {
    return {
        symbol: '~',
        cropType: null,
        waterCount: 0,
        disabledUntil: 0,
        lastUpdatedAt: Date.now(),
        destroyed: false,
    };
}

function getActiveFieldContext() {
    const gameState = getState();
    const activeFieldId = gameState.activeFieldId;
    const activeField = gameState.fields?.[activeFieldId];

    assert(activeField && Array.isArray(activeField.plotStates), 'Active field is unavailable for smoke testing.');

    return {
        gameState,
        activeFieldId,
        activeField,
    };
}

function prepareSmokeBaseline() {
    clearSnapshot();

    const { gameState, activeFieldId, activeField } = getActiveFieldContext();
    const plotCount = Math.max(9, Number(activeField?.plots) || 9);
    const nextPlotStates = Array.from({ length: plotCount }, () => buildCleanPlotState());

    updateState({
        coins: 5000,
        water: 50,
        waterCapacity: 100,
        inventory: {
            seedsByCrop: createCropCountMap({ wheat: 1 }),
            cropsById: createCropCountMap(),
        },
        progressByCrop: {
            seedsBoughtByCrop: createCropCountMap(),
            cropsSoldByCrop: createCropCountMap(),
        },
        unlocks: {
            crops: createUnlockedCropList(['wheat']),
        },
        totalCoinsSpent: 0,
        totalCoinsEarned: 0,
        cropsSold: 0,
        seedsBought: 0,
        waterRefillsPurchased: 0,
        questsUnlocked: [],
        questsActive: [],
        questsCompleted: [],
        questProgress: {},
        totalCoinsFromQuests: 0,
        timedQuestsBeatenOnTime: 0,
        totalClicksClicked: 0,
        achievementsUnlocked: [],
        questProgressionPaused: false,
        questBlockedQuestId: null,
        questPendingDeclineOffset: null,
        questUnlockThresholdOffset: null,
        plotSelectionMode: null,
        selectedTool: TOOLS.PLOW,
        selectedSeedType: 'wheat',
        fields: {
            ...gameState.fields,
            [activeFieldId]: {
                ...activeField,
                plots: plotCount,
                plotStates: nextPlotStates,
            },
        },
    });

    // Start smoke checks from a deterministic upgrade baseline so late-game
    // save data does not leak expanded-click or auto-changer behavior into
    // manual interaction assertions.
    applyUpgradeValuesSnapshot({});
    applyStoreValuesSnapshot(getStoreValuesSnapshot());
    updateUpgradeValues({
        waterAutoBuyerUnlocked: true,
        waterAutoBuyerEnabled: false,
    });
    syncUi();
}

function getStoreActionButton(sectionId, labelText = null) {
    const section = document.getElementById(sectionId);
    assert(section, `Store section ${sectionId} is missing.`);

    const actionButtons = Array.from(section.querySelectorAll('.store-button')).filter(
        (button) => !button.classList.contains('store-section-collapse-btn'),
    );

    if (!labelText) {
        return actionButtons[0] || null;
    }

    return actionButtons.find((button) => button.textContent.trim() === labelText) || null;
}

async function clickElement(element, description) {
    assert(element, `${description} is missing.`);
    assert(!element.disabled, `${description} is disabled.`);
    element.click();
    await nextUiTick();
}

function getPlotButton(plotIndex) {
    const plotButtons = Array.from(document.querySelectorAll('.plotButton'));
    return plotButtons[plotIndex] || null;
}

function getCurrentPlotState(plotIndex) {
    const { gameState, activeFieldId } = getActiveFieldContext();
    return gameState.fields?.[activeFieldId]?.plotStates?.[plotIndex] || null;
}

function getQuestDeliverButton() {
    return document.querySelector('.quest-deliver-button');
}

function getVisibleState(id) {
    const element = document.getElementById(id);
    return element ? element.style.display !== 'none' : false;
}

async function runStep(report, name, fn) {
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const step = {
        name,
        ok: false,
        details: '',
        durationMs: 0,
    };

    try {
        const result = await fn();
        step.ok = true;
        step.details = typeof result === 'string' ? result : 'Passed';
    } catch (error) {
        step.ok = false;
        step.details = error instanceof Error ? error.message : String(error);
        report.failures.push({
            step: name,
            message: step.details,
        });
    } finally {
        const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        step.durationMs = Math.round(finishedAt - startedAt);
        report.steps.push(step);
    }
}

function summarizeReport(report) {
    const passed = report.steps.filter((step) => step.ok).length;
    const failed = report.steps.length - passed;

    report.ok = failed === 0;
    report.summary = {
        total: report.steps.length,
        passed,
        failed,
        durationMs: Math.round(Date.now() - report.startedAtMs),
    };

    return report;
}

function logReport(report) {
    const heading = report.ok
        ? '[ASCII FARMER DEV] Smoke test passed'
        : '[ASCII FARMER DEV] Smoke test found issues';

    console.groupCollapsed(heading);
    console.table(report.steps.map((step) => ({
        Step: step.name,
        Status: step.ok ? 'PASS' : 'FAIL',
        'Duration (ms)': step.durationMs,
        Details: step.details,
    })));

    if (!report.ok) {
        console.error('Smoke test failures:', report.failures);
    }

    console.info('Smoke test summary:', report.summary);
    console.groupEnd();
}

async function runSmokeScenario(report) {
    await runStep(report, 'Prepare isolated baseline', async () => {
        prepareSmokeBaseline();
        const gameState = getState();
        assert(gameState.coins === 5000, 'Smoke baseline did not reset coins.');
        assert(getCropSeedCount(gameState, 'wheat') >= 1, 'Smoke baseline did not provision starter wheat seeds.');
        return 'Disposable smoke state prepared.';
    });

    await runStep(report, 'Render core player UI', async () => {
        assert(document.getElementById('store'), 'Store container did not render.');
        assert(document.getElementById('toolbox-container'), 'Toolbox container did not render.');
        assert(document.querySelectorAll('.plotButton').length > 0, 'Field plot buttons did not render.');
        assert(document.querySelector('.mac-window') || document.getElementById('mac-window-store'), 'Mac window wrappers are missing.');
        return 'Store, toolbox, field, and mac-window UI are present.';
    });

    await runStep(report, 'Run crop planting, growth, harvest, and sale loop', async () => {
        const wheatSeedsBefore = getCropSeedCount(getState(), 'wheat');
        await clickElement(getStoreActionButton('buyWheatSeedsSection'), 'Buy Wheat Seeds button');
        assert(getCropSeedCount(getState(), 'wheat') === (wheatSeedsBefore + 1), 'Buying wheat seeds did not update inventory.');

        selectTool(TOOLS.PLOW);
        await nextUiTick();
        await clickElement(getPlotButton(0), 'Plot 1 button while plowing');
        assert(getCurrentPlotState(0)?.symbol === '=', 'Plowing did not prepare the plot for seeds.');

        selectTool(TOOLS.SEED_BAG);
        selectSeedType('wheat');
        await nextUiTick();
        await clickElement(getPlotButton(0), 'Plot 1 button while planting');
        assert(getCurrentPlotState(0)?.cropType === 'wheat', 'Planting did not assign wheat to the plot.');

        selectTool(TOOLS.WATERING_CAN);
        await nextUiTick();
        for (let i = 0; i < 4; i += 1) {
            await clickElement(getPlotButton(0), `Plot 1 button while watering (${i + 1}/4)`);
        }
        assert(getCurrentPlotState(0)?.symbol === '¥', 'Wheat did not reach the harvest-ready symbol after watering.');

        selectTool(TOOLS.SCYTHE);
        await nextUiTick();
        const harvestedBefore = getCropInventoryCount(getState(), 'wheat');
        await clickElement(getPlotButton(0), 'Plot 1 button while harvesting');
        assert(getCropInventoryCount(getState(), 'wheat') === (harvestedBefore + 1), 'Harvesting did not add wheat to inventory.');

        const coinsBeforeSale = Number(getState().coins) || 0;
        await clickElement(getStoreActionButton('sellWheatSection'), 'Sell Wheat button');
        assert((Number(getState().coins) || 0) > coinsBeforeSale, 'Selling wheat did not increase coins.');

        return 'Manual crop loop works through the same player-facing interactions.';
    });

    await runStep(report, 'Unlock crops and refresh progression UI', async () => {
        const unlocks = progressionConfig.unlocks.cropsByTotalCoinsEarned;
        const cropIds = ['corn', 'tomato', 'potato', 'carrot'];

        for (const cropId of cropIds) {
            updateState({ totalCoinsEarned: Number(unlocks[cropId]) || 0 });
            trackAchievements();
            syncUi();
            await nextUiTick();

            assert(isCropUnlocked(getState(), cropId), `${cropId} did not unlock at its earned-coins threshold.`);
            assert(getVisibleState(`${cropId}-seeds-item`), `${cropId} seeds did not become visible in the resource bar.`);

            const sectionSuffix = `${cropId.charAt(0).toUpperCase()}${cropId.slice(1)}`;
            const seedButton = getStoreActionButton(`buy${sectionSuffix}SeedsSection`);
            await clickElement(seedButton, `Buy ${sectionSuffix} Seeds button`);
            assert(getCropSeedCount(getState(), cropId) >= 1, `${cropId} seed inventory did not increase after unlock.`);
        }

        return 'Crop unlock thresholds and advanced store sections respond correctly.';
    });

    await runStep(report, 'Deliver a quest and receive the payout', async () => {
        const currentState = getState();
        updateState({
            inventory: {
                cropsById: {
                    ...(currentState.inventory?.cropsById || {}),
                    wheat: 10,
                },
            },
            questsUnlocked: [QUEST_SMOKE_ID],
            questsActive: [QUEST_SMOKE_ID],
            questsCompleted: [],
            questProgress: {
                ...currentState.questProgress,
                [QUEST_SMOKE_ID]: {
                    unlockedAt: Date.now(),
                    acceptedAt: Date.now(),
                },
            },
        });
        refreshQuestWindow();
        await nextUiTick();

        const deliverButton = getQuestDeliverButton();
        assert(deliverButton && !deliverButton.disabled, 'Quest deliver button did not become available.');

        const coinsBeforeQuest = Number(getState().coins) || 0;
        await clickElement(deliverButton, 'Quest deliver button');
        assert(getState().questsCompleted.includes(QUEST_SMOKE_ID), 'Quest delivery did not complete the active request.');
        assert((Number(getState().coins) || 0) > coinsBeforeQuest, 'Quest payout did not increase coins.');

        return 'Quest delivery flow completed and paid out successfully.';
    });

    await runStep(report, 'Persist and reload a snapshot safely', async () => {
        const state = getState();
        updateState({
            coins: 4321,
            inventory: {
                seedsByCrop: {
                    ...(state.inventory?.seedsByCrop || {}),
                    carrot: 7,
                },
            },
        });
        const saveSnapshot = getStateSnapshot();
        savePartialSnapshot({
            world: saveSnapshot.world,
            nodes: saveSnapshot.nodes,
        });

        const snapshot = loadSnapshot();
        const activeNodeId = snapshot?.world?.activeNodeId;
        const activeNode = activeNodeId ? snapshot?.nodes?.[activeNodeId] : null;
        assert(activeNode?.coins === 4321, 'Saved snapshot did not preserve the smoke-test coin value.');
        assert((Number(activeNode?.inventory?.seedsByCrop?.carrot) || 0) === 7, 'Saved snapshot did not preserve the smoke-test carrot seed value.');

        return 'Save/load snapshot round trip is working.';
    });

    await runStep(report, 'Trigger the water auto-buyer engine', async () => {
        const startingCoins = Math.max(10, Number(getState().coins) || 0);
        updateState({ coins: startingCoins, water: 0 });
        updateUpgradeValues({ waterAutoBuyerUnlocked: true, waterAutoBuyerEnabled: true });

        await waitFor(() => (Number(getState().water) || 0) > 0, 2000, 100);
        assert((Number(getState().coins) || 0) < startingCoins, 'Water auto-buyer did not spend coins during refill.');

        updateUpgradeValues({ waterAutoBuyerEnabled: false });
        return 'Water auto-buyer refilled water on its background tick.';
    });


    await runStep(report, 'Toggle and persist dark mode utilities', async () => {
        const darkModeButton = document.getElementById('dark-mode-toggle');
        assert(darkModeButton, 'Dark mode toggle button is missing.');

        const beforePreference = window.localStorage.getItem('colorScheme');
        const beforeBodyClass = document.body.className;
        await clickElement(darkModeButton, 'Dark mode toggle button');

        const afterPreference = window.localStorage.getItem('colorScheme');
        const afterBodyClass = document.body.className;
        assert(afterPreference === 'dark' || afterPreference === 'light', 'Dark mode toggle did not persist a color scheme preference.');
        assert(beforePreference !== afterPreference || beforeBodyClass !== afterBodyClass, 'Dark mode toggle did not change the visual preference state.');

        return 'Dark mode utility persisted its preference and updated the page state.';
    });
}

function roundTo(value, decimals = 1) {
    const precision = Math.max(0, Number(decimals) || 0);
    const factor = 10 ** precision;
    return Math.round((Number(value) || 0) * factor) / factor;
}

function getHighestThreshold(values = []) {
    return values.reduce((maxValue, entry) => Math.max(maxValue, Number(entry) || 0), 0);
}

function sumNumericValues(values = []) {
    return values.reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function countAchievementGoals() {
    const achievementConfig = progressionConfig.achievements;
    return achievementConfig.totalCoinsSpent.length
        + achievementConfig.totalCoinsEarned.length
        + achievementConfig.waterRefillsPurchased.length
        + Object.values(achievementConfig.seedsBought).reduce((sum, thresholds) => sum + thresholds.length, 0)
        + Object.values(achievementConfig.cropsSold).reduce((sum, thresholds) => sum + thresholds.length, 0)
        + 3;
}

function buildProgressiveActionPlan({
    targetCount,
    unlockThresholds = [],
    baseQuantity = 1,
    tierConfigs = [],
    getActionValue = null,
}) {
    const normalizedTarget = Math.max(0, Math.ceil(Number(targetCount) || 0));
    const thresholds = Array.isArray(unlockThresholds)
        ? unlockThresholds
            .map((threshold) => Math.max(0, Math.ceil(Number(threshold) || 0)))
            .filter((threshold) => threshold > 0)
        : [];

    let currentCount = 0;
    let totalClicks = 0;
    let totalValue = 0;
    const steps = [];

    for (let stageIndex = 0; currentCount < normalizedTarget; stageIndex += 1) {
        const nextThreshold = stageIndex < thresholds.length
            ? Math.min(normalizedTarget, thresholds[stageIndex])
            : normalizedTarget;

        if (currentCount >= nextThreshold) {
            continue;
        }

        const tierConfig = stageIndex === 0
            ? null
            : tierConfigs[Math.min(stageIndex - 1, Math.max(0, tierConfigs.length - 1))] || null;
        const actionQuantity = stageIndex === 0
            ? Math.max(1, Math.ceil(Number(baseQuantity) || 1))
            : Math.max(1, Math.ceil(Number(tierConfig?.quantity) || baseQuantity));
        const neededCount = nextThreshold - currentCount;
        const clicks = Math.ceil(neededCount / actionQuantity);
        const addedCount = clicks * actionQuantity;
        const actionValue = typeof getActionValue === 'function'
            ? Math.max(0, Number(getActionValue({ actionQuantity, tierConfig, stageIndex })) || 0)
            : 0;

        currentCount += addedCount;
        totalClicks += clicks;
        totalValue += clicks * actionValue;
        steps.push({
            stageIndex,
            actionQuantity,
            clicks,
            addedCount,
            actionValue,
            resultingCount: Math.min(currentCount, normalizedTarget),
        });
    }

    return {
        targetCount: normalizedTarget,
        totalClicks,
        totalValue,
        steps,
    };
}

function buildSeedPurchasePlan(cropId, targetCount) {
    const thresholds = progressionConfig.achievements.seedsBought[cropId] || [];
    const seedCost = Math.max(0, Number(progressionConfig.storeEconomy.seedCosts[cropId]) || 0);

    return buildProgressiveActionPlan({
        targetCount,
        unlockThresholds: thresholds,
        baseQuantity: 1,
        tierConfigs: progressionConfig.bulkTiers.seedPacks || [],
        getActionValue: ({ actionQuantity, tierConfig }) => {
            const discountMultiplier = Math.max(0, Number(tierConfig?.discountMultiplier) || 1);
            return Math.max(1, Math.ceil(actionQuantity * seedCost * discountMultiplier));
        },
    });
}

function buildCropSalePlan(cropId, targetCount) {
    const thresholds = progressionConfig.achievements.cropsSold[cropId] || [];
    const salePrice = Math.max(0, Number(progressionConfig.storeEconomy.sellPrices[cropId]) || 0);

    return buildProgressiveActionPlan({
        targetCount,
        unlockThresholds: thresholds,
        baseQuantity: 1,
        tierConfigs: progressionConfig.bulkTiers.cropSales || [],
        getActionValue: ({ actionQuantity, tierConfig }) => {
            const bonusMultiplier = 1 + (Math.max(0, Number(tierConfig?.bonusPercent) || 0) / 100);
            return Math.max(1, Math.floor(actionQuantity * salePrice * bonusMultiplier));
        },
    });
}

function getWaterApplicationsNeeded(cropId) {
    const cropConfig = getCropConfig(cropId);
    return Math.max(1, (Number(cropConfig?.waterStages) || 0) + 1);
}

function getManualCropCycleClickCost(cropId) {
    return getWaterApplicationsNeeded(cropId) + 3;
}

function getBestWaterUnitCost() {
    const baseQuantity = Math.max(1, Number(progressionConfig.storeEconomy.water.quantity) || 10);
    const baseCost = Math.max(0, Number(progressionConfig.storeEconomy.water.cost) || 1);
    let bestUnitCost = baseCost / baseQuantity;

    (progressionConfig.bulkTiers.waterRefills || []).forEach((tier) => {
        const quantity = Math.max(1, Number(tier?.quantity) || 0);
        const costMultiplier = Math.max(0, Number(tier?.costMultiplier) || 0);
        if (!quantity || !costMultiplier) {
            return;
        }

        const refillCost = Math.max(1, Math.ceil((quantity / baseQuantity) * baseCost * costMultiplier));
        bestUnitCost = Math.min(bestUnitCost, refillCost / quantity);
    });

    return bestUnitCost;
}

function estimateWaterPlan(requiredWaterUnits) {
    const baseQuantity = Math.max(1, Number(progressionConfig.storeEconomy.water.quantity) || 10);
    const baseCost = Math.max(0, Number(progressionConfig.storeEconomy.water.cost) || 1);
    const requiredClicks = getHighestThreshold(progressionConfig.achievements.waterRefillsPurchased);
    const effectiveWaterUnits = Math.max(requiredClicks * baseQuantity, Math.ceil(Number(requiredWaterUnits) || 0));
    const minimumCost = requiredClicks * baseCost;
    const unitCostEstimate = getBestWaterUnitCost();

    return {
        requiredClicks,
        requiredWaterUnits: effectiveWaterUnits,
        totalCost: Math.max(minimumCost, Math.ceil(effectiveWaterUnits * unitCostEstimate)),
        effectiveUnitCost: roundTo(unitCostEstimate, 4),
    };
}

function buildPlotPurchasePlan(targetPlots = progressionConfig.unlocks.fieldsBySpendAndFirstFieldPlots.firstFieldRequiredPlots) {
    const plotConfig = progressionConfig.storeEconomy.plot || {};
    const scalingStartPlotCount = Math.max(1, Number(plotConfig.scalingStartPlotCount) || 9);
    const scalingMultiplier = Math.max(1, Number(plotConfig.scalingMultiplier) || 1.06);
    let currentPlots = 1;
    let currentCost = Math.max(1, Number(plotConfig.baseCost) || 10);
    let totalClicks = 0;
    let totalCost = 0;

    while (currentPlots < targetPlots) {
        let purchaseCost = currentCost;
        if (currentPlots >= scalingStartPlotCount) {
            purchaseCost = Math.ceil(currentCost * scalingMultiplier);
        }

        totalClicks += 1;
        totalCost += purchaseCost;
        currentCost = purchaseCost;
        currentPlots += 1;
    }

    return {
        totalClicks,
        totalCost,
        startingPlots: 1,
        targetPlots,
    };
}

function getQuestRewardUnlockLabels() {
    return [];
}

function buildQuestAuditSummary() {
    const cropIds = getCropIds();
    const deliveryRequirementsByCrop = cropIds.reduce((summary, cropId) => {
        summary[cropId] = 0;
        return summary;
    }, {});
    const maxUnlockSoldByCrop = cropIds.reduce((summary, cropId) => {
        summary[cropId] = 0;
        return summary;
    }, {});
    const questRewardUnlocks = new Set();

    let regularQuestCount = 0;
    let timedQuestCount = 0;
    let autoCompleteQuestCount = 0;
    let totalDeliveryClicks = 0;
    let totalPayoutCoins = 0;
    let autoCompleteHarvestRequirement = 0;

    getQuestDefinitions().forEach((quest) => {
        if (quest?.unlockCondition?.type === 'cropsSold') {
            cropIds.forEach((cropId) => {
                const requiredAmount = Math.max(0, Number(quest.unlockCondition?.requirements?.[cropId]) || 0);
                maxUnlockSoldByCrop[cropId] = Math.max(maxUnlockSoldByCrop[cropId], requiredAmount);
            });
        }

        getQuestRewardUnlockLabels(quest).forEach((label) => questRewardUnlocks.add(label));

        if (quest?.autoComplete) {
            autoCompleteQuestCount += 1;
            return;
        }

        regularQuestCount += 1;
        totalDeliveryClicks += 1;
        if (Number(quest?.deliveryWindowMs) > 0) {
            timedQuestCount += 1;
        }

        cropIds.forEach((cropId) => {
            const quantity = Math.max(0, Number(quest?.requirements?.[cropId]) || 0);
            deliveryRequirementsByCrop[cropId] += quantity;
            totalPayoutCoins += quantity * (Math.max(0, Number(progressionConfig.storeEconomy.sellPrices[cropId]) || 0) * 2);
        });
    });

    return {
        regularQuestCount,
        timedQuestCount,
        autoCompleteQuestCount,
        totalDeliveryClicks,
        totalPayoutCoins,
        deliveryRequirementsByCrop,
        maxUnlockSoldByCrop,
        autoCompleteHarvestRequirement,
        questRewardUnlocks: [...questRewardUnlocks],
    };
}

function buildUnlockMilestones(questSummary, progressSnapshot) {
    const unlocks = progressionConfig.unlocks;
    const milestones = [];
    const coinsEarned = Math.max(0, Number(progressSnapshot?.coinsEarned) || 0);
    const coinsSpent = Math.max(0, Number(progressSnapshot?.coinsSpent) || 0);
    const waterRefillsPurchased = Math.max(0, Number(progressSnapshot?.waterRefillsPurchased) || 0);
    const completedQuestUnlocks = new Set(progressSnapshot?.questRewardUnlocks || []);

    Object.entries(unlocks.cropsByTotalCoinsEarned || {}).forEach(([cropId, threshold]) => {
        const requiredThreshold = Math.max(0, Number(threshold) || 0);
        milestones.push({
            category: 'crop',
            name: `${getCropLabel(cropId)} unlocked`,
            requirement: `${requiredThreshold.toLocaleString()} coins earned`,
            reached: coinsEarned >= requiredThreshold,
        });
    });

    const waterUpgradeThreshold = Math.max(0, Number(unlocks.upgradeSections?.waterUpgradesByWaterRefills) || 0);
    milestones.push({
        category: 'store',
        name: 'Water Upgrades section',
        requirement: `${waterUpgradeThreshold.toLocaleString()} water refills purchased`,
        reached: waterRefillsPurchased >= waterUpgradeThreshold,
    });

    const clickUpgradeThreshold = Math.max(0, Number(unlocks.upgradeSections?.clickUpgradesByCoinsEarned) || 0);
    milestones.push({
        category: 'store',
        name: 'Click Upgrades section',
        requirement: `${clickUpgradeThreshold.toLocaleString()} coins earned`,
        reached: coinsEarned >= clickUpgradeThreshold,
    });

    const waterAutoBuyerThreshold = Math.max(0, Number(unlocks.waterAutoBuyerByWaterRefills) || 0);
    milestones.push({
        category: 'automation',
        name: 'Water Auto-Buyer',
        requirement: `${waterAutoBuyerThreshold.toLocaleString()} water refills purchased`,
        reached: waterRefillsPurchased >= waterAutoBuyerThreshold,
    });

    Object.entries(unlocks.toolAutoChangerChargePacksByCoinsEarned || {}).forEach(([packId, threshold]) => {
        const requiredThreshold = Math.max(0, Number(threshold) || 0);
        milestones.push({
            category: 'tool',
            name: `Auto-Changer ${packId.replace('pack', 'Pack ')}`,
            requirement: `${requiredThreshold.toLocaleString()} coins earned`,
            reached: coinsEarned >= requiredThreshold,
        });
    });

    Object.entries(unlocks.expandedClickByCoinsSpent || {}).forEach(([mkId, threshold]) => {
        const requiredThreshold = Math.max(0, Number(threshold) || 0);
        milestones.push({
            category: 'upgrade',
            name: `Expanded Click ${mkId.toUpperCase()}`,
            requirement: `${requiredThreshold.toLocaleString()} coins spent`,
            reached: coinsSpent >= requiredThreshold,
        });
    });

    questSummary.questRewardUnlocks.forEach((unlockName) => {
        milestones.push({
            category: 'quest',
            name: unlockName,
            requirement: 'Quest progression completion',
            reached: completedQuestUnlocks.has(unlockName),
        });
    });

    return milestones;
}

function getBulkTierUnitRevenue(cropId) {
    const salePrice = Math.max(0, Number(progressionConfig.storeEconomy.sellPrices[cropId]) || 0);
    const saleTiers = progressionConfig.bulkTiers.cropSales || [];
    const finalTier = saleTiers[Math.max(0, saleTiers.length - 1)] || { quantity: 1, bonusPercent: 0 };
    const quantity = Math.max(1, Number(finalTier?.quantity) || 1);
    const multiplier = 1 + (Math.max(0, Number(finalTier?.bonusPercent) || 0) / 100);
    return Math.max(1, Math.floor(quantity * salePrice * multiplier)) / quantity;
}

function getBulkTierUnitSeedCost(cropId) {
    const seedCost = Math.max(0, Number(progressionConfig.storeEconomy.seedCosts[cropId]) || 0);
    const seedTiers = progressionConfig.bulkTiers.seedPacks || [];
    const finalTier = seedTiers[Math.max(0, seedTiers.length - 1)] || { quantity: 1, discountMultiplier: 1 };
    const quantity = Math.max(1, Number(finalTier?.quantity) || 1);
    const discountMultiplier = Math.max(0, Number(finalTier?.discountMultiplier) || 1);
    return Math.max(1, Math.ceil(quantity * seedCost * discountMultiplier)) / quantity;
}

function getBestFundingCropProfile() {
    const waterUnitCost = getBestWaterUnitCost();

    return getCropIds().reduce((bestProfile, cropId) => {
        const netCoinsPerCrop = getBulkTierUnitRevenue(cropId)
            - getBulkTierUnitSeedCost(cropId)
            - (getWaterApplicationsNeeded(cropId) * waterUnitCost);
        const clicksPerCrop = getManualCropCycleClickCost(cropId)
            + (1 / Math.max(1, Number((progressionConfig.bulkTiers.cropSales || [])[Math.max(0, (progressionConfig.bulkTiers.cropSales || []).length - 1)]?.quantity) || 30));
        const coinsPerClick = netCoinsPerCrop / Math.max(1, clicksPerCrop);
        const candidateProfile = {
            cropId,
            netCoinsPerCrop: roundTo(netCoinsPerCrop, 2),
            coinsPerClick: roundTo(coinsPerClick, 3),
        };

        if (!bestProfile || candidateProfile.coinsPerClick > bestProfile.coinsPerClick) {
            return candidateProfile;
        }

        return bestProfile;
    }, null);
}

function estimateAdditionalFunding(cropId, extraCoinsNeeded) {
    const saleTiers = progressionConfig.bulkTiers.cropSales || [];
    const finalSaleQuantity = Math.max(1, Number(saleTiers[Math.max(0, saleTiers.length - 1)]?.quantity) || 30);
    const grossCoinsPerCrop = getBulkTierUnitRevenue(cropId);
    const netCoinsPerCrop = Math.max(0.1, getBestFundingCropProfile()?.cropId === cropId
        ? Number(getBestFundingCropProfile()?.netCoinsPerCrop) || 0.1
        : (grossCoinsPerCrop - getBulkTierUnitSeedCost(cropId) - (getWaterApplicationsNeeded(cropId) * getBestWaterUnitCost())));
    const extraHarvests = Math.max(0, Math.ceil((Number(extraCoinsNeeded) || 0) / netCoinsPerCrop));

    return {
        cropId,
        extraHarvests,
        extraSaleClicks: Math.ceil(extraHarvests / finalSaleQuantity),
        extraSaleRevenueCoins: Math.ceil(extraHarvests * grossCoinsPerCrop),
        netCoinsPerCrop: roundTo(netCoinsPerCrop, 2),
    };
}

function buildFewestClicksAuditReport(options = {}) {
    const cropIds = getCropIds();
    const clicksPerMinute = Math.max(1, Number(options.clicksPerMinute) || DEFAULT_AUDIT_CLICKS_PER_MINUTE);
    const questSummary = buildQuestAuditSummary();
    const startingCoins = 1;

    const maxSeedTargetsByCrop = cropIds.reduce((summary, cropId) => {
        summary[cropId] = getHighestThreshold(progressionConfig.achievements.seedsBought[cropId] || []);
        return summary;
    }, {});

    const requiredSoldByCrop = cropIds.reduce((summary, cropId) => {
        const soldAchievementTarget = getHighestThreshold(progressionConfig.achievements.cropsSold[cropId] || []);
        summary[cropId] = Math.max(soldAchievementTarget, Number(questSummary.maxUnlockSoldByCrop[cropId]) || 0);
        return summary;
    }, {});

    const baseHarvestCountsByCrop = cropIds.reduce((summary, cropId) => {
        summary[cropId] = requiredSoldByCrop[cropId] + (Number(questSummary.deliveryRequirementsByCrop[cropId]) || 0);
        return summary;
    }, {});

    const plotPurchasePlan = buildPlotPurchasePlan();
    const fundingCrop = getBestFundingCropProfile() || { cropId: 'carrot', netCoinsPerCrop: 1, coinsPerClick: 0 };

    let extraFunding = {
        cropId: fundingCrop.cropId,
        extraHarvests: 0,
        extraSaleClicks: 0,
        extraSaleRevenueCoins: 0,
        netCoinsPerCrop: fundingCrop.netCoinsPerCrop,
    };
    let finalSnapshot = null;

    for (let iteration = 0; iteration < 3; iteration += 1) {
        const totalHarvestCountsByCrop = {
            ...baseHarvestCountsByCrop,
            [fundingCrop.cropId]: baseHarvestCountsByCrop[fundingCrop.cropId] + extraFunding.extraHarvests,
        };
        const seedTargetsByCrop = {
            ...maxSeedTargetsByCrop,
            [fundingCrop.cropId]: Math.max(maxSeedTargetsByCrop[fundingCrop.cropId], totalHarvestCountsByCrop[fundingCrop.cropId]),
        };
        const seedPlansByCrop = cropIds.reduce((summary, cropId) => {
            summary[cropId] = buildSeedPurchasePlan(cropId, seedTargetsByCrop[cropId]);
            return summary;
        }, {});
        const salePlansByCrop = cropIds.reduce((summary, cropId) => {
            summary[cropId] = buildCropSalePlan(cropId, requiredSoldByCrop[cropId]);
            return summary;
        }, {});
        const totalWaterUnits = cropIds.reduce(
            (sum, cropId) => sum + (totalHarvestCountsByCrop[cropId] * getWaterApplicationsNeeded(cropId)),
            0,
        );
        const waterPlan = estimateWaterPlan(totalWaterUnits);
        const totalSeedCoinsSpent = sumNumericValues(Object.values(seedPlansByCrop).map((plan) => plan.totalValue));
        const baselineSaleRevenueCoins = sumNumericValues(Object.values(salePlansByCrop).map((plan) => plan.totalValue));
        const requiredSpendCoins = totalSeedCoinsSpent + plotPurchasePlan.totalCost + waterPlan.totalCost;
        const guaranteedRevenueCoins = startingCoins + baselineSaleRevenueCoins + questSummary.totalPayoutCoins + extraFunding.extraSaleRevenueCoins;
        const extraCoinsNeeded = Math.max(0, requiredSpendCoins - guaranteedRevenueCoins);
        const nextExtraFunding = estimateAdditionalFunding(fundingCrop.cropId, extraCoinsNeeded);

        finalSnapshot = {
            seedTargetsByCrop,
            seedPlansByCrop,
            salePlansByCrop,
            totalHarvestCountsByCrop,
            totalWaterUnits,
            waterPlan,
            totalSeedCoinsSpent,
            baselineSaleRevenueCoins,
            requiredSpendCoins,
            guaranteedRevenueCoins,
            extraCoinsNeeded,
        };

        if (nextExtraFunding.extraHarvests === extraFunding.extraHarvests) {
            extraFunding = nextExtraFunding;
            break;
        }

        extraFunding = nextExtraFunding;
    }

    const totalSeedPurchaseClicks = sumNumericValues(Object.values(finalSnapshot.seedPlansByCrop).map((plan) => plan.totalClicks));
    const totalCropSaleClicks = sumNumericValues(Object.values(finalSnapshot.salePlansByCrop).map((plan) => plan.totalClicks)) + extraFunding.extraSaleClicks;
    const totalPlotActionClicks = cropIds.reduce(
        (sum, cropId) => sum + (finalSnapshot.totalHarvestCountsByCrop[cropId] * getManualCropCycleClickCost(cropId)),
        0,
    );
    const totalEstimatedClicks = totalSeedPurchaseClicks
        + totalCropSaleClicks
        + totalPlotActionClicks
        + finalSnapshot.waterPlan.requiredClicks
        + plotPurchasePlan.totalClicks
        + questSummary.totalDeliveryClicks;
    const totalCoinsSpentEstimate = finalSnapshot.totalSeedCoinsSpent + finalSnapshot.waterPlan.totalCost + plotPurchasePlan.totalCost;
    const totalCoinsEarnedEstimate = finalSnapshot.baselineSaleRevenueCoins + extraFunding.extraSaleRevenueCoins + questSummary.totalPayoutCoins;
    const progressSnapshot = {
        coinsSpent: totalCoinsSpentEstimate,
        coinsEarned: totalCoinsEarnedEstimate,
        waterRefillsPurchased: finalSnapshot.waterPlan.requiredClicks,
        plotsOnFirstField: plotPurchasePlan.targetPlots,
        questRewardUnlocks: questSummary.questRewardUnlocks,
    };
    const unlockMilestones = buildUnlockMilestones(questSummary, progressSnapshot);
    const reachedMilestones = unlockMilestones.filter((milestone) => milestone.reached);
    const unmetMilestones = unlockMilestones.filter((milestone) => !milestone.reached);

    const compactPlanByCrop = (plansByCrop, extraFields = {}) => cropIds.reduce((summary, cropId) => {
        summary[cropId] = {
            target: plansByCrop[cropId].targetCount,
            clicks: plansByCrop[cropId].totalClicks,
            value: plansByCrop[cropId].totalValue,
            ...(extraFields[cropId] || {}),
        };
        return summary;
    }, {});

    return {
        ok: true,
        startedAt: new Date().toISOString(),
        options: {
            objective: 'fewest-clicks',
            clicksPerMinute,
            ...options,
        },
        summary: {
            estimatedMinClicks: totalEstimatedClicks,
            estimatedActiveMinutes: roundTo(totalEstimatedClicks / clicksPerMinute, 1),
            estimatedActiveHours: roundTo((totalEstimatedClicks / clicksPerMinute) / 60, 2),
            clicksPerMinuteAssumption: clicksPerMinute,
            achievementGoalsCovered: countAchievementGoals(),
            unlockMilestonesCovered: reachedMilestones.length,
            unlockMilestonesEnumerated: unlockMilestones.length,
            fundingCrop: getCropLabel(fundingCrop.cropId),
            estimatedCoinsSpent: totalCoinsSpentEstimate,
            estimatedCoinsEarned: totalCoinsEarnedEstimate,
        },
        breakdown: {
            seedPurchases: {
                requiredClicks: totalSeedPurchaseClicks,
                estimatedCoinsSpent: finalSnapshot.totalSeedCoinsSpent,
                byCrop: compactPlanByCrop(finalSnapshot.seedPlansByCrop),
            },
            cropSales: {
                requiredClicks: totalCropSaleClicks,
                estimatedCoinsEarned: finalSnapshot.baselineSaleRevenueCoins + extraFunding.extraSaleRevenueCoins,
                byCrop: compactPlanByCrop(finalSnapshot.salePlansByCrop, cropIds.reduce((summary, cropId) => {
                    summary[cropId] = { requiredSold: requiredSoldByCrop[cropId] };
                    return summary;
                }, {})),
                extraFundingSales: {
                    cropId: fundingCrop.cropId,
                    cropLabel: getCropLabel(fundingCrop.cropId),
                    extraHarvests: extraFunding.extraHarvests,
                    extraSaleClicks: extraFunding.extraSaleClicks,
                    netCoinsPerCrop: extraFunding.netCoinsPerCrop,
                },
            },
            plotActions: {
                requiredClicks: totalPlotActionClicks,
                harvestCountsByCrop: finalSnapshot.totalHarvestCountsByCrop,
                cycleClicksByCrop: cropIds.reduce((summary, cropId) => {
                    summary[cropId] = getManualCropCycleClickCost(cropId);
                    return summary;
                }, {}),
            },
            waterRefills: {
                requiredClicks: finalSnapshot.waterPlan.requiredClicks,
                estimatedCoinsSpent: finalSnapshot.waterPlan.totalCost,
                requiredWaterUnits: finalSnapshot.totalWaterUnits,
                effectiveUnitCost: finalSnapshot.waterPlan.effectiveUnitCost,
            },
            plotPurchases: {
                requiredClicks: plotPurchasePlan.totalClicks,
                estimatedCoinsSpent: plotPurchasePlan.totalCost,
                targetPlots: plotPurchasePlan.targetPlots,
            },
            quests: {
                requiredDeliveryClicks: questSummary.totalDeliveryClicks,
                regularQuestCount: questSummary.regularQuestCount,
                timedQuestCount: questSummary.timedQuestCount,
                autoCompleteQuestCount: questSummary.autoCompleteQuestCount,
                autoCompleteHarvestRequirement: questSummary.autoCompleteHarvestRequirement,
                estimatedQuestPayoutCoins: questSummary.totalPayoutCoins,
                deliveryRequirementsByCrop: questSummary.deliveryRequirementsByCrop,
                unlockSoldRequirementsByCrop: questSummary.maxUnlockSoldByCrop,
            },
        },
        milestones: unlockMilestones,
        unmetMilestones,
        caveats: [
            'This is a deterministic estimate built from the current config thresholds, bulk tiers, and click-count rules.',
            'Timed quest achievements are included in the click budget through their quest deliveries, but they still require meeting real delivery windows in live play.',
            'Automation does not reduce the audited click total here because expanded-click actions also add to totalClicksClicked.',
        ],
    };
}

function logFewestClicksAuditReport(report) {
    console.groupCollapsed('[ASCII FARMER DEV] Fewest-clicks audit');
    console.table([
        {
            Category: 'Seed purchases',
            Clicks: report.breakdown.seedPurchases.requiredClicks,
            Details: `${report.breakdown.seedPurchases.estimatedCoinsSpent.toLocaleString()} coins spent`,
        },
        {
            Category: 'Crop sales',
            Clicks: report.breakdown.cropSales.requiredClicks,
            Details: `${Math.round(report.breakdown.cropSales.estimatedCoinsEarned).toLocaleString()} coins earned`,
        },
        {
            Category: 'Plot actions',
            Clicks: report.breakdown.plotActions.requiredClicks,
            Details: 'Till / plant / water / harvest loops',
        },
        {
            Category: 'Water refills',
            Clicks: report.breakdown.waterRefills.requiredClicks,
            Details: `${Math.round(report.breakdown.waterRefills.estimatedCoinsSpent).toLocaleString()} coins spent`,
        },
        {
            Category: 'Plot purchases',
            Clicks: report.breakdown.plotPurchases.requiredClicks,
            Details: `${Math.round(report.breakdown.plotPurchases.estimatedCoinsSpent).toLocaleString()} coins spent`,
        },
        {
            Category: 'Quest deliveries',
            Clicks: report.breakdown.quests.requiredDeliveryClicks,
            Details: `${report.breakdown.quests.regularQuestCount} total quest deliveries`,
        },
    ]);
    console.info('Fewest-clicks audit summary:', report.summary);
    if (Array.isArray(report.unmetMilestones) && report.unmetMilestones.length > 0) {
        console.warn('Fewest-clicks audit unmet milestones:', report.unmetMilestones);
    }
    console.info('Fewest-clicks audit caveats:', report.caveats);
    console.groupEnd();
}

async function runFewestClicksAudit(options = {}) {
    if (!isLocalDevEnvironment()) {
        throw new Error('Fewest-clicks audit is only available in local development environments.');
    }

    if (activeFewestClicksAuditPromise) {
        return activeFewestClicksAuditPromise;
    }

    activeFewestClicksAuditPromise = (async () => {
        const backup = captureRuntimeBackup();

        try {
            const report = buildFewestClicksAuditReport(options);
            lastFewestClicksAuditReport = report;
            logFewestClicksAuditReport(report);
            return report;
        } finally {
            restoreRuntimeBackup(backup);
        }
    })();

    try {
        return await activeFewestClicksAuditPromise;
    } finally {
        activeFewestClicksAuditPromise = null;
    }
}

async function runSmokeTest(options = {}) {
    if (!isLocalDevEnvironment()) {
        throw new Error('Smoke test API is only available in local development environments.');
    }

    if (activeRunPromise) {
        return activeRunPromise;
    }

    activeRunPromise = (async () => {
        const report = {
            ok: false,
            startedAt: new Date().toISOString(),
            startedAtMs: Date.now(),
            steps: [],
            failures: [],
            options: { ...options },
        };
        const backup = captureRuntimeBackup();

        try {
            await runSmokeScenario(report);
        } catch (error) {
            report.failures.push({
                step: 'Unhandled smoke test error',
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            restoreRuntimeBackup(backup);
        }

        summarizeReport(report);
        lastSmokeReport = report;
        logReport(report);
        return report;
    })();

    try {
        return await activeRunPromise;
    } finally {
        activeRunPromise = null;
    }
}

function initializeDevSmokeTestApi() {
    if (!isLocalDevEnvironment() || typeof window === 'undefined') {
        return;
    }

    const existingApi = window[DEV_API_NAME];
    if (
        existingApi
        && typeof existingApi.runSmokeTest === 'function'
        && typeof existingApi.runFewestClicksAudit === 'function'
    ) {
        return;
    }

    Object.defineProperty(window, DEV_API_NAME, {
        configurable: true,
        enumerable: false,
        value: Object.freeze({
            runSmokeTest,
            runFewestClicksAudit,
            runPerfectPlayerAudit: runFewestClicksAudit,
            triggerAmbientFarmrVisit: () => window.__asciiFarmerAmbient?.triggerVisit?.(),
            getLastSmokeReport: () => lastSmokeReport,
            getLastFewestClicksAuditReport: () => lastFewestClicksAuditReport,
        }),
        writable: false,
    });
}

export { initializeDevSmokeTestApi, runSmokeTest, runFewestClicksAudit };
