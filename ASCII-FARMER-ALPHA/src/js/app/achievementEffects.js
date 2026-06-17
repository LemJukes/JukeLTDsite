import { configureAchievementHandlerAdapters } from '../handlers/achievementHandlers.js';
import { addBulkSeedButton, addBulkCropSaleButton, addBulkWaterRefillButton, addSellAllCropButton } from '../ui/store.js';
import { wrapInMacWindow } from '../ui/macWindow.js';
import { showNotification } from '../ui/macNotifications.js';
import { registerDesktopWindow } from '../ui/desktopWindowManager.js';
import {
    initializeUpgradesTitle,
    initializeUpgrades,
    initializeWaterUpgradesSection,
    initializeClickUpgradesSection,
    updateUpgradeValues,
} from '../ui/upgrades.js';
import { updateToolboxDisplay } from '../ui/toolbox.js';
import { playCoinGainBurst } from '../ui/sfx.js';
import { showDesktopIconHint } from '../ui/tutorials.js';

let achievementEffectsInitialized = false;

function ensureUpgradesContainer() {
    if (document.getElementById('mac-window-upgrades-container')) {
        return;
    }

    let upgradesTitle = document.getElementById('upgrades-container-title');
    let upgradesContainer = document.getElementById('upgrades-container');

    if (!upgradesTitle) {
        initializeUpgradesTitle();
        upgradesTitle = document.getElementById('upgrades-container-title');
    }

    if (!upgradesContainer) {
        initializeUpgrades();
        upgradesContainer = document.getElementById('upgrades-container');
    }

    if (upgradesTitle && upgradesContainer) {
        wrapInMacWindow(upgradesTitle, upgradesContainer);
        registerDesktopWindow('mac-window-upgrades-container', {
            x: 210,
            y: 62,
            open: false,
            iconId: 'desktop-icon-upgrades',
        });
        document.getElementById('desktop-icon-upgrades')?.classList.remove('desktop-icon--hidden');
    }
}

function hasWaterUpgradesSection() {
    return Boolean(document.getElementById('water-upgrades-section'));
}

function hasClickUpgradesSection() {
    return Boolean(document.getElementById('click-upgrades-section'));
}

function isUpgradesIconVisible() {
    return document.getElementById('desktop-icon-upgrades')?.classList.contains('desktop-icon--hidden') === false;
}

function showCropInStore(cropType) {
    const sectionSuffix = `${cropType.charAt(0).toUpperCase()}${cropType.slice(1)}`;
    const cropSeedSection = document.getElementById(`buy${sectionSuffix}SeedsSection`);
    const cropSellSection = document.getElementById(`sell${sectionSuffix}Section`);
    if (cropSeedSection) cropSeedSection.style.display = 'flex';
    if (cropSellSection) cropSellSection.style.display = 'flex';
}

function showCropInResource(cropType) {
    const cropSeeds = document.getElementById(`${cropType}-seeds-item`);
    const cropInventory = document.getElementById(`${cropType}-item`);
    if (cropSeeds) cropSeeds.style.display = 'flex';
    if (cropInventory) cropInventory.style.display = 'flex';
}

function enableWaterUpgradeButton() {
    const waterUpgradeCapButton = document.getElementById('water-upgrade-cap-button');
    if (waterUpgradeCapButton && waterUpgradeCapButton.disabled) {
        waterUpgradeCapButton.disabled = false;
    }
}

export function initializeAchievementEffects() {
    if (achievementEffectsInitialized) {
        return;
    }

    configureAchievementHandlerAdapters({
        addBulkSeedButton,
        addBulkCropSaleButton,
        addBulkWaterRefillButton,
        addSellAllCropButton,
        wrapInMacWindow,
        showNotification,
        registerDesktopWindow,
        initializeUpgradesTitle,
        initializeUpgrades,
        initializeWaterUpgradesSection,
        initializeClickUpgradesSection,
        updateUpgradeValues,
        updateToolboxDisplay,
        playCoinGainBurst,
        showDesktopIconHint,
        ensureUpgradesContainer,
        hasWaterUpgradesSection,
        hasClickUpgradesSection,
        isUpgradesIconVisible,
        showCropInStore,
        showCropInResource,
        enableWaterUpgradeButton,
    });

    achievementEffectsInitialized = true;
}

export {
    configureAchievementHandlerAdapters,
    ensureUpgradesContainer,
    hasWaterUpgradesSection,
    hasClickUpgradesSection,
    isUpgradesIconVisible,
    showCropInStore,
    showCropInResource,
    enableWaterUpgradeButton,
};
