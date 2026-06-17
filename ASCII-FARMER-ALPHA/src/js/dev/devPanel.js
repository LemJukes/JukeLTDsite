import { savePartialSnapshot } from '../persistence.js';
import {
    initializeWorldState as applyStateSnapshot,
    getActiveNodeState as getState,
    updateActiveNodeState as updateState,
    getWorldState,
    dispatchWorldAction,
    isWorldStateLoggingEnabled,
    setWorldStateLoggingEnabled,
    logWorldState,
} from '../worldState.js';
import { transitionTo } from '../ui/sceneTransitions.js';
import { convertPlot, getConversionCost } from '../netspace/plotConversionTunnel.js';
import { buildAutofarmer, getAutofarmCost } from '../netspace/autofarmers.js';
import { updateResourceBar } from '../ui/resource.js';
import { updateField, refreshFieldTitlebarControl } from '../ui/field.js';
import { refreshQuestWindow } from '../ui/quests.js';
import {
    applyStoreValuesSnapshot,
    getStoreValuesSnapshot,
} from '../ui/store.js';
import {
    applyUpgradeValuesSnapshot,
    getUpgradeValuesSnapshot,
    initializeClickUpgradesSection,
    initializeWaterUpgradesSection,
    renderClickUpgradesSection,
    updateWaterUpgradeButton,
    addToolAutoChangerControls,
} from '../ui/upgrades.js';
import { trackAchievements } from '../handlers/achievementHandlers.js';
import { canDeliverQuest, deliverQuest } from '../handlers/questHandlers.js';
import { getQuestDefinitionById, getQuestDefinitions } from '../configs/questConfig.js';
import { getCropIds, getCropLabel } from '../configs/cropConfig.js';
import { progressionConfig } from '../configs/progressionConfig.js';
import { FIELD_CENTER_INDEX, FIELD_GRID_CAPACITY, FIELD_GRID_WIDTH } from '../configs/fieldGridConfig.js';
import { DEFAULT_FARM_NODE_ID, buildDefaultWorldState } from '../schemas/v2StateShape.js';
import {
    getCropInventoryCount,
    getCropSeedCount,
    getCropSeedsBoughtCount,
    getCropSoldCount,
    isCropUnlocked,
} from '../state/nodeCropView.js';

const DEV_PANEL_ID = 'ascii-farmer-dev-panel';
const DEV_PANEL_STYLE_ID = 'ascii-farmer-dev-panel-style';
const DEV_PANEL_API_NAME = '__asciiFarmerDevPanel';
const DEV_PRESET_RELOAD_FLAG = '__asciiFarmerSkipUnloadSave';

const cropIds = getCropIds();
const resourceDefinitions = [
    { key: 'coins', label: 'Coins' },
    { key: 'water', label: 'Water' },
    ...cropIds.map((cropId) => ({ key: `seedsByCrop.${cropId}`, label: `${getCropLabel(cropId)} Seeds` })),
    ...cropIds.map((cropId) => ({ key: `cropsById.${cropId}`, label: getCropLabel(cropId) })),
];

const flagDefinitions = [
    { key: 'corn', label: 'Corn' },
    { key: 'tomato', label: 'Tomato' },
    { key: 'potato', label: 'Potato' },
    { key: 'carrot', label: 'Carrot' },
];

const uiState = {
    visible: false,
    minimized: false,
    resourceKey: 'coins',
    amount: '100',
    netspaceSlotIndex: String(FIELD_CENTER_INDEX),
};

