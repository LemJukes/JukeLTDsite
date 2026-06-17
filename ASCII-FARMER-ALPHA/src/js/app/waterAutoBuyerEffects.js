import { configureWaterAutoBuyerAdapters } from '../handlers/waterAutoBuyerHandlers.js';
import { getUpgradeValues } from '../ui/upgrades.js';

let waterAutoBuyerEffectsInitialized = false;

export function initializeWaterAutoBuyerEffects() {
    if (waterAutoBuyerEffectsInitialized) {
        return;
    }

    configureWaterAutoBuyerAdapters({
        getUpgradeValues,
    });

    waterAutoBuyerEffectsInitialized = true;
}
