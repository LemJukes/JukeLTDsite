//src/js/ui/upgrades.js+

import { savePartialSnapshot } from "../persistence.js";
import { getActiveNodeState as getState, incrementTotalClicks } from "../worldState.js";
import { updateClicksDisplay } from "./clicks.js";
import { progressionConfig } from "../configs/progressionConfig.js";
import {
    buyWaterCapacityUpgrade,
    buyWaterAutoBuyerUpgrade,
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
} from "../app/upgradeEffects.js";

const { upgradesEconomy } = progressionConfig;
const expandedClickUpgradeDefinitions = [
    {
        level: 1,
        unlockedKey: 'expandedClickMk1Unlocked',
        purchasedKey: 'expandedClickMk1Purchased',
        enabledKey: 'expandedClickMk1Enabled',
        costKey: 'expandedClickUpgradeCost',
        costId: 'expanded-click-upgrade-mk1-cost',
        handler: buyExpandedClickUpgradeMk1,
    },
    {
        level: 2,
        unlockedKey: 'expandedClickMk2Unlocked',
        purchasedKey: 'expandedClickMk2Purchased',
        enabledKey: 'expandedClickMk2Enabled',
        costKey: 'expandedClickMk2Cost',
        costId: 'expanded-click-upgrade-mk2-cost',
        handler: buyExpandedClickUpgradeMk2,
    },
    {
        level: 3,
        unlockedKey: 'expandedClickMk3Unlocked',
        purchasedKey: 'expandedClickMk3Purchased',
        enabledKey: 'expandedClickMk3Enabled',
        costKey: 'expandedClickMk3Cost',
        costId: 'expanded-click-upgrade-mk3-cost',
        handler: buyExpandedClickUpgradeMk3,
    },
    {
        level: 4,
        unlockedKey: 'expandedClickMk4Unlocked',
        purchasedKey: 'expandedClickMk4Purchased',
        enabledKey: 'expandedClickMk4Enabled',
        costKey: 'expandedClickMk4Cost',
        costId: 'expanded-click-upgrade-mk4-cost',
        handler: buyExpandedClickUpgradeMk4,
    },
    {
        level: 5,
        unlockedKey: 'expandedClickMk5Unlocked',
        purchasedKey: 'expandedClickMk5Purchased',
        enabledKey: 'expandedClickMk5Enabled',
        costKey: 'expandedClickMk5Cost',
        costId: 'expanded-click-upgrade-mk5-cost',
        handler: buyExpandedClickUpgradeMk5,
    },
    {
        level: 6,
        unlockedKey: 'expandedClickMk6Unlocked',
        purchasedKey: 'expandedClickMk6Purchased',
        enabledKey: 'expandedClickMk6Enabled',
        costKey: 'expandedClickMk6Cost',
        costId: 'expanded-click-upgrade-mk6-cost',
        handler: buyExpandedClickUpgradeMk6,
    },
];

