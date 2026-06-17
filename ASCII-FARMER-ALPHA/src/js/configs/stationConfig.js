const STATION_BASE_EFFICIENCY_PERCENT = 10;
const STATION_MAX_EFFICIENCY_PERCENT = 100;
const STATION_BASE_COST_PER_CLICK = 0.05;
const STATION_CAPACITY_PER_BUILDING = 3;

const POWER_PLANT_BASE_COST = 250;
const POWER_PLANT_COST_STEP = 150;
const POWER_PLANT_UPGRADE_BASE_COST = 120;
const POWER_PLANT_UPGRADE_COST_STEP = 120;

const PROCESSING_STATION_BASE_COST = 250;
const PROCESSING_STATION_COST_STEP = 150;
const PROCESSING_STATION_UPGRADE_BASE_COST = 120;
const PROCESSING_STATION_UPGRADE_COST_STEP = 120;
const PROCESSING_STATION_AUTO_BUY_SURCHARGE_MULTIPLIER = 1.1;
const PROCESSING_STATION_CHARGE_AUTO_BUY_TRIGGER_BELOW = 10;
const PROCESSING_STATION_CHARGE_AUTO_BUY_AMOUNT = 100;
const PROCESSING_STATION_CHARGE_EFFICIENCY_STEP_PERCENT = 25;

const STATION_UPGRADE_EFFICIENCY_STEP = 10;

function clampEfficiencyPercent(efficiencyPercent) {
    const parsed = Number(efficiencyPercent) || STATION_BASE_EFFICIENCY_PERCENT;
    return Math.max(STATION_BASE_EFFICIENCY_PERCENT, Math.min(STATION_MAX_EFFICIENCY_PERCENT, parsed));
}

function computeStationCostPerClick(efficiencyPercent) {
    const normalizedEfficiency = clampEfficiencyPercent(efficiencyPercent);
    return STATION_BASE_COST_PER_CLICK * (STATION_BASE_EFFICIENCY_PERCENT / normalizedEfficiency);
}

function formatStationCostPerClick(costPerClick) {
    const normalized = Math.max(0, Number(costPerClick) || 0);
    return `${normalized.toFixed(2)}c`;
}

function getPowerPlantBuildCost(currentNextCost) {
    return Math.max(POWER_PLANT_BASE_COST, Number(currentNextCost) || POWER_PLANT_BASE_COST);
}

function getProcessingStationBuildCost(currentNextCost) {
    return Math.max(PROCESSING_STATION_BASE_COST, Number(currentNextCost) || PROCESSING_STATION_BASE_COST);
}

function getNextPowerPlantBuildCost(costPaid) {
    const paid = Math.max(POWER_PLANT_BASE_COST, Number(costPaid) || POWER_PLANT_BASE_COST);
    return paid + POWER_PLANT_COST_STEP;
}

function getNextProcessingStationBuildCost(costPaid) {
    const paid = Math.max(PROCESSING_STATION_BASE_COST, Number(costPaid) || PROCESSING_STATION_BASE_COST);
    return paid + PROCESSING_STATION_COST_STEP;
}

function getPowerPlantUpgradeCost(level) {
    const normalizedLevel = Math.max(1, Number(level) || 1);
    return POWER_PLANT_UPGRADE_BASE_COST + ((normalizedLevel - 1) * POWER_PLANT_UPGRADE_COST_STEP);
}

function getProcessingStationUpgradeCost(level) {
    const normalizedLevel = Math.max(1, Number(level) || 1);
    return PROCESSING_STATION_UPGRADE_BASE_COST + ((normalizedLevel - 1) * PROCESSING_STATION_UPGRADE_COST_STEP);
}

function getProcessingStationSeedSlotCount(level) {
    const normalizedLevel = Math.max(1, Number(level) || 1);

    if (normalizedLevel >= 5) {
        return Number.POSITIVE_INFINITY;
    }

    return Math.min(5, normalizedLevel + 1);
}

