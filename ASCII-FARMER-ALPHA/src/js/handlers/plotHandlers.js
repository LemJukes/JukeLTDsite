import { getActiveNodeState as getState, updateActiveNodeState as updateState, incrementTotalClicks } from '../worldState.js';
import { getCropConfig, getGrowthSymbol, getCropIds, getCropLabel } from '../configs/cropConfig.js';
import { progressionConfig } from '../configs/progressionConfig.js';
import { TOOLS, WATERING_SYMBOLS, HARVEST_SYMBOLS, getRequiredToolForSymbol } from '../configs/toolConfig.js';
import { trackAchievements } from './achievementHandlers.js';
import {
    isFallowFatigueUnlocked,
    getPlotDisabledTime,
    getNormalizedFallowPenaltySteps,
    getPlotFallowDurationMs,
    applyPlotFallowAfterHarvest,
} from '../domain/farming/plotFallow.js';
import {
    FIELD_GRID_WIDTH,
    FIELD_GRID_CAPACITY,
    getAvailablePlotPurchaseIndices,
} from '../configs/fieldGridConfig.js';
import { isCropUnlocked, getCropSeedCount, getCropInventoryCount } from '../state/nodeCropView.js';

const GRID_WIDTH = FIELD_GRID_WIDTH;
const OUT_OF_CHARGES_MESSAGE = 'Auto-Changer is out of charges. Buy more charges in Upgrades.';
const AUTOFARMER_ASSET_DIR = './src/assets/AutoFarmer';
const AUTOFARMER_SPRITE_PATHS = {
    light: `${AUTOFARMER_ASSET_DIR}/AutoFarmer.gif`,
    dark: `${AUTOFARMER_ASSET_DIR}/AutoFarmerDark.gif`,
    error: `${AUTOFARMER_ASSET_DIR}/AutoFarmerError.gif`,
};
const EXPANDED_CLICK_LEVEL_DELAY_MS = 100;
const EXPANDED_CLICK_PATTERNS = {
    1: [[0, -1], [0, 1]],
    2: [[-1, 0], [1, 0]],
    3: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
    4: createSquareRingOffsets(2),
    5: createSquareRingOffsets(3),
    6: createSquareRingOffsets(4),
};

const DEFAULT_PLOT_EFFECTS = {
    updateResourceBar: () => {},
    getUpgradeValues: () => ({}),
    updateUpgradeValues: () => {},
    renderClickUpgradesSection: () => {},
    playPlotBubbleForState: () => {},
    playAdjacentBubbleForState: () => {},
    updateClicksDisplay: () => {},
    updateToolboxDisplay: () => {},
    showNotification: () => {},
    getPlotButtonByIndex: () => null,
};

let plotEffects = { ...DEFAULT_PLOT_EFFECTS };

function configurePlotHandlerAdapters(adapters = {}) {
    const nextEffects = { ...plotEffects };
    Object.entries(adapters).forEach(([name, fn]) => {
        if (typeof fn === 'function') {
            nextEffects[name] = fn;
        }
    });

    plotEffects = nextEffects;
}

function runPlotEffect(name, ...args) {
    const effectFn = plotEffects[name];
    if (typeof effectFn === 'function') {
        return effectFn(...args);
    }

    return undefined;
}

function createSquareRingOffsets(radius) {
    const offsets = [];

    for (let rowOffset = -radius; rowOffset <= radius; rowOffset++) {
        for (let colOffset = -radius; colOffset <= radius; colOffset++) {
            if (Math.max(Math.abs(rowOffset), Math.abs(colOffset)) !== radius) {
                continue;
            }

            offsets.push([rowOffset, colOffset]);
        }
    }

    return offsets;
}

function getSelectedTool(gameState) {
    return gameState.selectedTool || TOOLS.PLOW;
}

function getWrongToolMessage(currentSymbol) {
    if (currentSymbol === '~') {
        return `You need the ${TOOLS.PLOW} selected to till this plot.`;
    }

    if (currentSymbol === '=') {
        return `You need the ${TOOLS.SEED_BAG} selected to plant seeds.`;
    }

    if (WATERING_SYMBOLS.includes(currentSymbol)) {
        return `You need the ${TOOLS.WATERING_CAN} selected to water crops.`;
    }

    return 'You need the correct tool selected for this action.';
}

function getSelectedSeedType(gameState) {
    const unlockedSeeds = getUnlockedSeedTypes(gameState);
    if (unlockedSeeds.includes(gameState.selectedSeedType)) {
        return gameState.selectedSeedType;
    }

    return 'wheat';
}

function getUnlockedSeedTypes(gameState) {
    return getCropIds().filter((cropId) => isCropUnlocked(gameState, cropId));
}