const initialUpgradeValues = {
    waterUpgradeCost: upgradesEconomy.waterCapacity.baseCost,
    waterAutoBuyerUnlocked: false,
    waterAutoBuyerCost: upgradesEconomy.waterAutoBuyer.baseCost,
    waterAutoBuyerPurchased: false,
    waterAutoBuyerEnabled: false,
    
    //Epanded Click Values
    expandedClickUpgradeCost: upgradesEconomy.expandedClick.mk1Cost,
    expandedClickUpgradeLVL: 1,
    expandedClickMk1Unlocked: false,
    expandedClickMk2Unlocked: false,
    expandedClickMk3Unlocked: false,
    expandedClickMk4Unlocked: false,
    expandedClickMk5Unlocked: false,
    expandedClickMk6Unlocked: false,

        //Mk1 Values
        expandedClickMk1Purchased: false, // Flag indicating whether the expanded click upgrade has been purchased
        expandedClickMk1Enabled: false,   // Flag indicating whether the expanded click upgrade is enabled
        
        //Mk2 Values
        expandedClickMk2Cost: upgradesEconomy.expandedClick.mk2Cost,
        expandedClickMk2Purchased: false,
        expandedClickMk2Enabled: false,
        
        //Mk3 Values
        expandedClickMk3Cost: upgradesEconomy.expandedClick.mk3Cost,
        expandedClickMk3Purchased: false,
        expandedClickMk3Enabled: false,

        //Mk4 Values
        expandedClickMk4Cost: upgradesEconomy.expandedClick.mk4Cost,
        expandedClickMk4Purchased: false,
        expandedClickMk4Enabled: false,

        //Mk5 Values
        expandedClickMk5Cost: upgradesEconomy.expandedClick.mk5Cost,
        expandedClickMk5Purchased: false,
        expandedClickMk5Enabled: false,

        //Mk6 Values
        expandedClickMk6Cost: upgradesEconomy.expandedClick.mk6Cost,
        expandedClickMk6Purchased: false,
        expandedClickMk6Enabled: false,

    toolAutoChangerCost: upgradesEconomy.toolAutoChanger.baseCost,
    toolAutoChangerPurchased: false,
    toolAutoChangerEnabled: false,
    toolAutoChangerCharges: 0,
    toolAutoChangerChargePack100Cost: upgradesEconomy.toolAutoChanger.chargePackCosts.pack100,
    toolAutoChangerChargePack500Cost: upgradesEconomy.toolAutoChanger.chargePackCosts.pack500,
    toolAutoChangerChargePack1000Cost: upgradesEconomy.toolAutoChanger.chargePackCosts.pack1000,
    toolAutoChangerChargePack100Unlocked: false,
    toolAutoChangerChargePack500Unlocked: false,
    toolAutoChangerChargePack1000Unlocked: false,
}

const upgradeValues = { ...initialUpgradeValues };

function getUpgradeValues() {
    return { ...upgradeValues};
}

function getUpgradeValuesSnapshot() {
    return { ...upgradeValues };
}

function applyUpgradeValuesSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        return;
    }

    const merged = { ...initialUpgradeValues };
    for (const key of Object.keys(initialUpgradeValues)) {
        if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
            merged[key] = snapshot[key];
        }
    }

    Object.assign(upgradeValues, merged);

    // Backward compatibility for saves before water auto-buyer had a purchase gate.
    if (snapshot.waterAutoBuyerUnlocked === true && !Object.prototype.hasOwnProperty.call(snapshot, 'waterAutoBuyerPurchased')) {
        upgradeValues.waterAutoBuyerPurchased = true;
    }
}

function updateUpgradeValues(updates) {
    Object.assign(upgradeValues, updates);
    savePartialSnapshot({ upgradeValues: getUpgradeValuesSnapshot() });
}

//function logUpgradeValues() {
//    const upgadeValues = getUpgradeValues();
//    console.log('Upgrade Values:', upgradeValues);
//}


function initializeUpgradesTitle() {
    // Store Title as a Button
    const upgradesTitle = document.createElement('section');
    upgradesTitle.classList.add('container-title');
    upgradesTitle.id = 'upgrades-container-title';
    upgradesTitle.setAttribute('aria-label', 'Upgrades Container Title');
    upgradesTitle.textContent = 'Upgrades';

    const mainDiv = document.querySelector('main');
    if (mainDiv) {
        mainDiv.appendChild(upgradesTitle);
    } else {
        console.error('Main div not found');
    }
}

function initializeUpgrades() {

    // Upgrades Section Container
    const upgradesContainer = document.createElement('section');
    upgradesContainer.classList.add('upgrades-container');
    upgradesContainer.id = 'upgrades-container';
    upgradesContainer.setAttribute('aria-label', 'Upgrades Container');

    // Add the Upgrades section to the store or main window
    const mainDiv = document.querySelector('main'); // Assuming 'main' is the main container
    if (mainDiv) {
        mainDiv.appendChild(upgradesContainer);
    } else {
        console.error('Main div not found');
    }
}