function canProcessingStationAutoBuy(level) {
    return Math.max(1, Number(level) || 1) >= 5;
}

function getProcessingStationChargeEfficiencyPercent(level) {
    const normalizedLevel = Math.max(1, Number(level) || 1);
    return 100 + ((normalizedLevel - 1) * PROCESSING_STATION_CHARGE_EFFICIENCY_STEP_PERCENT);
}

function getProcessingStationChargeCost(level) {
    return 100 / getProcessingStationChargeEfficiencyPercent(level);
}

function getNextStationEfficiencyPercent(currentEfficiencyPercent) {
    const current = clampEfficiencyPercent(currentEfficiencyPercent);
    return Math.min(STATION_MAX_EFFICIENCY_PERCENT, current + STATION_UPGRADE_EFFICIENCY_STEP);
}

function getPowerPlantDisassembleRefund(level) {
    const normalizedLevel = Math.max(1, Number(level) || 1);
    let refund = POWER_PLANT_BASE_COST;

    for (let currentLevel = 1; currentLevel < normalizedLevel; currentLevel++) {
        refund += getPowerPlantUpgradeCost(currentLevel);
    }

    return refund;
}

function getProcessingStationDisassembleRefund(level) {
    const normalizedLevel = Math.max(1, Number(level) || 1);
    let refund = PROCESSING_STATION_BASE_COST;

    for (let currentLevel = 1; currentLevel < normalizedLevel; currentLevel++) {
        refund += getProcessingStationUpgradeCost(currentLevel);
    }

    return refund;
}

function getStationPoolKey(fieldId, plotIndex) {
    return `${fieldId}:${Number(plotIndex)}`;
}

function createDefaultStationState() {
    const efficiencyPercent = STATION_BASE_EFFICIENCY_PERCENT;
    return {
        level: 1,
        efficiencyPercent,
        costPerClick: computeStationCostPerClick(efficiencyPercent),
        lastErrorCode: null,
        lastErrorMessage: '',
        isPaused: false,
    };
}

function createDefaultSeedAutomationConfig() {
    return {
        cycleSeedTypes: [],
        minSeedInventoryByType: {},
        targetSeedInventoryByType: {},
    };
}

function createDefaultProcessingStationState() {
    return {
        level: 1,
        lastErrorCode: null,
        lastErrorMessage: '',
        isPaused: false,
        chargeAutoBuyEnabled: false,
        seedAutomation: createDefaultSeedAutomationConfig(),
    };
}

export {
    STATION_BASE_EFFICIENCY_PERCENT,
    STATION_MAX_EFFICIENCY_PERCENT,
    STATION_BASE_COST_PER_CLICK,
    STATION_CAPACITY_PER_BUILDING,
    POWER_PLANT_BASE_COST,
    POWER_PLANT_COST_STEP,
    PROCESSING_STATION_BASE_COST,
    PROCESSING_STATION_COST_STEP,
    PROCESSING_STATION_AUTO_BUY_SURCHARGE_MULTIPLIER,
    PROCESSING_STATION_CHARGE_AUTO_BUY_TRIGGER_BELOW,
    PROCESSING_STATION_CHARGE_AUTO_BUY_AMOUNT,
    clampEfficiencyPercent,
    computeStationCostPerClick,
    formatStationCostPerClick,
    getPowerPlantBuildCost,
    getNextPowerPlantBuildCost,
    getProcessingStationBuildCost,
    getNextProcessingStationBuildCost,
    getPowerPlantUpgradeCost,
    getProcessingStationUpgradeCost,
    getProcessingStationSeedSlotCount,
    canProcessingStationAutoBuy,
    getProcessingStationChargeEfficiencyPercent,
    getProcessingStationChargeCost,
    getNextStationEfficiencyPercent,
    getPowerPlantDisassembleRefund,
    getProcessingStationDisassembleRefund,
    getStationPoolKey,
    createDefaultStationState,
    createDefaultSeedAutomationConfig,
    createDefaultProcessingStationState,
};