function decrementSeedInventory(gameState, cropId, amount = 1) {
    const nextSeedsByCrop = {
        ...(gameState.inventory?.seedsByCrop || {}),
        [cropId]: Math.max(0, getCropSeedCount(gameState, cropId) - Math.max(1, Number(amount) || 1)),
    };

    updateState({
        inventory: {
            seedsByCrop: nextSeedsByCrop,
        },
    });
}

function incrementCropInventory(gameState, cropId, amount = 1) {
    const nextCropsById = {
        ...(gameState.inventory?.cropsById || {}),
        [cropId]: Math.max(0, getCropInventoryCount(gameState, cropId) + Math.max(1, Number(amount) || 1)),
    };

    updateState({
        inventory: {
            cropsById: nextCropsById,
        },
    });
}

function getActiveFieldContext(fieldIdOverride = null) {
    const gameState = getState();
    const activeFieldId = typeof fieldIdOverride === 'string' && fieldIdOverride.length > 0
        ? fieldIdOverride
        : gameState.activeFieldId;
    const activeField = gameState.fields?.[activeFieldId];

    if (!activeField || !Array.isArray(activeField.plotStates)) {
        return null;
    }

    return {
        gameState,
        activeField,
        activeFieldId,
        plotStates: activeField.plotStates,
    };
}

function getMutableFieldContext(gameState, fieldIdOverride = null) {
    const activeFieldId = typeof fieldIdOverride === 'string' && fieldIdOverride.length > 0
        ? fieldIdOverride
        : gameState?.activeFieldId;
    const activeField = gameState?.fields?.[activeFieldId];

    if (!activeField || !Array.isArray(activeField.plotStates)) {
        return null;
    }

    const plotStates = activeField.plotStates.map((plotState) => (
        plotState && typeof plotState === 'object'
            ? { ...plotState }
            : plotState
    ));

    return {
        gameState,
        activeFieldId,
        activeField: {
            ...activeField,
            plotStates,
        },
        plotStates,
    };
}

function isOwnedPlot(plotState) {
    return Boolean(plotState?.owned);
}

function isPlotPurchaseEligible(field, plotIndex) {
    if (!field || !Array.isArray(field.plotStates) || !Number.isInteger(plotIndex)) {
        return false;
    }

    const availableIndices = getAvailablePlotPurchaseIndices(field);
    return availableIndices.includes(plotIndex);
}