function initializeWaterUpgradesSection() {
    let waterUpgradesSection = document.getElementById('water-upgrades-section');

    if (waterUpgradesSection) {
        addWaterUpgradeButton();
        return;
    }

    // Max Water Capacity Upgrades Section
    waterUpgradesSection = document.createElement('section');
    waterUpgradesSection.classList.add('upgrades-section');
    waterUpgradesSection.id = 'water-upgrades-section';
    waterUpgradesSection.setAttribute('aria-label', 'Maximum Water Capacity Upgrades Section');

    // Max Water Capacity Upgrades Section Title
    const waterUpgradesTitle = document.createElement('h3');
    waterUpgradesTitle.classList.add('upgrades-section-title');
    waterUpgradesTitle.id = 'water-upgrades-title';
    waterUpgradesTitle.textContent = 'Water Upgrades';
    waterUpgradesTitle.setAttribute('aria-label', 'Upgrades Section Title');
    waterUpgradesSection.appendChild(waterUpgradesTitle);

    const waterUpgradeGroup = document.createElement('section');
    waterUpgradeGroup.classList.add('click-upgrade-group');
    waterUpgradeGroup.id = 'water-upgrade-group';

    const waterUpgradeGroupTitle = document.createElement('h4');
    waterUpgradeGroupTitle.classList.add('click-upgrade-group-title');
    waterUpgradeGroupTitle.textContent = 'Increase Capacity';
    waterUpgradeGroup.appendChild(waterUpgradeGroupTitle);

    const waterAutoBuyerGroup = document.createElement('section');
    waterAutoBuyerGroup.classList.add('click-upgrade-group');
    waterAutoBuyerGroup.id = 'water-auto-buyer-group';

    const waterAutoBuyerGroupTitle = document.createElement('h4');
    waterAutoBuyerGroupTitle.classList.add('click-upgrade-group-title');
    waterAutoBuyerGroupTitle.textContent = 'Auto-Buyer';
    waterAutoBuyerGroup.appendChild(waterAutoBuyerGroupTitle);

    waterUpgradesSection.appendChild(waterUpgradeGroup);
    waterUpgradesSection.appendChild(waterAutoBuyerGroup);

    // Add the Upgrades section to the store or main window
    const mainDiv = document.getElementById('upgrades-container'); // Assuming 'main' is the main container
    if (mainDiv) {
        mainDiv.appendChild(waterUpgradesSection);
        addWaterUpgradeButton();
    } else {
        console.error('Upgrades Container not found');
    }
}