let initialized = false;
let panelRoot = null;

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

    if (params.get('devPanel') === '1' || params.get('devSmoke') === '1') {
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

function isEditableElement(element) {
    if (!element) {
        return false;
    }

    return element.tagName === 'INPUT'
        || element.tagName === 'TEXTAREA'
        || element.tagName === 'SELECT'
        || element.isContentEditable;
}

function clampNonNegative(value) {
    return Math.max(0, Number(value) || 0);
}

function buildCropCountMap(overrides = {}) {
    return Object.fromEntries(
        cropIds.map((cropId) => [cropId, clampNonNegative(overrides[cropId])]),
    );
}

function buildUnlockedCropList(unlockedCropIds = []) {
    const unlocked = new Set(['wheat']);

    (Array.isArray(unlockedCropIds) ? unlockedCropIds : []).forEach((cropId) => {
        if (cropIds.includes(cropId)) {
            unlocked.add(cropId);
        }
    });

    return [...unlocked];
}

function buildNormalizedCropState({
    seedsByCrop = {},
    cropsById = {},
    seedsBoughtByCrop = {},
    cropsSoldByCrop = {},
    unlockedCropIds = [],
} = {}) {
    return {
        inventory: {
            seedsByCrop: buildCropCountMap(seedsByCrop),
            cropsById: buildCropCountMap(cropsById),
        },
        progressByCrop: {
            seedsBoughtByCrop: buildCropCountMap(seedsBoughtByCrop),
            cropsSoldByCrop: buildCropCountMap(cropsSoldByCrop),
        },
        unlocks: {
            crops: buildUnlockedCropList(unlockedCropIds),
        },
    };
}

function formatNumber(value) {
    return Number(value || 0).toLocaleString();
}

function getSelectedAmount() {
    return clampNonNegative(uiState.amount || 0);
}

function getResourceValue(state, key) {
    if (typeof key === 'string' && key.startsWith('seedsByCrop.')) {
        return getCropSeedCount(state, key.replace('seedsByCrop.', ''));
    }

    if (typeof key === 'string' && key.startsWith('cropsById.')) {
        return getCropInventoryCount(state, key.replace('cropsById.', ''));
    }

    return clampNonNegative(state?.[key]);
}

function ensureStyles() {
    if (document.getElementById(DEV_PANEL_STYLE_ID)) {
        return;
    }

    const style = document.createElement('style');
    style.id = DEV_PANEL_STYLE_ID;
    style.textContent = `
        #${DEV_PANEL_ID} {
            position: fixed;
            top: 36px;
            right: 14px;
            z-index: 2500;
            width: min(420px, calc(100vw - 28px));
            max-height: calc(100vh - 52px);
            border: 2px solid #000;
            background: #efefef;
            box-shadow: inset 1px 1px 0 #fff, inset -1px -1px 0 #7a7a7a, 5px 5px 0 rgba(0, 0, 0, 0.24);
            color: #000;
            overflow: hidden;
        }

        #${DEV_PANEL_ID}[data-visible="false"] {
            display: none;
        }

        #${DEV_PANEL_ID} .dev-panel-titlebar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 6px 8px;
            border-bottom: 2px solid #000;
            background: repeating-linear-gradient(90deg, #efefef 0 8px, #d7d7d7 8px 16px);
        }

        #${DEV_PANEL_ID} .dev-panel-title {
            margin: 0;
            font-size: 12px;
            letter-spacing: 0.08em;
        }

        #${DEV_PANEL_ID} .dev-panel-titlebar-actions,
        #${DEV_PANEL_ID} .dev-panel-row,
        #${DEV_PANEL_ID} .dev-panel-button-row,
        #${DEV_PANEL_ID} .dev-panel-status-grid {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }

        #${DEV_PANEL_ID} .dev-panel-body {
            max-height: calc(100vh - 104px);
            overflow: auto;
            padding: 8px;
            display: grid;
            gap: 8px;
        }

        #${DEV_PANEL_ID}[data-minimized="true"] .dev-panel-body {
            display: none;
        }

        #${DEV_PANEL_ID} .dev-panel-section {
            border: 1px solid #000;
            background: #fff;
            padding: 8px;
            display: grid;
            gap: 8px;
        }

        #${DEV_PANEL_ID} .dev-panel-section-title {
            margin: 0;
            font-size: 11px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        #${DEV_PANEL_ID} button,
        #${DEV_PANEL_ID} input,
        #${DEV_PANEL_ID} select {
            font: inherit;
            border: 1px solid #000;
            background: #efefef;
            color: inherit;
            min-height: 24px;
            padding: 2px 6px;
        }

        #${DEV_PANEL_ID} button {
            cursor: pointer;
        }

        #${DEV_PANEL_ID} .dev-panel-input,
        #${DEV_PANEL_ID} .dev-panel-select {
            flex: 1 1 120px;
            min-width: 0;
        }

        #${DEV_PANEL_ID} .dev-panel-kbd {
            color: #333;
            font-size: 11px;
        }

        #${DEV_PANEL_ID} .dev-panel-summary {
            margin: 0;
            color: #222;
        }

        #${DEV_PANEL_ID} .dev-panel-status-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        #${DEV_PANEL_ID} .dev-panel-status-card {
            border: 1px solid #000;
            background: #f7f7f7;
            padding: 6px;
            display: grid;
            gap: 2px;
        }

        #${DEV_PANEL_ID} .dev-panel-status-label,
        #${DEV_PANEL_ID} .dev-panel-meta,
        #${DEV_PANEL_ID} .dev-panel-row-label {
            color: #333;
        }

        #${DEV_PANEL_ID} .dev-panel-list {
            display: grid;
            gap: 6px;
            max-height: 260px;
            overflow: auto;
        }

        #${DEV_PANEL_ID} .dev-panel-list-row {
            border: 1px solid #000;
            background: #f9f9f9;
            padding: 6px;
            display: grid;
            gap: 6px;
        }

        #${DEV_PANEL_ID} .dev-panel-list-head {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 8px;
        }

        #${DEV_PANEL_ID} .dev-panel-pill {
            border: 1px solid #000;
            padding: 0 6px;
            background: #fff;
        }

        #${DEV_PANEL_ID} .dev-panel-pill[data-tone="good"] {
            background: #dff2d7;
        }

        #${DEV_PANEL_ID} .dev-panel-pill[data-tone="warn"] {
            background: #f8efc8;
        }

        #${DEV_PANEL_ID} .dev-panel-pill[data-tone="muted"] {
            background: #ececec;
        }

        #${DEV_PANEL_ID} .dev-panel-flags {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 6px;
        }

        #${DEV_PANEL_ID} .dev-panel-flag {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            border: 1px solid #000;
            background: #f9f9f9;
            padding: 4px 6px;
        }

        @media (max-width: 800px) {
            #${DEV_PANEL_ID} {
                top: 32px;
                left: 10px;
                right: 10px;
                width: auto;
            }

            #${DEV_PANEL_ID} .dev-panel-status-grid,
            #${DEV_PANEL_ID} .dev-panel-flags {
                grid-template-columns: 1fr;
            }
        }
    `;

    document.head.appendChild(style);
}

function createBasePlot(index, ownedCount) {
    const owned = ownedCount === 1 ? index === FIELD_CENTER_INDEX : index < ownedCount;
    return {
        owned,
        symbol: '~',
        cropType: null,
        waterCount: 0,
        disabledUntil: 0,
        lastCompletedCropType: null,
        fallowPenaltySteps: 0,
        lastFallowDurationMs: 0,
        lastUpdatedAt: Date.now(),
        destroyed: false,
    };
}

function buildPlotStates(ownedCount, overrides = {}) {
    return Array.from({ length: FIELD_GRID_CAPACITY }, (_, index) => {
        const plot = createBasePlot(index, ownedCount);
        if (!Object.prototype.hasOwnProperty.call(overrides, index)) {
            return plot;
        }

        return {
            ...plot,
            ...overrides[index],
            owned: true,
            lastUpdatedAt: Date.now(),
        };
    });
}

function buildFieldSnapshot({ id, name, plots, overrides }) {
    return {
        id,
        name,
        plots,
        plotStates: buildPlotStates(plots, overrides),
    };
}

function createQuestProgress(questIds, startOffsetMs = 600000) {
    const progress = {};

    questIds.forEach((questId, index) => {
        const completedAt = Date.now() - startOffsetMs + (index * 45000);
        progress[questId] = {
            unlockedAt: completedAt - 15000,
            acceptedAt: completedAt - 10000,
            completedAt,
            deliveredAt: completedAt,
            wasLate: false,
            lateFeePercent: 0,
            lateFeeAmount: 0,
            grossPayout: 0,
            netPayout: 0,
            rewardAppliedAt: completedAt,
        };
    });

    return progress;
}

function createActiveQuestProgress(questId) {
    const quest = getQuestDefinitionById(questId);
    const now = Date.now();
    return {
        [questId]: {
            unlockedAt: now,
            acceptedAt: now,
            deliveryWindowMs: Number(quest?.deliveryWindowMs) || 0,
        },
    };
}

function buildPresetWorldState(overrides = {}) {
    return {
        ...buildDefaultWorldState(),
        ...overrides,
    };
}

function buildFreshPreset() {
    return {
        world: buildPresetWorldState(),
        gameState: {},
        storeValues: {},
        upgradeValues: {},
    };
}

function buildEarlyPreset() {
    const activeQuestId = 'produce-for-gigagrocery';
    return {
        world: buildPresetWorldState(),
        gameState: {
            coins: 145,
            water: 20,
            waterCapacity: 20,
            ...buildNormalizedCropState({
                seedsByCrop: { wheat: 24, corn: 8 },
                cropsById: { wheat: 14, corn: 3 },
                seedsBoughtByCrop: { wheat: 22, corn: 8 },
                cropsSoldByCrop: { wheat: 16, corn: 4 },
                unlockedCropIds: ['corn'],
            }),
            totalCoinsEarned: 260,
            totalCoinsSpent: 150,
            seedsBought: 30,
            cropsSold: 20,
            waterRefillsPurchased: 5,
            totalClicksClicked: 140,
            totalPlayTimeMs: 8 * 60 * 1000,
            fields: {
                'field-1': buildFieldSnapshot({
                    id: 'field-1',
                    name: 'Field 1',
                    plots: 4,
                }),
            },
            ownedFieldIds: ['field-1'],
            activeFieldId: 'field-1',
            nextFieldNumber: 2,
            questProgress: createActiveQuestProgress(activeQuestId),
            questsUnlocked: [activeQuestId],
            questsActive: [activeQuestId],
            questsCompleted: [],
            selectedSeedType: 'corn',
        },
        storeValues: {},
        upgradeValues: {},
    };
}

function buildMidPreset() {
    const completedQuestIds = [
        'produce-for-gigagrocery',
        'gigagrocery-priority-restock-window',
        'gigagrocery-bulk-lane-escalation',
        'root-66-corn-onboarding',
        'root-66-corn-rush-window',
        'root-66-corn-freight-escalation',
    ];
    const activeQuestId = 'open-source-tomato-onboarding';

    return {
        world: buildPresetWorldState(),
        gameState: {
            coins: 2850,
            water: 40,
            waterCapacity: 40,
            ...buildNormalizedCropState({
                seedsByCrop: { wheat: 40, corn: 34, tomato: 26, potato: 14 },
                cropsById: { wheat: 30, corn: 26, tomato: 18, potato: 6 },
                seedsBoughtByCrop: { wheat: 60, corn: 50, tomato: 35, potato: 25 },
                cropsSoldByCrop: { wheat: 45, corn: 40, tomato: 25, potato: 10 },
                unlockedCropIds: ['corn', 'tomato', 'potato'],
            }),
            totalCoinsEarned: 1600,
            totalCoinsSpent: 3600,
            seedsBought: 170,
            cropsSold: 120,
            waterRefillsPurchased: 58,
            totalClicksClicked: 1100,
            totalPlayTimeMs: 48 * 60 * 1000,
            destroyPlotUnlocked: true,
            restorePlotUnlocked: true,
            fields: {
                'field-1': buildFieldSnapshot({
                    id: 'field-1',
                    name: 'Field 1',
                    plots: 24,
                    overrides: {
                        10: {
                            symbol: '¥',
                            cropType: 'wheat',
                            waterCount: 3,
                            lastCompletedCropType: 'wheat',
                        },
                    },
                }),
            },
            ownedFieldIds: ['field-1'],
            activeFieldId: 'field-1',
            nextFieldNumber: 2,
            questProgress: {
                ...createQuestProgress(completedQuestIds),
                ...createActiveQuestProgress(activeQuestId),
            },
            questsUnlocked: [...completedQuestIds, activeQuestId],
            questsActive: [activeQuestId],
            questsCompleted: completedQuestIds,
            selectedSeedType: 'tomato',
        },
        storeValues: {},
        upgradeValues: {
            waterAutoBuyerUnlocked: true,
            waterAutoBuyerEnabled: true,
            expandedClickMk1Unlocked: true,
            expandedClickMk1Purchased: true,
            expandedClickMk1Enabled: true,
            toolAutoChangerPurchased: true,
            toolAutoChangerEnabled: true,
            toolAutoChangerCharges: 120,
            toolAutoChangerChargePack100Unlocked: true,
            toolAutoChangerChargePack500Unlocked: true,
        },
    };
}

function buildLatePreset() {
    const completedQuestIds = getQuestDefinitions().slice(0, 14).map((quest) => quest.id);
    const activeQuestId = 'git-grocer-aisle-reset-09';
    return {
        world: buildPresetWorldState(),
        gameState: {
            coins: 185000,
            water: 120,
            waterCapacity: 120,
            ...buildNormalizedCropState({
                seedsByCrop: { wheat: 250, corn: 230, tomato: 220, potato: 210, carrot: 200 },
                cropsById: { wheat: 160, corn: 145, tomato: 130, potato: 120, carrot: 105 },
                seedsBoughtByCrop: { wheat: 600, corn: 520, tomato: 470, potato: 430, carrot: 380 },
                cropsSoldByCrop: { wheat: 420, corn: 390, tomato: 345, potato: 330, carrot: 315 },
                unlockedCropIds: ['corn', 'tomato', 'potato', 'carrot'],
            }),
            totalCoinsEarned: 98000,
            totalCoinsSpent: 62000,
            seedsBought: 2400,
            cropsSold: 1800,
            waterRefillsPurchased: 420,
            totalClicksClicked: 9600,
            totalPlayTimeMs: 9 * 60 * 60 * 1000,
            destroyPlotUnlocked: true,
            restorePlotUnlocked: true,
            fields: {
                'field-1': buildFieldSnapshot({
                    id: 'field-1',
                    name: 'Field 1',
                    plots: 81,
                }),
            },
            ownedFieldIds: ['field-1'],
            activeFieldId: 'field-1',
            nextFieldNumber: 2,
            timedQuestsBeatenOnTime: 9,
            questProgress: {
                ...createQuestProgress(completedQuestIds),
                ...createActiveQuestProgress(activeQuestId),
            },
            questsUnlocked: [...completedQuestIds, activeQuestId],
            questsActive: [activeQuestId],
            questsCompleted: completedQuestIds,
            selectedSeedType: 'carrot',
        },
        storeValues: {},
        upgradeValues: {
            waterAutoBuyerUnlocked: true,
            waterAutoBuyerEnabled: true,
            expandedClickMk1Unlocked: true,
            expandedClickMk1Purchased: true,
            expandedClickMk1Enabled: true,
            expandedClickMk2Unlocked: true,
            expandedClickMk2Purchased: true,
            expandedClickMk2Enabled: true,
            expandedClickMk3Unlocked: true,
            expandedClickMk3Purchased: true,
            expandedClickMk3Enabled: true,
            expandedClickMk4Unlocked: true,
            expandedClickMk4Purchased: true,
            expandedClickMk4Enabled: true,
            toolAutoChangerPurchased: true,
            toolAutoChangerEnabled: true,
            toolAutoChangerCharges: 1600,
            toolAutoChangerChargePack100Unlocked: true,
            toolAutoChangerChargePack500Unlocked: true,
            toolAutoChangerChargePack1000Unlocked: true,
        },
    };
}

function getPresetSnapshot(preset) {
    switch (preset) {
    case 'fresh':
        return buildFreshPreset();
    case 'early':
        return buildEarlyPreset();
    case 'mid':
        return buildMidPreset();
    case 'late':
        return buildLatePreset();
    default:
        return null;
    }
}

function saveAuxiliarySnapshots(storeValues = {}, upgradeValues = {}) {
    applyStoreValuesSnapshot(storeValues);
    applyUpgradeValuesSnapshot(upgradeValues);
    savePartialSnapshot({
        storeValues: getStoreValuesSnapshot(),
        upgradeValues: getUpgradeValuesSnapshot(),
    });
}

function refreshUi() {
    updateResourceBar();
    trackAchievements();
    if (document.getElementById('water-upgrades-section')) {
        updateWaterUpgradeButton();
    }
    if (document.getElementById('click-upgrades-section')) {
        renderClickUpgradesSection();
        addToolAutoChangerControls();
    }
    updateField();
    refreshFieldTitlebarControl();
    refreshQuestWindow();
    render();
}

function applyPreset(presetName) {
    const snapshot = getPresetSnapshot(presetName);
    if (!snapshot) {
        return;
    }

    window[DEV_PRESET_RELOAD_FLAG] = true;
    savePartialSnapshot({
        world: snapshot.world || getWorldState(),
        nodes: { [DEFAULT_FARM_NODE_ID]: snapshot.gameState },
    });
    window.location.reload();
}

function adjustResource(key, delta) {
    const state = getState();
    const currentValue = getResourceValue(state, key);
    const nextValue = clampNonNegative(currentValue + delta);
    const updates = {};

    if (typeof key === 'string' && key.startsWith('seedsByCrop.')) {
        const cropId = key.replace('seedsByCrop.', '');
        updates.inventory = {
            seedsByCrop: {
                ...(state.inventory?.seedsByCrop || {}),
                [cropId]: nextValue,
            },
        };
    } else if (typeof key === 'string' && key.startsWith('cropsById.')) {
        const cropId = key.replace('cropsById.', '');
        updates.inventory = {
            cropsById: {
                ...(state.inventory?.cropsById || {}),
                [cropId]: nextValue,
            },
        };
    } else {
        updates[key] = nextValue;
    }

    if (key === 'water' && nextValue > clampNonNegative(state.waterCapacity)) {
        updates.waterCapacity = nextValue;
    }

    updateState(updates);
    refreshUi();
}

function toggleFlag(flagKey) {
    const state = getState();
    const nextValue = !isCropUnlocked(state, flagKey);
    const unlocked = new Set(Array.isArray(state.unlocks?.crops) ? state.unlocks.crops : ['wheat']);

    if (nextValue) {
        unlocked.add(flagKey);
    } else if (flagKey !== 'wheat') {
        unlocked.delete(flagKey);
    }

    const updates = {
        unlocks: {
            crops: buildUnlockedCropList([...unlocked]),
        },
    };

    updateState(updates);
    refreshUi();
}

function unlockQuestSilently(questId) {
    const quest = getQuestDefinitionById(questId);
    const state = getState();
    if (!quest) {
        return false;
    }

    if (state.questsCompleted.includes(questId) || state.questsActive.includes(questId)) {
        return true;
    }

    const progressEntry = {
        ...(state.questProgress?.[questId] || {}),
        unlockedAt: Date.now(),
        acceptedAt: Date.now(),
    };

    if (quest.deliveryWindowMs) {
        progressEntry.deliveryWindowMs = quest.deliveryWindowMs;
    }

    updateState({
        questsUnlocked: state.questsUnlocked.includes(questId)
            ? [...state.questsUnlocked]
            : [...state.questsUnlocked, questId],
        questsActive: state.questsActive.includes(questId)
            ? [...state.questsActive]
            : [...state.questsActive, questId],
        questProgress: {
            ...state.questProgress,
            [questId]: progressEntry,
        },
    });
    return true;
}

function stockQuestRequirements(questId) {
    const quest = getQuestDefinitionById(questId);
    const state = getState();
    if (!quest) {
        return;
    }

    const nextCropsById = {
        ...(state.inventory?.cropsById || {}),
    };
    const unlocked = new Set(Array.isArray(state.unlocks?.crops) ? state.unlocks.crops : ['wheat']);

    cropIds.forEach((cropId) => {
        const requirement = clampNonNegative(quest.requirements?.[cropId]);
        if (!requirement) {
            return;
        }

        nextCropsById[cropId] = Math.max(getCropInventoryCount(state, cropId), requirement);
        unlocked.add(cropId);
    });

    updateState({
        inventory: {
            cropsById: nextCropsById,
        },
        unlocks: {
            crops: buildUnlockedCropList([...unlocked]),
        },
    });
}

function completeQuest(questId) {
    unlockQuestSilently(questId);
    stockQuestRequirements(questId);
    if (canDeliverQuest(questId, getState())) {
        deliverQuest(questId);
    }
    refreshUi();
}

function bumpToThreshold(updates) {
    const state = getState();
    const nextUpdates = {};

    Object.entries(updates).forEach(([key, value]) => {
        if (key === 'inventory' && value && typeof value === 'object') {
            nextUpdates.inventory = {
                ...(nextUpdates.inventory || {}),
                ...(value.seedsByCrop ? {
                    seedsByCrop: {
                        ...(state.inventory?.seedsByCrop || {}),
                        ...value.seedsByCrop,
                    },
                } : {}),
                ...(value.cropsById ? {
                    cropsById: {
                        ...(state.inventory?.cropsById || {}),
                        ...value.cropsById,
                    },
                } : {}),
            };
            return;
        }

        if (key === 'progressByCrop' && value && typeof value === 'object') {
            nextUpdates.progressByCrop = {
                ...(nextUpdates.progressByCrop || {}),
                ...(value.seedsBoughtByCrop ? {
                    seedsBoughtByCrop: {
                        ...(state.progressByCrop?.seedsBoughtByCrop || {}),
                        ...value.seedsBoughtByCrop,
                    },
                } : {}),
                ...(value.cropsSoldByCrop ? {
                    cropsSoldByCrop: {
                        ...(state.progressByCrop?.cropsSoldByCrop || {}),
                        ...value.cropsSoldByCrop,
                    },
                } : {}),
            };
            return;
        }

        if (key === 'unlocks' && value && typeof value === 'object' && Array.isArray(value.crops)) {
            nextUpdates.unlocks = {
                crops: buildUnlockedCropList(value.crops),
            };
            return;
        }

        nextUpdates[key] = Math.max(clampNonNegative(state[key]), clampNonNegative(value));
    });

    updateState(nextUpdates);
    refreshUi();
}

function unlockAchievementById(achievementId) {
    if (!achievementId) {
        return;
    }

    if (achievementId.startsWith('totalCoinsEarned-')) {
        const threshold = Number(achievementId.replace('totalCoinsEarned-', ''));
        bumpToThreshold({ totalCoinsEarned: threshold });
        return;
    }

    if (achievementId.startsWith('totalCoinsSpent-')) {
        const threshold = Number(achievementId.replace('totalCoinsSpent-', ''));
        bumpToThreshold({ totalCoinsSpent: threshold });
        return;
    }

    if (achievementId.startsWith('waterRefillsPurchased-')) {
        const threshold = Number(achievementId.replace('waterRefillsPurchased-', ''));
        bumpToThreshold({ waterRefillsPurchased: threshold });
        return;
    }

    const seedsMatch = achievementId.match(/^(wheat|corn|tomato|potato|carrot)SeedsBought-(\d+)$/);
    if (seedsMatch) {
        const [, cropId, thresholdValue] = seedsMatch;
        const threshold = Number(thresholdValue);
        const state = getState();
        const unlocked = new Set(Array.isArray(state.unlocks?.crops) ? state.unlocks.crops : ['wheat']);
        unlocked.add(cropId);

        bumpToThreshold({
            seedsBought: threshold,
            progressByCrop: {
                seedsBoughtByCrop: {
                    ...(state.progressByCrop?.seedsBoughtByCrop || {}),
                    [cropId]: threshold,
                },
            },
            unlocks: {
                crops: buildUnlockedCropList([...unlocked]),
            },
        });
        return;
    }

    const soldMatch = achievementId.match(/^(wheat|corn|tomato|potato|carrot)Sold-(\d+)$/);
    if (soldMatch) {
        const [, cropId, thresholdValue] = soldMatch;
        const threshold = Number(thresholdValue);
        const state = getState();
        const unlocked = new Set(Array.isArray(state.unlocks?.crops) ? state.unlocks.crops : ['wheat']);
        unlocked.add(cropId);

        bumpToThreshold({
            cropsSold: threshold,
            progressByCrop: {
                cropsSoldByCrop: {
                    ...(state.progressByCrop?.cropsSoldByCrop || {}),
                    [cropId]: threshold,
                },
            },
            unlocks: {
                crops: buildUnlockedCropList([...unlocked]),
            },
        });
        return;
    }

    if (achievementId === 'milestone-corn-unlocked') {
        bumpToThreshold({ totalCoinsEarned: progressionConfig.unlocks.cropsByTotalCoinsEarned.corn, unlocks: { crops: buildUnlockedCropList(['corn']) } });
        return;
    }

    if (achievementId === 'milestone-tomato-unlocked') {
        bumpToThreshold({ totalCoinsEarned: progressionConfig.unlocks.cropsByTotalCoinsEarned.tomato, unlocks: { crops: buildUnlockedCropList(['tomato']) } });
        return;
    }

    if (achievementId === 'milestone-potato-unlocked') {
        bumpToThreshold({ totalCoinsEarned: progressionConfig.unlocks.cropsByTotalCoinsEarned.potato, unlocks: { crops: buildUnlockedCropList(['potato']) } });
        return;
    }

    if (achievementId === 'milestone-carrot-unlocked') {
        bumpToThreshold({ totalCoinsEarned: progressionConfig.unlocks.cropsByTotalCoinsEarned.carrot, unlocks: { crops: buildUnlockedCropList(['carrot']) } });
        return;
    }

    if (achievementId === 'timedQuestsBeaten-1') {
        bumpToThreshold({ timedQuestsBeatenOnTime: 1 });
        return;
    }

    if (achievementId === 'timedQuestsBeaten-3') {
        bumpToThreshold({ timedQuestsBeatenOnTime: 3 });
        return;
    }

    if (achievementId === 'timedQuestsBeaten-all') {
        bumpToThreshold({ timedQuestsBeatenOnTime: 12 });
    }
}

// ── Net-Space dev helpers ─────────────────────────────────────────────────────

function buildNetspacePreset() {
    const completedQuestIds = getQuestDefinitions().slice(0, 14).map((quest) => quest.id);
    const activeQuestId = 'git-grocer-aisle-reset-09';

    // Build plot states: all owned, center plot pre-converted to empty module-slot
    const plotStates = Array.from({ length: FIELD_GRID_CAPACITY }, (_, i) => {
        const isCenter = i === FIELD_CENTER_INDEX;
        const base = {
            owned: true,
            symbol: isCenter ? '⚙' : '~',
            cropType: null,
            waterCount: 0,
            disabledUntil: 0,
            lastCompletedCropType: null,
            fallowPenaltySteps: 0,
            lastFallowDurationMs: 0,
            lastUpdatedAt: Date.now(),
            destroyed: false,
            plotType: isCenter ? 'module-slot' : 'crop',
            moduleSlotType: null,
            moduleState: null,
        };

        // Seed surrounding plots with varied crop states for Step 13 tick validation
        if (!isCenter) {
            const centerRow = Math.floor(FIELD_CENTER_INDEX / FIELD_GRID_WIDTH);
            const centerCol = FIELD_CENTER_INDEX % FIELD_GRID_WIDTH;
            const row = Math.floor(i / FIELD_GRID_WIDTH);
            const col = i % FIELD_GRID_WIDTH;
            const dist = Math.max(Math.abs(row - centerRow), Math.abs(col - centerCol));
            if (dist === 1) {
                // Immediate neighbors: various crop states so autofarmer has work to do
                const states = [
                    { symbol: '~' },
                    { symbol: '=' },
                    { symbol: '.', cropType: 'wheat', waterCount: 0 },
                    { symbol: '/', cropType: 'wheat', waterCount: 1 },
                    { symbol: '|', cropType: 'wheat', waterCount: 2 },
                    { symbol: '\\', cropType: 'wheat', waterCount: 3 },
                    { symbol: '¥', cropType: 'wheat', waterCount: 4 },
                    { symbol: '¥', cropType: 'wheat', waterCount: 4 },
                ];
                const neighborIndex = [
                    FIELD_CENTER_INDEX - FIELD_GRID_WIDTH - 1,
                    FIELD_CENTER_INDEX - FIELD_GRID_WIDTH,
                    FIELD_CENTER_INDEX - FIELD_GRID_WIDTH + 1,
                    FIELD_CENTER_INDEX - 1,
                    FIELD_CENTER_INDEX + 1,
                    FIELD_CENTER_INDEX + FIELD_GRID_WIDTH - 1,
                    FIELD_CENTER_INDEX + FIELD_GRID_WIDTH,
                    FIELD_CENTER_INDEX + FIELD_GRID_WIDTH + 1,
                ].indexOf(i);
                if (neighborIndex !== -1) {
                    return { ...base, ...states[neighborIndex] };
                }
            }
        }
        return base;
    });

    return {
        world: { netSpaceUnlocked: true },
        gameState: {
            coins: 5000,
            water: 120,
            waterCapacity: 120,
            ...buildNormalizedCropState({
                seedsByCrop: { wheat: 500, corn: 200, tomato: 200, potato: 200, carrot: 200 },
                cropsById: { wheat: 0, corn: 0, tomato: 0, potato: 0, carrot: 0 },
                unlockedCropIds: ['corn', 'tomato', 'potato', 'carrot'],
            }),
            totalCoinsEarned: 98000,
            totalCoinsSpent: 62000,
            destroyPlotUnlocked: true,
            restorePlotUnlocked: true,
            fields: {
                'field-1': {
                    id: 'field-1',
                    name: 'Field 1',
                    plots: FIELD_GRID_CAPACITY,
                    plotStates,
                },
            },
            ownedFieldIds: ['field-1'],
            activeFieldId: 'field-1',
            nextFieldNumber: 2,
            questProgress: {
                ...createQuestProgress(completedQuestIds),
                ...createActiveQuestProgress(activeQuestId),
            },
            questsUnlocked: [...completedQuestIds, activeQuestId],
            questsActive: [activeQuestId],
            questsCompleted: completedQuestIds,
            selectedSeedType: 'wheat',
        },
        storeValues: {},
        upgradeValues: {
            waterAutoBuyerUnlocked: true,
            waterAutoBuyerEnabled: true,
            expandedClickMk1Unlocked: true,
            expandedClickMk1Purchased: true,
            expandedClickMk1Enabled: true,
        },
    };
}

function applyNetspacePreset() {
    const snapshot = buildNetspacePreset();
    window[DEV_PRESET_RELOAD_FLAG] = true;
    savePartialSnapshot({
        world: {
            ...buildPresetWorldState(),
            ...(snapshot.world || {}),
        },
        nodes: { [DEFAULT_FARM_NODE_ID]: snapshot.gameState },
    });
    window.location.reload();
}

function convertPlotDev(plotIndex) {
    const nodeId = getState().id;
    const ok = convertPlot(nodeId, plotIndex);
    if (!ok) {
        const cost = getConversionCost(nodeId);
        // eslint-disable-next-line no-console
        console.warn(`[DevPanel] convertPlot failed for index ${plotIndex}. Cost: ¤${cost}. Check: plot owned, type='crop', no active crop, sufficient coins.`);
    }
    refreshUi();
}

function buildAutofarmDev(plotIndex) {
    const nodeId = getState().id;
    const result = buildAutofarmer(nodeId, plotIndex);
    if (!result.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[DevPanel] buildAutofarmer failed for index ${plotIndex}: ${result.error}`);
    }
    refreshUi();
}

function toggleNetspaceUnlocked() {
    const world = getWorldState();
    dispatchWorldAction({
        type: 'world.patch',
        payload: {
            updates: {
                netSpaceUnlocked: !world.netSpaceUnlocked,
            },
        },
        meta: { source: 'devPanel.toggleNetspaceUnlocked' },
    });
    refreshUi();
}

function navigateToScene(sceneName) {
    const nodeId = getState().id;
    transitionTo(sceneName, sceneName !== 'worldMap' ? nodeId : null);
}

// ── End Net-Space dev helpers ─────────────────────────────────────────────────

function getQuestStatus(questId, state) {
    if (state.questsCompleted.includes(questId)) {
        return { label: 'Completed', tone: 'good' };
    }

    if (state.questsActive.includes(questId)) {
        return { label: 'Active', tone: 'warn' };
    }

    if (state.questsUnlocked.includes(questId)) {
        return { label: 'Unlocked', tone: 'warn' };
    }

    return { label: 'Locked', tone: 'muted' };
}

function getAchievementEntries() {
    const entries = [];
    const { achievements, unlocks } = progressionConfig;

    achievements.totalCoinsEarned.forEach((threshold) => {
        entries.push({ id: `totalCoinsEarned-${threshold}`, label: `Coins Earned ${threshold}` });
    });
    achievements.totalCoinsSpent.forEach((threshold) => {
        entries.push({ id: `totalCoinsSpent-${threshold}`, label: `Coins Spent ${threshold}` });
    });
    achievements.waterRefillsPurchased.forEach((threshold) => {
        entries.push({ id: `waterRefillsPurchased-${threshold}`, label: `Water Refills ${threshold}` });
    });

    Object.entries(achievements.seedsBought).forEach(([cropId, thresholds]) => {
        thresholds.forEach((threshold) => {
            entries.push({ id: `${cropId}SeedsBought-${threshold}`, label: `${getCropLabel(cropId)} Seeds ${threshold}` });
        });
    });

    Object.entries(achievements.cropsSold).forEach(([cropId, thresholds]) => {
        thresholds.forEach((threshold) => {
            entries.push({ id: `${cropId}Sold-${threshold}`, label: `${getCropLabel(cropId)} Sold ${threshold}` });
        });
    });

    entries.push(
        { id: 'milestone-corn-unlocked', label: `Unlock Corn (${unlocks.cropsByTotalCoinsEarned.corn} earned)` },
        { id: 'milestone-tomato-unlocked', label: `Unlock Tomato (${unlocks.cropsByTotalCoinsEarned.tomato} earned)` },
        { id: 'milestone-potato-unlocked', label: `Unlock Potato (${unlocks.cropsByTotalCoinsEarned.potato} earned)` },
        { id: 'milestone-carrot-unlocked', label: `Unlock Carrot (${unlocks.cropsByTotalCoinsEarned.carrot} earned)` },
        { id: 'timedQuestsBeaten-1', label: 'Timed Quests: 1' },
        { id: 'timedQuestsBeaten-3', label: 'Timed Quests: 3' },
        { id: 'timedQuestsBeaten-all', label: 'Timed Quests: All' },
    );

    return entries;
}

function getAchievementStatus(achievementId, state) {
    if (achievementId === 'milestone-corn-unlocked') {
        return isCropUnlocked(state, 'corn');
    }

    if (achievementId === 'milestone-tomato-unlocked') {
        return isCropUnlocked(state, 'tomato');
    }

    if (achievementId === 'milestone-potato-unlocked') {
        return isCropUnlocked(state, 'potato');
    }

    if (achievementId === 'milestone-carrot-unlocked') {
        return isCropUnlocked(state, 'carrot');
    }

    return state.achievementsUnlocked.includes(achievementId);
}

function getQuestRowsMarkup(state) {
    return getQuestDefinitions().map((quest) => {
        const status = getQuestStatus(quest.id, state);
        return `
            <div class="dev-panel-list-row">
                <div class="dev-panel-list-head">
                    <strong>${quest.name}</strong>
                    <span class="dev-panel-pill" data-tone="${status.tone}">${status.label}</span>
                </div>
                <span class="dev-panel-meta">${quest.id}</span>
                <div class="dev-panel-button-row">
                    <button type="button" data-action="unlock-quest" data-quest-id="${quest.id}">Unlock</button>
                    <button type="button" data-action="stock-quest" data-quest-id="${quest.id}">Stock</button>
                    <button type="button" data-action="complete-quest" data-quest-id="${quest.id}">Complete</button>
                </div>
            </div>
        `;
    }).join('');
}

function getAchievementRowsMarkup(state) {
    return getAchievementEntries().map((achievement) => {
        const unlocked = getAchievementStatus(achievement.id, state);
        return `
            <div class="dev-panel-list-row">
                <div class="dev-panel-list-head">
                    <strong>${achievement.label}</strong>
                    <span class="dev-panel-pill" data-tone="${unlocked ? 'good' : 'muted'}">${unlocked ? 'Unlocked' : 'Locked'}</span>
                </div>
                <span class="dev-panel-meta">${achievement.id}</span>
                <div class="dev-panel-button-row">
                    <button type="button" data-action="unlock-achievement" data-achievement-id="${achievement.id}">Unlock</button>
                </div>
            </div>
        `;
    }).join('');
}

function getFlagsMarkup(state) {
    return flagDefinitions.map((flag) => `
        <div class="dev-panel-flag">
            <span>${flag.label}</span>
            <button type="button" data-action="toggle-flag" data-flag-key="${flag.key}">${isCropUnlocked(state, flag.key) ? 'On' : 'Off'}</button>
        </div>
    `).join('');
}

function render() {
    if (!panelRoot) {
        return;
    }

    const state = getState();
    const worldStateLoggingEnabled = isWorldStateLoggingEnabled();
    const selectedResource = resourceDefinitions.find((entry) => entry.key === uiState.resourceKey) || resourceDefinitions[0];
    const selectedValue = getResourceValue(state, selectedResource.key);

    panelRoot.dataset.visible = String(uiState.visible);
    panelRoot.dataset.minimized = String(uiState.minimized);
    panelRoot.innerHTML = `
        <div class="dev-panel-titlebar">
            <div>
                <p class="dev-panel-title">ASCII FARMER DEV PANEL</p>
                <span class="dev-panel-kbd">Ctrl+Shift+D to toggle</span>
            </div>
            <div class="dev-panel-titlebar-actions">
                <button type="button" data-action="toggle-minimize">${uiState.minimized ? 'Expand' : 'Collapse'}</button>
                <button type="button" data-action="hide-panel">Hide</button>
            </div>
        </div>
        <div class="dev-panel-body">
            <section class="dev-panel-section">
                <p class="dev-panel-section-title">Snapshot</p>
                <div class="dev-panel-status-grid">
                    <div class="dev-panel-status-card">
                        <span class="dev-panel-status-label">Coins</span>
                        <strong>${formatNumber(state.coins)}</strong>
                    </div>
                    <div class="dev-panel-status-card">
                        <span class="dev-panel-status-label">Water</span>
                        <strong>${formatNumber(state.water)} / ${formatNumber(state.waterCapacity)}</strong>
                    </div>
                    <div class="dev-panel-status-card">
                        <span class="dev-panel-status-label">Earned / Spent</span>
                        <strong>${formatNumber(state.totalCoinsEarned)} / ${formatNumber(state.totalCoinsSpent)}</strong>
                    </div>
                    <div class="dev-panel-status-card">
                        <span class="dev-panel-status-label">Fields / Quests</span>
                        <strong>${state.ownedFieldIds.length} / ${state.questsCompleted.length}</strong>
                    </div>
                </div>
                <div class="dev-panel-flag">
                    <span>WorldState Console Log</span>
                    <button type="button" data-action="toggle-worldstate-logging">${worldStateLoggingEnabled ? 'On' : 'Off'}</button>
                </div>
                <div class="dev-panel-button-row">
                    <button type="button" data-action="log-worldstate-snapshot">Log Snapshot Once</button>
                </div>
            </section>

            <section class="dev-panel-section">
                <p class="dev-panel-section-title">Currencies</p>
                <div class="dev-panel-row">
                    <select class="dev-panel-select" id="dev-panel-resource-key">
                        ${resourceDefinitions.map((entry) => `<option value="${entry.key}" ${entry.key === selectedResource.key ? 'selected' : ''}>${entry.label}</option>`).join('')}
                    </select>
                    <input class="dev-panel-input" id="dev-panel-resource-amount" type="number" min="0" step="1" value="${uiState.amount}">
                </div>
                <p class="dev-panel-summary">Selected: ${selectedResource.label} (${formatNumber(selectedValue)})</p>
                <div class="dev-panel-button-row">
                    <button type="button" data-action="set-amount" data-amount="10">10</button>
                    <button type="button" data-action="set-amount" data-amount="100">100</button>
                    <button type="button" data-action="set-amount" data-amount="1000">1000</button>
                    <button type="button" data-action="adjust-resource" data-direction="add">Add ${formatNumber(getSelectedAmount())}</button>
                    <button type="button" data-action="adjust-resource" data-direction="subtract">Subtract ${formatNumber(getSelectedAmount())}</button>
                </div>
            </section>

            <section class="dev-panel-section">
                <p class="dev-panel-section-title">Progression Presets</p>
                <p class="dev-panel-summary">Applies a full save snapshot and reloads the game into that point of progression.</p>
                <div class="dev-panel-button-row">
                    <button type="button" data-action="apply-preset" data-preset="fresh">Fresh Start</button>
                    <button type="button" data-action="apply-preset" data-preset="early">Early Game</button>
                    <button type="button" data-action="apply-preset" data-preset="mid">Mid Game</button>
                    <button type="button" data-action="apply-preset" data-preset="late">Late Game</button>
                </div>
            </section>

            <section class="dev-panel-section">
                <p class="dev-panel-section-title">Unlock Flags</p>
                <div class="dev-panel-flags">
                    ${getFlagsMarkup(state)}
                </div>
            </section>

            <section class="dev-panel-section">
                <p class="dev-panel-section-title">Quests</p>
                <div class="dev-panel-list">
                    ${getQuestRowsMarkup(state)}
                </div>
            </section>

            <section class="dev-panel-section">
                <p class="dev-panel-section-title">Achievements</p>
                <div class="dev-panel-list">
                    ${getAchievementRowsMarkup(state)}
                </div>
            </section>

            <section class="dev-panel-section">
                <p class="dev-panel-section-title">Net-Space Dev</p>
                <div class="dev-panel-button-row">
                    <button type="button" data-action="navigate-scene" data-scene="desktop">→ Desktop</button>
                    <button type="button" data-action="navigate-scene" data-scene="nodeOverview">→ Node Overview</button>
                    <button type="button" data-action="navigate-scene" data-scene="worldMap">→ World Map</button>
                </div>
                <div class="dev-panel-row">
                    <select class="dev-panel-select" id="dev-panel-netspace-slot">
                        ${Array.from({ length: FIELD_GRID_CAPACITY }, (_, i) => `<option value="${i}" ${i === Number(uiState.netspaceSlotIndex) ? 'selected' : ''}>Plot ${i}${i === FIELD_CENTER_INDEX ? ' (center)' : ''}</option>`).join('')}
                    </select>
                    <button type="button" data-action="convert-plot">Convert Plot</button>
                </div>
                <div class="dev-panel-row">
                    <button type="button" data-action="build-autofarmer">Build Autofarmer S1R1 (¤${getAutofarmCost()})</button>
                </div>
                <div class="dev-panel-flags">
                    <div class="dev-panel-flag">
                        <span>netSpaceUnlocked</span>
                        <button type="button" data-action="toggle-netspace-unlocked">${getWorldState().netSpaceUnlocked ? 'On' : 'Off'}</button>
                    </div>
                </div>
                <p class="dev-panel-summary">One-click: late-game coins + all crops unlocked + center plot as empty module slot + surrounding plots seeded for autofarmer tick demo.</p>
                <div class="dev-panel-button-row">
                    <button type="button" data-action="apply-netspace-preset">Netspace Ready (reload)</button>
                </div>
            </section>
        </div>
    `;
}

function handlePanelClick(event) {
    const target = event.target.closest('button[data-action]');
    if (!target) {
        return;
    }

    const { action } = target.dataset;

    if (action === 'toggle-minimize') {
        uiState.minimized = !uiState.minimized;
        render();
        return;
    }

    if (action === 'hide-panel') {
        uiState.visible = false;
        render();
        return;
    }

    if (action === 'set-amount') {
        uiState.amount = String(target.dataset.amount || '0');
        render();
        return;
    }

    if (action === 'toggle-worldstate-logging') {
        setWorldStateLoggingEnabled(!isWorldStateLoggingEnabled());
        render();
        return;
    }

    if (action === 'log-worldstate-snapshot') {
        const wasEnabled = isWorldStateLoggingEnabled();
        if (!wasEnabled) {
            setWorldStateLoggingEnabled(true);
        }
        logWorldState();
        if (!wasEnabled) {
            setWorldStateLoggingEnabled(false);
        }
        render();
        return;
    }

    if (action === 'adjust-resource') {
        const direction = target.dataset.direction === 'subtract' ? -1 : 1;
        adjustResource(uiState.resourceKey, direction * getSelectedAmount());
        return;
    }

    if (action === 'apply-preset') {
        applyPreset(target.dataset.preset || '');
        return;
    }

    if (action === 'toggle-flag') {
        toggleFlag(target.dataset.flagKey || '');
        return;
    }

    if (action === 'unlock-quest') {
        unlockQuestSilently(target.dataset.questId || '');
        refreshUi();
        return;
    }

    if (action === 'stock-quest') {
        stockQuestRequirements(target.dataset.questId || '');
        refreshUi();
        return;
    }

    if (action === 'complete-quest') {
        completeQuest(target.dataset.questId || '');
        return;
    }

    if (action === 'unlock-achievement') {
        unlockAchievementById(target.dataset.achievementId || '');
        return;
    }

    if (action === 'navigate-scene') {
        navigateToScene(target.dataset.scene || 'desktop');
        return;
    }

    if (action === 'convert-plot') {
        convertPlotDev(Number(uiState.netspaceSlotIndex));
        return;
    }

    if (action === 'build-autofarmer') {
        buildAutofarmDev(Number(uiState.netspaceSlotIndex));
        return;
    }

    if (action === 'toggle-netspace-unlocked') {
        toggleNetspaceUnlocked();
        return;
    }

    if (action === 'apply-netspace-preset') {
        applyNetspacePreset();
    }
}

function handlePanelInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) {
        return;
    }

    if (target.id === 'dev-panel-resource-key') {
        uiState.resourceKey = target.value;
        render();
        return;
    }

    if (target.id === 'dev-panel-resource-amount') {
        uiState.amount = target.value;
        render();
        return;
    }

    if (target.id === 'dev-panel-netspace-slot') {
        uiState.netspaceSlotIndex = target.value;
        render();
        return;
    }
}

function togglePanel(forceVisible) {
    uiState.visible = typeof forceVisible === 'boolean' ? forceVisible : !uiState.visible;
    render();
}

function mountPanel() {
    if (panelRoot) {
        return;
    }

    panelRoot = document.createElement('aside');
    panelRoot.id = DEV_PANEL_ID;
    panelRoot.setAttribute('aria-label', 'Developer Panel');
    panelRoot.dataset.visible = 'false';
    panelRoot.dataset.minimized = 'false';
    panelRoot.addEventListener('click', handlePanelClick);
    panelRoot.addEventListener('input', handlePanelInput);
    panelRoot.addEventListener('change', handlePanelInput);
    document.body.appendChild(panelRoot);
    render();
}

function registerShortcuts() {
    document.addEventListener('keydown', (event) => {
        if (event.defaultPrevented || event.isComposing || event.repeat) {
            return;
        }

        if (!(event.ctrlKey && event.shiftKey) || event.altKey || event.metaKey) {
            return;
        }

        if (event.key.toLowerCase() !== 'd') {
            return;
        }

        if (isEditableElement(document.activeElement)) {
            return;
        }

        event.preventDefault();
        togglePanel();
    });
}

function initializeDevPanel() {
    if (initialized || !isLocalDevEnvironment() || typeof document === 'undefined') {
        return;
    }

    initialized = true;
    ensureStyles();
    mountPanel();
    registerShortcuts();
    document.addEventListener('stateUpdated', render);

    Object.defineProperty(window, DEV_PANEL_API_NAME, {
        configurable: true,
        enumerable: false,
        value: Object.freeze({
            open: () => togglePanel(true),
            close: () => togglePanel(false),
            toggle: () => togglePanel(),
            applyPreset,
            refresh: refreshUi,
            resetAuxiliarySnapshots: () => {
                saveAuxiliarySnapshots({}, {});
                applyStateSnapshot({});
                refreshUi();
            },
        }),
        writable: false,
    });
}

export { initializeDevPanel };