function createOwnedPlotState() {
    return {
        owned: true,
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

function commitActiveFieldPlotStates(gameState, activeFieldId, plotStates, updatedPlots) {
    const existingField = gameState.fields?.[activeFieldId];
    if (!existingField) {
        return;
    }

    const nextField = {
        ...existingField,
        plots: Number(updatedPlots) || existingField.plots,
        plotStates,
    };

    updateState({
        fields: {
            ...gameState.fields,
            [activeFieldId]: nextField,
        },
    });
}

function getAverageFieldFallowDurationMs(field, gameState = getState()) {
    if (!field || !Array.isArray(field.plotStates) || field.plotStates.length === 0) {
        return getPlotDisabledTime(field?.plots);
    }

    const ownedPlotStates = field.plotStates.filter((plotState) => plotState?.owned);
    if (!ownedPlotStates.length) {
        return getPlotDisabledTime(field?.plots);
    }

    const totalFallowDurationMs = ownedPlotStates.reduce(
        (sum, plotState) => sum + getPlotFallowDurationMs(plotState, field.plots, gameState),
        0,
    );

    return totalFallowDurationMs / ownedPlotStates.length;
}

function formatFallowDurationMs(durationMs) {
    const seconds = Math.max(0, Number(durationMs) || 0) / 1000;
    return `${seconds.toFixed(1)}s`;
}

function getAutoChangerRequiredTool(currentSymbol) {
    const requiredTool = getRequiredToolForSymbol(currentSymbol);

    if (requiredTool) {
        return requiredTool;
    }

    if (HARVEST_SYMBOLS.includes(currentSymbol)) {
        return TOOLS.SCYTHE;
    }

    return null;
}

function getPlotStateLabel(plotState, now = Date.now()) {
    if (plotState?.destroyed) {
        return 'Destroyed';
    }

    if (Number(plotState?.disabledUntil) > now) {
        return 'Fallow';
    }

    const symbol = plotState?.symbol;

    if (symbol === '~') {
        return 'Untilled';
    }

    if (symbol === '=') {
        return 'Tilled';
    }

    if (symbol === '.') {
        return 'Planted';
    }

    if (symbol === '/' || symbol === '|' || symbol === '\\') {
        return 'Growing';
    }

    if (HARVEST_SYMBOLS.includes(symbol)) {
        return 'Ready to Harvest';
    }

    return 'Unknown';
}

function getRequiredToolLabel(plotState, now = Date.now()) {
    if (!isOwnedPlot(plotState)) {
        return 'None';
    }

    if (plotState?.destroyed) {
        return 'None';
    }

    if (Number(plotState?.disabledUntil) > now) {
        return 'None';
    }

    return getAutoChangerRequiredTool(plotState?.symbol) || 'None';
}

function getAutofarmerHoverText(plotState, plotIndex) {
    const plotNumber = Number(plotIndex) + 1;
    const moduleState = plotState?.moduleState;

    if (plotState?.moduleSlotType !== 'autofarmer' || !moduleState) {
        return `Plot: ${plotNumber}\nState: Module Tunnel\nModule: Empty slot`;
    }

    const status = moduleState.paused
        ? 'Paused'
        : moduleState.isStalled
            ? 'Stalled'
            : 'Active';
    const orderLength = Array.isArray(moduleState.clockwiseOrder) ? moduleState.clockwiseOrder.length : 0;
    const cursor = Number(moduleState.clockCursor) || 0;
    const currentTarget = orderLength > 0
        ? moduleState.clockwiseOrder[cursor % orderLength] + 1
        : null;

    return [
        `Plot: ${plotNumber}`,
        `State: Autofarmer ${status}`,
        `Module: Base Autofarmer`,
        `Range: Ring 1 (${orderLength} plots)`,
        `Cursor: ${orderLength > 0 ? `${(cursor % orderLength) + 1}/${orderLength}` : '0/0'}`,
        currentTarget ? `Target Plot: ${currentTarget}` : 'Target Plot: None',
    ].join('\n');
}

function buildPlotHoverText(plotState, plotIndex, now = Date.now()) {
    const plotNumber = Number(plotIndex) + 1;
    if (!isOwnedPlot(plotState)) {
        return `Plot: ${plotNumber}\nState: Unowned\nRequired Tool: None`;
    }

    if (plotState?.plotType === 'module-slot') {
        return getAutofarmerHoverText(plotState, plotIndex);
    }

    const plotStateLabel = getPlotStateLabel(plotState, now);
    const requiredToolLabel = getRequiredToolLabel(plotState, now);
    const gameState = getState();
    const isFallowFatigueVisible = isFallowFatigueUnlocked(gameState);
    const activeFieldPlots = Number(gameState.fields?.[gameState.activeFieldId]?.plots) || 1;
    const fallowDurationMs = Number(plotState?.lastFallowDurationMs) > 0
        ? Number(plotState.lastFallowDurationMs)
        : getPlotFallowDurationMs(plotState, activeFieldPlots, gameState);
    const remainingFallowDurationMs = Math.max(0, Number(plotState?.disabledUntil) - now);
    const fallowPenaltySteps = getNormalizedFallowPenaltySteps(plotState, activeFieldPlots, gameState);
    const fallowText = plotState?.destroyed
        ? ''
        : [
            `\nFallow Period: ${formatFallowDurationMs(fallowDurationMs)}`,
            remainingFallowDurationMs > 0 ? `\nFallow Remaining: ${formatFallowDurationMs(remainingFallowDurationMs)}` : '',
            isFallowFatigueVisible ? `\nRotation Fatigue: +${fallowPenaltySteps} step${fallowPenaltySteps === 1 ? '' : 's'}` : '',
        ].join('');

    return `Plot: ${plotNumber}\nState: ${plotStateLabel}\nRequired Tool: ${requiredToolLabel}${fallowText}`;
}

function syncPlotButtonPresentation(plot, plotState, plotIndex, now = Date.now()) {
    if (!plot || !plotState) {
        return;
    }

    plot.classList.remove('destroyed-plot', 'unowned-plot', 'plot-purchase-eligible', 'autofarmer-plot', 'autofarmer-error');

    if (!isOwnedPlot(plotState)) {
        const gameState = getState();
        const activeField = gameState.fields?.[gameState.activeFieldId];
        const isPurchaseEligible = gameState.plotSelectionMode === 'buyPlot' && isPlotPurchaseEligible(activeField, plotIndex);

        plot.innerHTML = '';
        plot.textContent = '';
        plot.disabled = !isPurchaseEligible;
        plot.classList.add('unowned-plot');

        if (isPurchaseEligible) {
            plot.classList.add('plot-purchase-eligible');
        }

        const nextTitle = buildPlotHoverText(plotState, plotIndex, now);
        if (plot.title !== nextTitle) {
            plot.title = nextTitle;
        }

        return;
    }

    // ── Autofarmer module slot — render GIF sprites ───────────────────────────
    if (plotState.plotType === 'module-slot' && plotState.moduleSlotType === 'autofarmer') {
        const ms = plotState.moduleState;
        const isError = Boolean(ms?.isStalled);

        if (!plot.querySelector('.autofarmer-gif-light')) {
            plot.innerHTML = [
                `<img class="autofarmer-gif autofarmer-gif-light" src="${AUTOFARMER_SPRITE_PATHS.light}" alt="AutoFarmer">`,
                `<img class="autofarmer-gif autofarmer-gif-dark-ver" src="${AUTOFARMER_SPRITE_PATHS.dark}" alt="AutoFarmer">`,
                `<img class="autofarmer-gif autofarmer-gif-error" src="${AUTOFARMER_SPRITE_PATHS.error}" alt="AutoFarmer error">`,
            ].join('');
        }

        plot.disabled = false;
        plot.classList.add('autofarmer-plot');
        if (isError) {
            plot.classList.add('autofarmer-error');
        }

        const nextTitle = buildPlotHoverText(plotState, plotIndex, now);
        if (plot.title !== nextTitle) {
            plot.title = nextTitle;
        }
        return;
    }

    if (plotState.destroyed) {
        plot.textContent = 'âŠ ';
        plot.disabled = true;
        plot.classList.add('destroyed-plot');
    } else {
        plot.textContent = plotState.symbol;
        plot.disabled = Number(plotState.disabledUntil) > now;
    }

    const nextTitle = buildPlotHoverText(plotState, plotIndex, now);
    if (plot.title !== nextTitle) {
        plot.title = nextTitle;
    }
}

function handlePlotSelectionInteraction(plot, plotIndex, context) {
    const mode = context.gameState.plotSelectionMode;
    if (!mode) {
        return false;
    }

    const gameState = context.gameState;
    const activeField = gameState.fields?.[context.activeFieldId];
    if (!activeField || !Array.isArray(activeField.plotStates)) {
        updateState({ plotSelectionMode: null, pendingPlotPurchase: null });
        return true;
    }

    const plotStates = activeField.plotStates;
    const plotState = plotStates[plotIndex];
    if (!plotState) {
        return true;
    }

    if (mode === 'buyPlot') {
        const pendingPurchase = gameState.pendingPlotPurchase;
        if (!pendingPurchase || pendingPurchase.fieldId !== context.activeFieldId) {
            updateState({ plotSelectionMode: null, pendingPlotPurchase: null });
            runPlotEffect('showNotification', 'Plot purchase selection is no longer active.', 'Field Expansion');
            return true;
        }

        if (!isPlotPurchaseEligible(activeField, plotIndex)) {
            runPlotEffect('showNotification', 'Select an available slot adjacent to an owned plot.', 'Field Expansion');
            return true;
        }

        const latestState = getState();
        const latestField = latestState.fields?.[context.activeFieldId];
        if (!latestField || !Array.isArray(latestField.plotStates)) {
            updateState({ plotSelectionMode: null, pendingPlotPurchase: null });
            return true;
        }

        if (!isPlotPurchaseEligible(latestField, plotIndex)) {
            runPlotEffect('showNotification', 'That slot is no longer available. Select another adjacent slot.', 'Field Expansion');
            return true;
        }

        const purchaseCost = Math.max(0, Number(pendingPurchase.cost) || 0);
        if (Number(latestState.coins) < purchaseCost) {
            updateState({ plotSelectionMode: null, pendingPlotPurchase: null });
            runPlotEffect('showNotification', 'Not enough coins to finish this purchase.', 'Field Expansion');
            return true;
        }

        const nextPlotStates = [...latestField.plotStates];
        nextPlotStates[plotIndex] = createOwnedPlotState(nextPlotStates[plotIndex]);
        const nextPlotCount = nextPlotStates.reduce((count, entry) => count + (entry?.owned ? 1 : 0), 0);

        updateState({
            coins: Number(latestState.coins) - purchaseCost,
            totalCoinsSpent: Number(latestState.totalCoinsSpent) + purchaseCost,
            plotSelectionMode: null,
            pendingPlotPurchase: null,
            fields: {
                ...latestState.fields,
                [context.activeFieldId]: {
                    ...latestField,
                    plots: nextPlotCount,
                    plotStates: nextPlotStates,
                },
            },
        });

        runPlotEffect('updateResourceBar');
        trackAchievements();
        incrementTotalClicks();
        runPlotEffect('updateClicksDisplay');
        runPlotEffect('showNotification', `Purchased plot slot ${plotIndex + 1}.`, 'Field Expansion', 'success');
        return true;
    }

    if (!isOwnedPlot(plotState)) {
        runPlotEffect('showNotification', 'That plot slot is not unlocked yet.', 'Field');
        return true;
    }

    return false;
}

function consumeToolAutoChangerCharge(showFailureAlert) {
    const upgradeValues = runPlotEffect('getUpgradeValues') || {};
    const canAutoChange = upgradeValues.toolAutoChangerPurchased && upgradeValues.toolAutoChangerEnabled;

    if (!canAutoChange) {
        return {
            allowed: false,
            canAutoChange,
            outOfCharges: false,
        };
    }

    if ((Number(upgradeValues.toolAutoChangerCharges) || 0) < 1) {
        if (showFailureAlert) {
            runPlotEffect('showNotification', OUT_OF_CHARGES_MESSAGE, 'Tool Auto-Changer');
        }

        return {
            allowed: false,
            canAutoChange,
            outOfCharges: true,
        };
    }

    runPlotEffect('updateUpgradeValues', { toolAutoChangerCharges: upgradeValues.toolAutoChangerCharges - 1 });
    runPlotEffect('renderClickUpgradesSection');
    return {
        allowed: true,
        canAutoChange,
        outOfCharges: false,
    };
}

function resolveToolSelection(currentSymbol, showFailureAlert, options = {}) {
    const {
        skipAutoChangeCharge = false,
    } = options;

    const gameState = getState();
    const selectedTool = getSelectedTool(gameState);
    const requiredTool = getAutoChangerRequiredTool(currentSymbol);

    if (!requiredTool || selectedTool === requiredTool) {
        return {
            allowed: true,
            gameState,
            selectedTool,
        };
    }

    const upgradeValues = runPlotEffect('getUpgradeValues') || {};
    const canAutoChange = upgradeValues.toolAutoChangerPurchased && upgradeValues.toolAutoChangerEnabled;

    if (!canAutoChange) {
        if (showFailureAlert) {
            runPlotEffect('showNotification', getWrongToolMessage(currentSymbol), 'Tool Required');
        }

        return {
            allowed: false,
            gameState,
            selectedTool,
        };
    }

    if (!skipAutoChangeCharge) {
        const chargeResult = consumeToolAutoChangerCharge(showFailureAlert);
        if (!chargeResult.allowed) {
            return {
                allowed: false,
                gameState,
                selectedTool,
            };
        }
    }

    updateState({ selectedTool: requiredTool });
    runPlotEffect('updateToolboxDisplay');

    return {
        allowed: true,
        gameState: { ...gameState, selectedTool: requiredTool },
        selectedTool: requiredTool,
    };
}

function handlePlotClick(plot, plotIndex) {
    const initialContext = getActiveFieldContext();
    if (!initialContext) {
        return;
    }

    const initialPlot = initialContext.plotStates[plotIndex];
    if (!initialPlot) {
        return;
    }

    if (handlePlotSelectionInteraction(plot, plotIndex, initialContext)) {
        return;
    }

    if (!isOwnedPlot(initialPlot)) {
        return;
    }

    if (initialPlot.destroyed) {
        return;
    }

    const toolSelection = resolveToolSelection(initialPlot.symbol, true);
    if (!toolSelection.allowed) {
        return;
    }

    const gameState = toolSelection.gameState;
    const mutableContext = getMutableFieldContext(gameState);
    if (!mutableContext) {
        return;
    }

    const { activeFieldId, activeField, plotStates } = mutableContext;
    const plotState = plotStates[plotIndex];
    if (!plotState) {
        return;
    }

    const currentSymbol = plotState.symbol;
    const selectedTool = toolSelection.selectedTool;
    let didChange = false;

    switch (currentSymbol) {
        case '~': // Untilled
            // Tilling the plot requires no cost
            plotState.symbol = '=';
            plotState.disabledUntil = 0;
            plotState.lastUpdatedAt = Date.now();
            plotStates[plotIndex] = plotState;
            didChange = true;
            break;
            
        case '=': // Tilled
            const selectedSeedType = getSelectedSeedType(gameState);
            const selectedSeedLabel = getCropLabel(selectedSeedType);

            if (getCropSeedCount(gameState, selectedSeedType) < 1) {
                runPlotEffect('showNotification', `Not enough ${selectedSeedLabel} seeds!`, 'Store');
                return;
            }

            decrementSeedInventory(gameState, selectedSeedType, 1);
            
            plotState.symbol = '.';
            plotState.cropType = selectedSeedType;
            plotState.waterCount = 0;
            plotState.disabledUntil = 0;
            plotState.lastUpdatedAt = Date.now();
            plotStates[plotIndex] = plotState;
            didChange = true;
            break;
            
        case '.': // Planted - start watering
        case '/': // Growing stages
        case '|':
        case '\\':
            if (!plotState.cropType) {
                console.error('Plot is in growing state but has no crop type!');
                return;
            }
            
            if (gameState.water >= 1) {
                const cropConfig = getCropConfig(plotState.cropType);
                plotState.waterCount++;
                updateState({ water: gameState.water - 1 });
                
                // Check if crop is fully grown (use > not >= to show all growth stages)
                if (plotState.waterCount > cropConfig.waterStages) {
                    plotState.symbol = cropConfig.symbol; // Show final crop symbol (¥, ₡, ₮, ₱, or ₵)
                } else {
                    // Show oscillating growth symbol
                    plotState.symbol = getGrowthSymbol(plotState.waterCount - 1);
                }

                plotState.disabledUntil = 0;
                plotState.lastUpdatedAt = Date.now();
                plotStates[plotIndex] = plotState;

                didChange = true;
            } else {
                runPlotEffect('showNotification', 'Not enough water!', 'Water');
            }
            break;
            
        case '¥': // Grown wheat
        case '₡': // Grown corn
        case '₮': // Grown tomato
        case '₱': // Grown potato
        case '₵': // Grown carrot
            // Harvesting without scythe has a 50% chance to fail
            const hasScytheSelected = selectedTool === TOOLS.SCYTHE;
            const harvestSucceeded = hasScytheSelected || Math.random() < 0.5;
            const harvestedCropType = plotState.cropType;

            if (harvestSucceeded) {
                if (getCropIds().includes(harvestedCropType)) {
                    incrementCropInventory(gameState, harvestedCropType, 1);
                }
            } else {
                runPlotEffect('showNotification', 'Harvest missed! Select the Scythe to guarantee harvests.', 'Harvest', 'warning');
            }
            
            // Reset plot
            const harvestedPlotState = {
                ...plotState,
                symbol: '~',
                cropType: null,
                waterCount: 0,
                lastUpdatedAt: Date.now(),
            };
            plotStates[plotIndex] = applyPlotFallowAfterHarvest(harvestedPlotState, harvestedCropType, activeField.plots, gameState);
            didChange = true;
            break;
            
        default:
            console.warn(`Unknown plot symbol: ${currentSymbol}`);
            break;
    }

    if (!didChange) {
        return;
    }

    syncPlotButtonPresentation(plot, plotStates[plotIndex], plotIndex);

    runPlotEffect('playPlotBubbleForState', currentSymbol);
    incrementTotalClicks();
    runPlotEffect('updateClicksDisplay');

    // Update the game state with modified plot states
    commitActiveFieldPlotStates(gameState, activeFieldId, plotStates, activeField.plots);

    // Apply expanded click effects in tier order, with a short delay between tiers when multiple are enabled.
    const upgradeValues = runPlotEffect('getUpgradeValues') || {};
    const expandedClickActivations = [];

    if (upgradeValues.expandedClickMk1Purchased && upgradeValues.expandedClickMk1Enabled) {
        expandedClickActivations.push(() => affectAdjacentPlotsMk1(plotIndex));
    }

    if (upgradeValues.expandedClickMk2Purchased && upgradeValues.expandedClickMk2Enabled) {
        expandedClickActivations.push(() => affectAdjacentPlotsMk2(plotIndex));
    }

    if (upgradeValues.expandedClickMk3Purchased && upgradeValues.expandedClickMk3Enabled) {
        expandedClickActivations.push(() => affectAdjacentPlotsMk3(plotIndex));
    }

    if (upgradeValues.expandedClickMk4Purchased && upgradeValues.expandedClickMk4Enabled) {
        expandedClickActivations.push(() => affectAdjacentPlotsMk4(plotIndex));
    }

    if (upgradeValues.expandedClickMk5Purchased && upgradeValues.expandedClickMk5Enabled) {
        expandedClickActivations.push(() => affectAdjacentPlotsMk5(plotIndex));
    }

    if (upgradeValues.expandedClickMk6Purchased && upgradeValues.expandedClickMk6Enabled) {
        expandedClickActivations.push(() => affectAdjacentPlotsMk6(plotIndex));
    }

    if (expandedClickActivations.length <= 1) {
        expandedClickActivations.forEach((activateLevel) => activateLevel());
        runPlotEffect('updateResourceBar');
        return;
    }

    expandedClickActivations.forEach((activateLevel, levelIndex) => {
        setTimeout(() => {
            activateLevel();

            if (levelIndex === expandedClickActivations.length - 1) {
                runPlotEffect('updateResourceBar');
            }
        }, levelIndex * EXPANDED_CLICK_LEVEL_DELAY_MS);
    });
}

function applyExpandedClickPattern(index, offsets) {
    const originRow = Math.floor(index / GRID_WIDTH);
    const originCol = index % GRID_WIDTH;
    const context = getActiveFieldContext();

    offsets.forEach(([rowOffset, colOffset]) => {
        const targetRow = originRow + rowOffset;
        const targetCol = originCol + colOffset;

        if (targetRow < 0 || targetRow >= GRID_WIDTH || targetCol < 0 || targetCol >= GRID_WIDTH) {
            return;
        }

        const targetIndex = (targetRow * GRID_WIDTH) + targetCol;
        const targetPlot = runPlotEffect('getPlotButtonByIndex', targetIndex);
        const targetState = context?.plotStates?.[targetIndex];
        const now = Date.now();

        if (!targetPlot
            || !targetState?.owned
            || Number(targetState?.disabledUntil) > now
            || targetState?.destroyed) {
            return;
        }

        handleAdjacentPlotClickMk1(targetPlot, targetIndex, {
            forceAutoChangerChargePerClick: true,
        });
    });
}

// Function to affect adjacent plots if expanded click is enabled
function affectAdjacentPlotsMk1(index) {
    applyExpandedClickPattern(index, EXPANDED_CLICK_PATTERNS[1]);
}

// Function to affect adjacent plots in vertical pattern (Mk.2) - up and down only
function affectAdjacentPlotsMk2(index) {
    applyExpandedClickPattern(index, EXPANDED_CLICK_PATTERNS[2]);
}

// Function to affect adjacent plots diagonally (Mk.3) - the 4 corner plots only
function affectAdjacentPlotsMk3(index) {
    applyExpandedClickPattern(index, EXPANDED_CLICK_PATTERNS[3]);
}

// Function to affect adjacent plots in the 5x5 ring (Mk.4)
function affectAdjacentPlotsMk4(index) {
    applyExpandedClickPattern(index, EXPANDED_CLICK_PATTERNS[4]);
}

// Function to affect adjacent plots in the 7x7 ring (Mk.5)
function affectAdjacentPlotsMk5(index) {
    applyExpandedClickPattern(index, EXPANDED_CLICK_PATTERNS[5]);
}

// Function to affect adjacent plots in the 9x9 ring (Mk.6)
function affectAdjacentPlotsMk6(index) {
    applyExpandedClickPattern(index, EXPANDED_CLICK_PATTERNS[6]);
}

// Function to handle click on adjacent plots
function handleAdjacentPlotClickMk1(plot, plotIndex, options = {}) {
    const {
        ignoreToolRequirement = false,
        countClick = true,
        playSfx = true,
        forceAutoChangerChargePerClick = false,
        activeFieldId = null,
    } = options;

    const initialContext = getActiveFieldContext(activeFieldId);
    if (!initialContext) {
        return { success: false, errorCode: 'NO_FIELD', errorMessage: 'No active field context.' };
    }

    const initialPlot = initialContext.plotStates[plotIndex];
    if (!initialPlot) {
        return { success: false, errorCode: 'NO_PLOT', errorMessage: 'Target plot does not exist.' };
    }

    if (!initialPlot.owned
        || Number(initialPlot.disabledUntil) > Date.now()
        || initialPlot.destroyed) {
        return { success: false, errorCode: 'INVALID_TARGET', errorMessage: 'Target plot cannot be worked.' };
    }

    let toolSelection;
    if (ignoreToolRequirement) {
        const gameState = getState();
        toolSelection = {
            allowed: true,
            gameState,
            selectedTool: getSelectedTool(gameState),
        };
    } else {
        let shouldSkipAutoChangeCharge = false;
        if (forceAutoChangerChargePerClick) {
            const chargeResult = consumeToolAutoChangerCharge(false);
            if (!chargeResult.allowed && chargeResult.canAutoChange) {
                return { success: false, errorCode: 'OUT_OF_CHARGES', errorMessage: OUT_OF_CHARGES_MESSAGE };
            }

            shouldSkipAutoChangeCharge = chargeResult.allowed;
        }

        toolSelection = resolveToolSelection(initialPlot.symbol, false, {
            skipAutoChangeCharge: shouldSkipAutoChangeCharge,
        });
    }

    if (!toolSelection.allowed) {
        return { success: false, errorCode: 'TOOL_BLOCKED', errorMessage: 'Tool requirements not met.' };
    }

    const gameState = toolSelection.gameState;
    const resolvedActiveFieldId = typeof activeFieldId === 'string' && activeFieldId.length > 0
        ? activeFieldId
        : gameState.activeFieldId;
    const mutableContext = getMutableFieldContext(gameState, resolvedActiveFieldId);
    if (!mutableContext) {
        return { success: false, errorCode: 'NO_FIELD', errorMessage: 'No active field context.' };
    }

    const { activeField, plotStates } = mutableContext;
    const plotState = plotStates[plotIndex];
    if (!plotState) {
        return { success: false, errorCode: 'NO_PLOT', errorMessage: 'Target plot does not exist.' };
    }

    if (!plotState.owned
        || Number(plotState.disabledUntil) > Date.now()
        || plotState.destroyed) {
        return { success: false, errorCode: 'INVALID_TARGET', errorMessage: 'Target plot cannot be worked.' };
    }

    const currentSymbol = plotState.symbol;
    const selectedTool = toolSelection.selectedTool;
    let didChange = false;
    let actionType = null;
    let usedSeedType = null;

    switch (currentSymbol) {
        case '~': // Untilled
            plotState.symbol = '=';
            plotState.disabledUntil = 0;
            plotState.lastUpdatedAt = Date.now();
            plotStates[plotIndex] = plotState;
            didChange = true;
            actionType = 'tilled';
            break;
            
        case '=': // Tilled
            const selectedSeedType = getSelectedSeedType(gameState);

            if (getCropSeedCount(gameState, selectedSeedType) < 1) {
                return { success: false, errorCode: 'NO_SEEDS', errorMessage: `Not enough ${selectedSeedType} seeds.` };
            }

            decrementSeedInventory(gameState, selectedSeedType, 1);

            plotState.symbol = '.';
            plotState.cropType = selectedSeedType;
            plotState.waterCount = 0;
            plotState.disabledUntil = 0;
            plotState.lastUpdatedAt = Date.now();
            plotStates[plotIndex] = plotState;
            didChange = true;
            actionType = 'planted';
            usedSeedType = selectedSeedType;
            break;
            
        case '.': // Planted - start watering
        case '/': // Growing stages
        case '|':
        case '\\':
            if (!plotState.cropType) {
                return { success: false, errorCode: 'NO_CROP', errorMessage: 'Target plot has no crop type.' };
            }
            
            if (gameState.water >= 1) {
                const cropConfig = getCropConfig(plotState.cropType);
                plotState.waterCount++;
                updateState({ water: gameState.water - 1 });
                
                // Check if crop is fully grown (use > not >= to show all growth stages)
                if (plotState.waterCount > cropConfig.waterStages) {
                    plotState.symbol = cropConfig.symbol;
                } else {
                    // Show oscillating growth symbol
                    plotState.symbol = getGrowthSymbol(plotState.waterCount - 1);
                }

                plotState.disabledUntil = 0;
                plotState.lastUpdatedAt = Date.now();
                plotStates[plotIndex] = plotState;

                didChange = true;
                actionType = 'watered';
            }
            if (!didChange) {
                return { success: false, errorCode: 'NO_WATER', errorMessage: 'Not enough water.' };
            }
            break;
            
        case '¥': // Grown wheat
        case '₡': // Grown corn
        case '₮': // Grown tomato
        case '₱': // Grown potato
        case '₵': // Grown carrot
            const hasScytheSelected = ignoreToolRequirement || selectedTool === TOOLS.SCYTHE;
            const harvestSucceeded = hasScytheSelected || Math.random() < 0.5;
            const harvestedCropType = plotState.cropType;

            if (harvestSucceeded) {
                if (getCropIds().includes(harvestedCropType)) {
                    incrementCropInventory(gameState, harvestedCropType, 1);
                }

            }
            
            // Reset plot
            const harvestedPlotState = {
                ...plotState,
                symbol: '~',
                cropType: null,
                waterCount: 0,
                lastUpdatedAt: Date.now(),
            };
            plotStates[plotIndex] = applyPlotFallowAfterHarvest(harvestedPlotState, harvestedCropType, activeField.plots, gameState);
            didChange = true;
            actionType = 'harvested';
            break;
            
        default:
            return { success: false, errorCode: 'INVALID_STATE', errorMessage: 'Plot is not in a workable state.' };
    }

    if (!didChange) {
        return { success: false, errorCode: 'NO_CHANGE', errorMessage: 'No state change occurred.' };
    }

    if (plot) {
        syncPlotButtonPresentation(plot, plotStates[plotIndex], plotIndex);
    }

    if (playSfx) {
        runPlotEffect('playAdjacentBubbleForState', currentSymbol);
    }

    if (countClick) {
        incrementTotalClicks();
        runPlotEffect('updateClicksDisplay');
    }

    // Update the game state with modified plot states
    commitActiveFieldPlotStates(gameState, resolvedActiveFieldId, plotStates, activeField.plots);
    runPlotEffect('updateResourceBar');

    return {
        success: true,
        errorCode: null,
        errorMessage: '',
        actionType,
        usedSeedType,
    };
}

export {
    configurePlotHandlerAdapters,
    handlePlotClick,
    getPlotDisabledTime,
    getPlotFallowDurationMs,
    getAverageFieldFallowDurationMs,
    buildPlotHoverText,
    syncPlotButtonPresentation,
    applyPlotFallowAfterHarvest,
};