function addWaterUpgradeButton() {
    const waterUpgradeGroup = document.getElementById('water-upgrade-group');
    const waterAutoBuyerGroup = document.getElementById('water-auto-buyer-group');

    if (!waterUpgradeGroup || !waterAutoBuyerGroup) {
        console.error('Water Upgrades Section not found in the DOM');
        return;
    }

    const currentUpgradeValues = getUpgradeValues();
    const isWaterAutoBuyerUnlocked = Boolean(currentUpgradeValues.waterAutoBuyerUnlocked);
    waterAutoBuyerGroup.style.display = isWaterAutoBuyerUnlocked ? '' : 'none';

    // Capacity button — create once, patch cost text on subsequent calls.
    if (!document.getElementById('water-upgrade-cap-button')) {
        const row = document.createElement('div');
        row.classList.add('click-upgrade-row');

        const upgradeWaterCapButton = document.createElement('button');
        upgradeWaterCapButton.classList.add('upgrade-button');
        upgradeWaterCapButton.id = 'water-upgrade-cap-button';
        upgradeWaterCapButton.textContent = '+10 Capacity';
        upgradeWaterCapButton.addEventListener('click', buyWaterCapacityUpgrade);
        row.appendChild(upgradeWaterCapButton);

        const upgradeWaterCapCost = document.createElement('span');
        upgradeWaterCapCost.classList.add('upgrade-price');
        upgradeWaterCapCost.id = 'water-upgrade-cap-cost';
        row.appendChild(upgradeWaterCapCost);

        waterUpgradeGroup.appendChild(row);
    }

    const capCostEl = document.getElementById('water-upgrade-cap-cost');
    if (capCostEl) {
        const waterUpgradeCost = Math.max(0, Number.parseInt(upgradeValues.waterUpgradeCost, 10) || 0);
        capCostEl.textContent = `${waterUpgradeCost} coins`;
    }

    if (!isWaterAutoBuyerUnlocked) {
        return;
    }

    if (!currentUpgradeValues.waterAutoBuyerPurchased) {
        // Create buy row only once.
        if (!document.getElementById('water-auto-buyer-buy-button')) {
            // Remove toggle if it somehow exists from a prior state.
            document.getElementById('water-auto-buyer-toggle-checkbox')?.closest('.click-upgrade-row')?.remove();

            const buyRow = document.createElement('div');
            buyRow.classList.add('click-upgrade-row');

            const buyButton = document.createElement('button');
            buyButton.classList.add('upgrade-button');
            buyButton.id = 'water-auto-buyer-buy-button';
            buyButton.textContent = 'Unlock Water Auto-Buyer';
            buyButton.addEventListener('click', buyWaterAutoBuyerUpgrade);
            buyRow.appendChild(buyButton);

            const buyCost = document.createElement('span');
            buyCost.classList.add('upgrade-price');
            buyCost.id = 'water-auto-buyer-buy-cost';
            buyCost.textContent = `${currentUpgradeValues.waterAutoBuyerCost} coins`;
            buyRow.appendChild(buyCost);

            waterAutoBuyerGroup.appendChild(buyRow);
        }
        return;
    }

    // Remove buy row once purchased.
    document.getElementById('water-auto-buyer-buy-button')?.closest('.click-upgrade-row')?.remove();

    // Ensure toggle row exists; patch in-place on subsequent calls.
    let autoBuyerToggle = document.getElementById('water-auto-buyer-toggle-checkbox');

    if (!autoBuyerToggle) {
        const autoBuyerRow = document.createElement('div');
        autoBuyerRow.classList.add('click-upgrade-row');

        const autoBuyerLabel = document.createElement('label');
        autoBuyerLabel.classList.add('expanded-click-label');
        autoBuyerLabel.id = 'water-auto-buyer-toggle-label';
        autoBuyerLabel.textContent = 'Auto Refill (+10%)';
        autoBuyerLabel.htmlFor = 'water-auto-buyer-toggle-checkbox';

        autoBuyerToggle = document.createElement('input');
        autoBuyerToggle.classList.add('expanded-click-checkbox');
        autoBuyerToggle.type = 'checkbox';
        autoBuyerToggle.id = 'water-auto-buyer-toggle-checkbox';
        autoBuyerToggle.addEventListener('change', function() {
            updateUpgradeValues({ waterAutoBuyerEnabled: this.checked });
            incrementTotalClicks();
            updateClicksDisplay();
        });

        autoBuyerRow.appendChild(autoBuyerLabel);
        autoBuyerRow.appendChild(autoBuyerToggle);
        waterAutoBuyerGroup.appendChild(autoBuyerRow);
    }

    autoBuyerToggle.checked = Boolean(currentUpgradeValues.waterAutoBuyerEnabled);
}

function updateWaterUpgradeButton() {
    const upgradeWaterCapButton = document.getElementById('water-upgrade-cap-button');
    const upgradeWaterCapCost = document.getElementById('water-upgrade-cap-cost');

    if (!upgradeWaterCapButton || !upgradeWaterCapCost) {
        console.error('Water Upgrade Button or Cost Element not found in the DOM');
        return;
    }

    const { waterUpgradeCost } = getUpgradeValues();
    const numericWaterUpgradeCost = Math.max(0, Number.parseInt(waterUpgradeCost, 10) || 0);
    upgradeWaterCapCost.textContent = `${numericWaterUpgradeCost} coins`;
}

