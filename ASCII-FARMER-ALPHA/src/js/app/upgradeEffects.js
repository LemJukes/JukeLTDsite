import { configureUpgradeHandlerAdapters } from '../handlers/upgradeHandlers.js';
import {
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
} from '../handlers/upgradeHandlers.js';
import {
    getUpgradeValues,
    updateUpgradeValues,
    addWaterUpgradeButton,
    updateWaterUpgradeButton,
    renderClickUpgradesSection,
} from '../ui/upgrades.js';
import { updateResourceBar } from '../ui/resource.js';
import { updateClicksDisplay } from '../ui/clicks.js';
import { showNotification } from '../ui/macNotifications.js';

let upgradeEffectsInitialized = false;

export function initializeUpgradeEffects() {
    if (upgradeEffectsInitialized) {
        return;
    }

    configureUpgradeHandlerAdapters({
        getUpgradeValues,
        updateUpgradeValues,
        addWaterUpgradeButton,
        updateWaterUpgradeButton,
        renderClickUpgradesSection,
        updateResourceBar,
        updateClicksDisplay,
        showNotification,
    });

    upgradeEffectsInitialized = true;
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