function initializeClickUpgradesSection() {
    let expandedClickUpgradesSection = document.getElementById('click-upgrades-section');

    if (!expandedClickUpgradesSection) {
        // Expanded Click Upgrades Section
        expandedClickUpgradesSection = document.createElement('section');
        expandedClickUpgradesSection.classList.add('upgrades-section');
        expandedClickUpgradesSection.id = 'click-upgrades-section';

        // Expanded Click Upgrades Section Title
        const expandedClickUpgradesTitle = document.createElement('h3');
        expandedClickUpgradesTitle.classList.add('upgrades-section-title');
        expandedClickUpgradesTitle.id = 'expanded-click-upgrades-title';
        expandedClickUpgradesTitle.textContent = 'Click Upgrades';
        expandedClickUpgradesSection.appendChild(expandedClickUpgradesTitle);

        const expandedClickGroup = document.createElement('section');
        expandedClickGroup.classList.add('click-upgrade-group');
        expandedClickGroup.id = 'expanded-click-upgrade-group';

        const expandedClickGroupTitle = document.createElement('h4');
        expandedClickGroupTitle.classList.add('click-upgrade-group-title');
        expandedClickGroupTitle.textContent = 'Expanded Click';
        expandedClickGroup.appendChild(expandedClickGroupTitle);

        const toolAutoChangerGroup = document.createElement('section');
        toolAutoChangerGroup.classList.add('click-upgrade-group');
        toolAutoChangerGroup.id = 'tool-auto-changer-upgrade-group';

        const toolAutoChangerGroupTitle = document.createElement('h4');
        toolAutoChangerGroupTitle.classList.add('click-upgrade-group-title');
        toolAutoChangerGroupTitle.textContent = 'Tool Auto-Changer';
        toolAutoChangerGroup.appendChild(toolAutoChangerGroupTitle);

        expandedClickUpgradesSection.appendChild(expandedClickGroup);
        expandedClickUpgradesSection.appendChild(toolAutoChangerGroup);

        // Add the Upgrades section to the store or main window
        const mainDiv = document.getElementById('upgrades-container'); // Assuming 'main' is the main container
        if (mainDiv) {
            mainDiv.appendChild(expandedClickUpgradesSection);
        } else {
            console.error('Upgrades Container not found');
            return;
        }
    }

    renderClickUpgradesSection();
}

function renderClickUpgradesSection() {
    addExpandedClickUpgradeButton();
    addToolAutoChangerControls();
}

function addExpandedClickUpgradeButton() {
    const expandedClickUpgradesSection = document.getElementById('expanded-click-upgrade-group');

    if (!expandedClickUpgradesSection) {
        console.error('Expanded Click Upgrades Group not found in the DOM');
        return;
    }

    const shouldShowExpandedClickSection =
        expandedClickUpgradeDefinitions.some(({ unlockedKey, purchasedKey }) =>
            upgradeValues[unlockedKey] || upgradeValues[purchasedKey]
        );

    expandedClickUpgradesSection.style.display = shouldShowExpandedClickSection ? 'flex' : 'none';
    if (!shouldShowExpandedClickSection) {
        return;
    }

    // Ensure a toggle row exists for each purchased tier; patch checked state in-place.
    expandedClickUpgradeDefinitions.forEach(({ level, purchasedKey, enabledKey }) => {
        if (!upgradeValues[purchasedKey]) {
            return;
        }

        const toggleId = `expanded-click-mk${level}-toggle-checkbox`;
        const rowId = `expanded-click-row-${level}`;
        let toggle = document.getElementById(toggleId);

        if (!toggle) {
            const row = document.createElement('div');
            row.classList.add('click-upgrade-row');
            row.id = rowId;

            const label = document.createElement('label');
            label.classList.add('expanded-click-label');
            label.id = `expanded-click-mk${level}-toggle-label`;
            label.textContent = `Mk. ${level}`;
            label.htmlFor = toggleId;

            toggle = document.createElement('input');
            toggle.classList.add('expanded-click-checkbox');
            toggle.type = 'checkbox';
            toggle.id = toggleId;
            toggle.addEventListener('change', function() {
                updateUpgradeValues({ [enabledKey]: this.checked });
                incrementTotalClicks();
                updateClicksDisplay();
            });

            row.appendChild(label);
            row.appendChild(toggle);
            expandedClickUpgradesSection.appendChild(row);
        }

        // Patch checked state without replacing the element.
        toggle.checked = Boolean(upgradeValues[enabledKey]);
    });

    const nextUpgrade = expandedClickUpgradeDefinitions.find((definition, index) => {
        const previousDefinition = expandedClickUpgradeDefinitions[index - 1];
        const hasPreviousTier = !previousDefinition || upgradeValues[previousDefinition.purchasedKey];

        return hasPreviousTier &&
            !upgradeValues[definition.purchasedKey] &&
            upgradeValues[definition.unlockedKey];
    });

    // Remove buy button for any tier that is no longer the next upgrade.
    const existingBuyButtons = expandedClickUpgradesSection.querySelectorAll('[id^="expanded-click-upgrade-mk"][id$="-buy-button"]');
    existingBuyButtons.forEach((button) => {
        if (!nextUpgrade || button.id !== `expanded-click-upgrade-mk${nextUpgrade.level}-buy-button`) {
            button.closest('.click-upgrade-row')?.remove();
        }
    });

    if (!nextUpgrade) {
        return;
    }

    // If the buy row for the next upgrade already exists, nothing to do.
    if (document.getElementById(`expanded-click-upgrade-mk${nextUpgrade.level}-buy-button`)) {
        return;
    }

    const buyRow = document.createElement('div');
    buyRow.classList.add('click-upgrade-row');

    const expandedClickUpgradeBuyButton = document.createElement('button');
    expandedClickUpgradeBuyButton.classList.add('upgrade-button');
    expandedClickUpgradeBuyButton.id = `expanded-click-upgrade-mk${nextUpgrade.level}-buy-button`;
    expandedClickUpgradeBuyButton.textContent = `Unlock Mk.${nextUpgrade.level}`;
    expandedClickUpgradeBuyButton.addEventListener('click', nextUpgrade.handler);
    buyRow.appendChild(expandedClickUpgradeBuyButton);

    const expandedClickUpgradeCost = document.createElement('span');
    expandedClickUpgradeCost.classList.add('upgrade-price');
    expandedClickUpgradeCost.id = nextUpgrade.costId;
    expandedClickUpgradeCost.textContent = `${upgradeValues[nextUpgrade.costKey]} coins`;
    buyRow.appendChild(expandedClickUpgradeCost);

    expandedClickUpgradesSection.appendChild(buyRow);
}

function addToolAutoChangerControls() {
    const clickUpgradesSection = document.getElementById('tool-auto-changer-upgrade-group');

    if (!clickUpgradesSection) {
        console.error('Tool Auto-Changer Upgrades Group not found in the DOM');
        return;
    }

    const currentUpgradeValues = getUpgradeValues();

    if (!currentUpgradeValues.toolAutoChangerPurchased) {
        // Ensure buy row exists; create only once.
        if (!document.getElementById('tool-auto-changer-buy-button')) {
            // Remove toggle row if somehow present from a prior state.
            document.getElementById('tool-auto-changer-toggle-checkbox')?.closest('.click-upgrade-row')?.remove();

            const buyRow = document.createElement('div');
            buyRow.classList.add('click-upgrade-row');

            const buyButton = document.createElement('button');
            buyButton.classList.add('upgrade-button');
            buyButton.id = 'tool-auto-changer-buy-button';
            buyButton.textContent = 'Unlock Tool Auto-Changer';
            buyButton.addEventListener('click', buyToolAutoChangerUpgrade);
            buyRow.appendChild(buyButton);

            const buyCost = document.createElement('span');
            buyCost.classList.add('upgrade-price');
            buyCost.id = 'tool-auto-changer-buy-cost';
            buyCost.textContent = `${currentUpgradeValues.toolAutoChangerCost} coins`;
            buyRow.appendChild(buyCost);
            clickUpgradesSection.appendChild(buyRow);
        }
        return;
    }

    // Remove buy row if purchased state just flipped.
    document.getElementById('tool-auto-changer-buy-button')?.closest('.click-upgrade-row')?.remove();

    // Ensure toggle row exists; patch in-place on subsequent calls.
    let toggle = document.getElementById('tool-auto-changer-toggle-checkbox');
    let chargeDisplay = document.getElementById('tool-auto-changer-charge-display');

    if (!toggle) {
        const toggleRow = document.createElement('div');
        toggleRow.classList.add('click-upgrade-row');

        const toggleLabel = document.createElement('label');
        toggleLabel.classList.add('expanded-click-label');
        toggleLabel.id = 'tool-auto-changer-toggle-label';
        toggleLabel.textContent = 'Enabled';
        toggleLabel.htmlFor = 'tool-auto-changer-toggle-checkbox';

        toggle = document.createElement('input');
        toggle.classList.add('expanded-click-checkbox');
        toggle.type = 'checkbox';
        toggle.id = 'tool-auto-changer-toggle-checkbox';
        toggle.addEventListener('change', function() {
            updateUpgradeValues({ toolAutoChangerEnabled: this.checked });
            incrementTotalClicks();
            updateClicksDisplay();
        });

        chargeDisplay = document.createElement('span');
        chargeDisplay.classList.add('upgrade-price');
        chargeDisplay.id = 'tool-auto-changer-charge-display';

        toggleRow.appendChild(toggleLabel);
        toggleRow.appendChild(toggle);
        toggleRow.appendChild(chargeDisplay);
        clickUpgradesSection.appendChild(toggleRow);
    }

    // Patch live values without replacing elements.
    toggle.checked = Boolean(currentUpgradeValues.toolAutoChangerEnabled);
    if (chargeDisplay) {
        chargeDisplay.textContent = `Charges: ${currentUpgradeValues.toolAutoChangerCharges}`;
    }

    const chargePacks = [
        {
            amount: 100,
            buttonId: 'tool-auto-changer-charge-pack-100-button',
            costId: 'tool-auto-changer-charge-pack-100-cost',
            unlocked: currentUpgradeValues.toolAutoChangerChargePack100Unlocked,
            cost: currentUpgradeValues.toolAutoChangerChargePack100Cost,
            handler: buyToolAutoChangerChargePack100,
        },
        {
            amount: 500,
            buttonId: 'tool-auto-changer-charge-pack-500-button',
            costId: 'tool-auto-changer-charge-pack-500-cost',
            unlocked: currentUpgradeValues.toolAutoChangerChargePack500Unlocked,
            cost: currentUpgradeValues.toolAutoChangerChargePack500Cost,
            handler: buyToolAutoChangerChargePack500,
        },
        {
            amount: 1000,
            buttonId: 'tool-auto-changer-charge-pack-1000-button',
            costId: 'tool-auto-changer-charge-pack-1000-cost',
            unlocked: currentUpgradeValues.toolAutoChangerChargePack1000Unlocked,
            cost: currentUpgradeValues.toolAutoChangerChargePack1000Cost,
            handler: buyToolAutoChangerChargePack1000,
        },
    ];

    chargePacks.forEach(({ amount, buttonId, costId, unlocked, cost, handler }) => {
        if (!unlocked) {
            return;
        }

        // Create only if not already in the DOM.
        if (document.getElementById(buttonId)) {
            return;
        }

        const packRow = document.createElement('div');
        packRow.classList.add('click-upgrade-row');

        const packButton = document.createElement('button');
        packButton.classList.add('upgrade-button');
        packButton.id = buttonId;
        packButton.textContent = `Buy ${amount}x Charges`;
        packButton.addEventListener('click', handler);
        packRow.appendChild(packButton);

        const packCost = document.createElement('span');
        packCost.classList.add('upgrade-price');
        packCost.id = costId;
        packCost.textContent = `${cost} coins`;
        packRow.appendChild(packCost);

        clickUpgradesSection.appendChild(packRow);
    });
}

function formatChargeCount(amount) {
    const normalized = Math.max(0, Number(amount) || 0);
    return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(1);
}

/*
function updateExpandedClickUpgradeButton() {
    const expandedClickUpgradesSection = document.getElementById('expanded-click-upgrades-section');
    const expandedClickUpgradeBuyButton = document.getElementById('expanded-click-upgrade-buy-button');
    const expandedClickUpgradeCost = document.getElementById('expanded-click-upgrade-cost')
    if (!expandedClickUpgradeBuyButton || !expandedClickUpgradeCost) {
        console.error('Water Upgrade Button or Cost Element not found in the DOM');
        return;
    }

    const { waterUpgradeCost } = getUpgradeValues();

    expandedClickUpgradeCost.textContent = expandedClickUpgradeCost;
}  
*/

export { getUpgradeValues,
         getUpgradeValuesSnapshot,
         applyUpgradeValuesSnapshot,
         updateUpgradeValues,
         //logUpgradeValues,
         initializeUpgradesTitle, 
         initializeUpgrades,
         initializeWaterUpgradesSection,
         addWaterUpgradeButton,
         updateWaterUpgradeButton,
         initializeClickUpgradesSection,
         renderClickUpgradesSection,
         addExpandedClickUpgradeButton,
         addToolAutoChangerControls,
         //updateExpandedClickUpgradeButton,
}

