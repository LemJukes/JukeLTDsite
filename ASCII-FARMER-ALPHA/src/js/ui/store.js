// ./ui/store.js.
import { savePartialSnapshot } from "../persistence.js";
import { progressionConfig } from "../configs/progressionConfig.js";
import { getCropIds, getCropLabel } from "../configs/cropConfig.js";
import { getNodeCropEntries } from "../state/nodeCropView.js";

const { storeEconomy, bulkTiers } = progressionConfig;

const initialStoreValues = {
    // Items for Sale Values
    // Crop-Specific Seed Costs
    wheatSeedCost: storeEconomy.seedCosts.wheat,
    cornSeedCost: storeEconomy.seedCosts.corn,
    tomatoSeedCost: storeEconomy.seedCosts.tomato,
    potatoSeedCost: storeEconomy.seedCosts.potato,
    carrotSeedCost: storeEconomy.seedCosts.carrot,
    
    // Water Purchase Variables
    waterCost: storeEconomy.water.cost,
    waterQuantity: storeEconomy.water.quantity,
    
    //Plot Purchase Variables
    plotCost: storeEconomy.plot.baseCost,

    // Player Sellable Item Values

    // Crop-Specific Sale Prices
    wheatPrice: storeEconomy.sellPrices.wheat,
    cornPrice: storeEconomy.sellPrices.corn,
    tomatoPrice: storeEconomy.sellPrices.tomato,
    potatoPrice: storeEconomy.sellPrices.potato,
    carrotPrice: storeEconomy.sellPrices.carrot,
}

const storeValues = { ...initialStoreValues };
const cropIds = getCropIds();

function toTitleCase(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function getBuySeedSectionId(cropId) {
    return `buy${toTitleCase(cropId)}SeedsSection`;
}

function getSellCropSectionId(cropId) {
    return `sell${toTitleCase(cropId)}Section`;
}

function getStoreSeedCostKey(cropId) {
    return `${cropId}SeedCost`;
}

function getStoreCropPriceKey(cropId) {
    return `${cropId}Price`;
}

function getCropSectionValueText(value, unit = 'coins') {
    const normalizedValue = Math.max(0, Number(value) || 0);
    if (unit === 'coin' && normalizedValue === 1) {
        return '1 coin';
    }
    return `${normalizedValue} ${unit}`;
}

function createStoreCropActionSection({
    parent,
    sectionId,
    title,
    ariaLabel,
    visible,
    actionText,
    actionAmount,
    onClick,
    valueText,
}) {
    const section = document.createElement('section');
    section.classList.add('item-title');
    section.id = sectionId;
    section.textContent = title;
    section.setAttribute('aria-label', ariaLabel);
    section.style.display = visible ? 'flex' : 'none';
    parent.appendChild(section);

    const actionButton = document.createElement('button');
    actionButton.classList.add('store-button');
    actionButton.textContent = actionText;
    actionButton.dataset.actionAmount = actionAmount;
    actionButton.onclick = onClick;
    section.appendChild(actionButton);

    const valueEl = document.createElement('span');
    valueEl.classList.add('item-price');
    valueEl.textContent = valueText;
    section.appendChild(valueEl);

    return section;
}

function getStoreValues() {
    return { ...storeValues};
}

function getStoreValuesSnapshot() {
    return { ...storeValues };
}

function applyStoreValuesSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        return;
    }

    const merged = { ...initialStoreValues };
    for (const key of Object.keys(initialStoreValues)) {
        if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
            merged[key] = snapshot[key];
        }
    }

    Object.assign(storeValues, merged);
}

function updateStoreValues(updates) {
    Object.assign(storeValues, updates);
    savePartialSnapshot({ storeValues: getStoreValuesSnapshot() });
}

import { getActiveNodeState as getState } from "../worldState.js";
import {
    buyStoreWater,
    buyStorePlot,
    buyStoreCropSeeds,
    sellStoreCrop,
    sellAllStoreCrop,
    buyStoreBulkSeedPack,
    sellStoreBulkCropPack,
    buyStoreBulkWaterRefill,
} from "../app/services/storeService.js";

const STORE_SECTION_FOCUS_STORAGE_PREFIX = 'storeSectionFocus:';
const COLLAPSIBLE_STORE_SECTION_IDS = [
    ...cropIds.map((cropId) => getBuySeedSectionId(cropId)),
    'buyWaterSection',
    ...cropIds.map((cropId) => getSellCropSectionId(cropId)),
];

function getStoreSectionFocusStorageKey(sectionId) {
    return `${STORE_SECTION_FOCUS_STORAGE_PREFIX}${sectionId}`;
}

function getSectionLabelText(section) {
    const directTextNodes = Array.from(section.childNodes).filter(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0,
    );

    const textFromNodes = directTextNodes
        .map((node) => node.textContent.trim())
        .filter(Boolean)
        .join(' ')
        .trim();

    const labelText =
        textFromNodes ||
        section.dataset.sectionLabel ||
        section.getAttribute('aria-label')?.replace(/\s+Title$/, '').trim() ||
        'Store Item';

    directTextNodes.forEach((node) => node.remove());
    section.dataset.sectionLabel = labelText;
    return labelText;
}

function getSectionActionPairs(section) {
    const actionButtons = Array.from(section.querySelectorAll('.store-button'));

    return actionButtons.map((button) => {
        let pairedValue = null;
        let cursor = button.nextElementSibling;

        while (cursor) {
            if (cursor.classList.contains('item-price')) {
                pairedValue = cursor;
                break;
            }

            if (cursor.classList.contains('store-button')) {
                break;
            }

            cursor = cursor.nextElementSibling;
        }

        return {
            button,
            value: pairedValue,
        };
    });
}

function getActionAmountLabel(button) {
    if (!button) {
        return '1x';
    }

    const explicitAmount = button.dataset.actionAmount?.trim();
    if (explicitAmount) {
        return explicitAmount;
    }

    const buttonText = (button.textContent || '').trim();
    const match = buttonText.match(/(\d+\s*x)/i);
    if (match && match[1]) {
        return match[1].replace(/\s+/g, '').toLowerCase();
    }

    if (/all/i.test(buttonText)) {
        return 'All';
    }

    return buttonText || '1x';
}

function getPreferredSectionActionIndex(section, actionPairs) {
    const stored = Number.parseInt(localStorage.getItem(getStoreSectionFocusStorageKey(section.id)) || '', 10);
    const index = Number.isInteger(stored) ? stored : Number(actionPairs.length - 1);
    if (!Number.isFinite(index) || index < 0 || index >= actionPairs.length) {
        return Math.max(0, actionPairs.length - 1);
    }

    return index;
}

function updateSectionFocusSelector(section) {
    const selector = section.querySelector('.store-section-focus-select');
    if (!selector) {
        return;
    }

    const actionPairs = getSectionActionPairs(section);
    selector.replaceChildren();

    actionPairs.forEach((pair, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = getActionAmountLabel(pair.button);
        selector.appendChild(option);
    });

    if (actionPairs.length === 0) {
        selector.disabled = true;
        return;
    }

    selector.disabled = false;
    selector.value = String(getPreferredSectionActionIndex(section, actionPairs));
}

function getPreferredSectionAction(section, actionPairs) {
    if (actionPairs.length === 0) {
        return { button: null, value: null };
    }

    const preferredIndex = getPreferredSectionActionIndex(section, actionPairs);
    return actionPairs[preferredIndex] || actionPairs[actionPairs.length - 1] || { button: null, value: null };
}

function applyStoreSectionFocusState(section) {
    const label = section.querySelector('.item-title-label');
    const selector = section.querySelector('.store-section-focus-select');
    const visibleElements = new Set([label, selector].filter(Boolean));

    const actionPairs = getSectionActionPairs(section);
    const preferredAction = getPreferredSectionAction(section, actionPairs);

    const { button, value } = preferredAction;
    if (button) {
        visibleElements.add(button);
    }
    if (value) {
        visibleElements.add(value);
    }

    Array.from(section.children).forEach((child) => {
        if (visibleElements.has(child)) {
            child.style.display = '';
        } else {
            child.style.display = 'none';
        }
    });
}

function syncStoreSectionFocus(section) {
    if (!section) {
        return;
    }

    updateSectionFocusSelector(section);
    applyStoreSectionFocusState(section);
}

function setupCollapsibleStoreSection(section) {
    if (!section || section.dataset.collapsibleInitialized === 'true') {
        return;
    }

    const labelText = getSectionLabelText(section);

    const label = document.createElement('span');
    label.classList.add('item-title-label');
    label.textContent = labelText;

    const focusSelect = document.createElement('select');
    focusSelect.classList.add('store-section-focus-select');
    focusSelect.setAttribute('aria-label', `${labelText} amount`);

    section.prepend(label);
    const firstActionButton = section.querySelector('.store-button');
    if (firstActionButton) {
        section.insertBefore(focusSelect, firstActionButton);
    } else {
        section.appendChild(focusSelect);
    }

    syncStoreSectionFocus(section);

    focusSelect.addEventListener('change', () => {
        const selectedIndex = Number.parseInt(focusSelect.value, 10);
        if (Number.isInteger(selectedIndex)) {
            localStorage.setItem(getStoreSectionFocusStorageKey(section.id), String(selectedIndex));
            syncStoreSectionFocus(section);
        }
    });

    section.dataset.collapsibleInitialized = 'true';
}

function initializeCollapsibleStoreSections() {
    COLLAPSIBLE_STORE_SECTION_IDS.forEach((sectionId) => {
        const section = document.getElementById(sectionId);
        if (section) {
            setupCollapsibleStoreSection(section);
        }
    });
}

function initializeStoreTitle() {
    // Store Title as a Button
    const storeTitle = document.createElement('section');
    storeTitle.classList.add('container-title');
    storeTitle.id = 'store-title-button';
    storeTitle.setAttribute('aria-label', 'Store Title Button');
    storeTitle.textContent = 'The Store';

    const mainDiv = document.querySelector('main');
    if (mainDiv) {
        mainDiv.appendChild(storeTitle);
    } else {
        console.error('Main div not found');
    }
}

function initializeStore() {
    const gameState = getState();

    // Store Section
    const store = document.createElement('section');
    store.classList.add('store-container');
    store.id = 'store';
    store.setAttribute('aria-label', 'The Store');

    // Buy Items Section
    const buyItemsSection = document.createElement('section');
    buyItemsSection.classList.add('store-section');
    buyItemsSection.id = 'buy-items';
    buyItemsSection.setAttribute('aria-label', 'Buy Items Section');

    // Buy Items Section Title
    const buyItemsTitle = document.createElement('h3');
    buyItemsTitle.classList.add('store-section-title');
    buyItemsTitle.textContent = 'Buy Items';
    buyItemsTitle.setAttribute('aria-label', 'Buy Items Section Title');
    store.appendChild(buyItemsTitle);

    getNodeCropEntries(gameState).forEach((entry) => {
        createStoreCropActionSection({
            parent: buyItemsSection,
            sectionId: getBuySeedSectionId(entry.cropId),
            title: `Buy ${getCropLabel(entry.cropId)} Seeds`,
            ariaLabel: `Buy ${toTitleCase(entry.cropId)} Seeds Title`,
            visible: entry.unlocked,
            actionText: 'Buy',
            actionAmount: '1x',
            onClick: () => buyStoreCropSeeds(entry.cropId),
            valueText: getCropSectionValueText(storeValues[getStoreSeedCostKey(entry.cropId)], 'coins'),
        });
    });

        // Water Refill Purchasing
        // Water Item Title
        const buyWaterSection = document.createElement('section');
        buyWaterSection.classList.add('item-title');
        buyWaterSection.id = 'buyWaterSection';
        buyWaterSection.textContent = 'Buy Water';
        buyWaterSection.setAttribute('aria-label', 'Buy Water Title');
        buyItemsSection.appendChild(buyWaterSection);

        // Water Button
        const buyWaterButton = document.createElement('button');
        buyWaterButton.classList.add('store-button');
        buyWaterButton.textContent = 'Buy';
        buyWaterButton.dataset.actionAmount = `${storeValues.waterQuantity}x`;
        buyWaterButton.onclick = buyStoreWater;
        buyWaterSection.appendChild(buyWaterButton);

        // Water Cost Title
        const buyWaterCost = document.createElement('span');
        buyWaterCost.classList.add('item-price');
        buyWaterCost.textContent = `${storeValues.waterCost} coin`;
        buyWaterSection.appendChild(buyWaterCost);

    // Player Sellable Items Section
    const playerSellableItems = document.createElement('section');
    playerSellableItems.classList.add('store-section');
    playerSellableItems.id = 'player-sellable-items';
    playerSellableItems.setAttribute('aria-label', 'Player Sellable Items Section');

    // Player Sellable Items Section Title
    const playerSellableItemsTitle = document.createElement('h3');
    playerSellableItemsTitle.classList.add('store-section-title');
    playerSellableItemsTitle.textContent = 'Sell Items';
    playerSellableItemsTitle.setAttribute('aria-label', 'Player Sellable Items Section Title');
    store.appendChild(playerSellableItemsTitle);

    getNodeCropEntries(gameState).forEach((entry) => {
        createStoreCropActionSection({
            parent: playerSellableItems,
            sectionId: getSellCropSectionId(entry.cropId),
            title: `Sell ${getCropLabel(entry.cropId)}`,
            ariaLabel: `Sell ${toTitleCase(entry.cropId)} Title`,
            visible: entry.unlocked,
            actionText: 'Sell',
            actionAmount: '1x',
            onClick: () => sellStoreCrop(entry.cropId),
            valueText: getCropSectionValueText(storeValues[getStoreCropPriceKey(entry.cropId)], 'coins'),
        });
    });

    // Field Expansion Section
    const fieldExpansionSection = document.createElement('section');
    fieldExpansionSection.classList.add('store-section');
    fieldExpansionSection.id = 'field-expansion-section';
    fieldExpansionSection.setAttribute('aria-label', 'Field Expansion Section');

    // Field Expansion Section Title
    const fieldExpansionTitle = document.createElement('h3');
    fieldExpansionTitle.classList.add('store-section-title');
    fieldExpansionTitle.textContent = 'Field Expansion';
    fieldExpansionTitle.setAttribute('aria-label', 'Field Expansion Section Title');
    store.appendChild(fieldExpansionTitle);

    // Append sections to store
        // Plot Item Title
        const buyPlotSection = document.createElement('section');
        buyPlotSection.classList.add('item-title');
        buyPlotSection.id = "buyPlotSection";
        buyPlotSection.setAttribute('aria-label', 'Buy Plot Title');

        const buyPlotLabel = document.createElement('span');
        buyPlotLabel.classList.add('item-title-label');
        buyPlotLabel.textContent = 'Buy Plot';
        buyPlotSection.appendChild(buyPlotLabel);

        fieldExpansionSection.appendChild(buyPlotSection);

        // Buy Plot Button
        const buyPlotButton = document.createElement('button');
        buyPlotButton.classList.add('store-button');
        buyPlotButton.textContent = 'Buy';
        buyPlotButton.dataset.actionAmount = '1x';
        buyPlotButton.onclick = buyStorePlot;
        buyPlotSection.appendChild(buyPlotButton);

        // Plot Cost Title
        const buyPlotCost = document.createElement('span');
        buyPlotCost.classList.add('item-price');
        buyPlotCost.setAttribute('id', 'plot-cost');
        buyPlotCost.textContent = `${getStoreValues().plotCost} coin(s)`;
        buyPlotSection.appendChild(buyPlotCost);

    // Append sections to store
    buyItemsTitle.appendChild(buyItemsSection);
    playerSellableItemsTitle.appendChild(playerSellableItems);
    fieldExpansionTitle.appendChild(fieldExpansionSection);

    // Append store to the main div
    const mainDiv = document.querySelector('main');
    if (mainDiv) {
        mainDiv.appendChild(store);
    } else {
        console.error('Main div not found');
    }

    initializeCollapsibleStoreSections();
}

function addBulkSeedButton(cropType, achievementValue, bonusTier) {
    const tierConfig = bulkTiers.seedPacks[bonusTier - 1];
    const quantity = tierConfig?.quantity;
    const discountMultiplier = tierConfig?.discountMultiplier;

    if (!quantity || !discountMultiplier) {
        return;
    }

    const sectionId = getBuySeedSectionId(cropType);
    const seedCost = storeValues[getStoreSeedCostKey(cropType)];
    const section = document.getElementById(sectionId);
    if (!section) return;

    const buttonId = `${cropType}-bulk-seed-${quantity}`;
    if (document.getElementById(buttonId)) return;

    const totalCost = Math.max(1, Math.ceil(quantity * seedCost * discountMultiplier));

    const bulkButton = document.createElement('button');
    bulkButton.classList.add('store-button');
    bulkButton.id = buttonId;
    bulkButton.textContent = 'Buy';
    bulkButton.addEventListener('click', () => buyStoreBulkSeedPack(cropType, quantity, totalCost));
    section.appendChild(bulkButton);

    const bulkCost = document.createElement('span');
    bulkCost.classList.add('item-price');
    bulkCost.id = `${buttonId}-cost`;
    bulkCost.textContent = `${totalCost} coins`;
    section.appendChild(bulkCost);

    bulkButton.dataset.actionAmount = `${quantity}x`;

    syncStoreSectionFocus(section);
}

function addBulkCropSaleButton(cropType, achievementValue, bonusTier) {
    const tierConfig = bulkTiers.cropSales[bonusTier - 1];
    const quantity = tierConfig?.quantity;
    const bonusPercent = tierConfig?.bonusPercent;

    if (!quantity || !bonusPercent) {
        return;
    }

    const multiplier = 1 + bonusPercent / 100;

    const sectionId = getSellCropSectionId(cropType);
    const cropPrice = storeValues[getStoreCropPriceKey(cropType)];
    const section = document.getElementById(sectionId);
    if (!section) return;

    const buttonId = `${cropType}-bulk-sale-${quantity}`;
    if (document.getElementById(buttonId)) return;

    const payout = Math.max(1, Math.floor(quantity * cropPrice * multiplier));

    const bulkButton = document.createElement('button');
    bulkButton.classList.add('store-button');
    bulkButton.id = buttonId;
    bulkButton.textContent = 'Sell';
    bulkButton.addEventListener('click', () => sellStoreBulkCropPack(cropType, quantity, payout));
    section.appendChild(bulkButton);

    const bulkValue = document.createElement('span');
    bulkValue.classList.add('item-price');
    bulkValue.id = `${buttonId}-value`;
    bulkValue.textContent = `${payout} coins (+${bonusPercent}%)`;
    section.appendChild(bulkValue);

    bulkButton.dataset.actionAmount = `${quantity}x`;

    syncStoreSectionFocus(section);
}

function addSellAllCropButton(cropType) {
    const sectionId = getSellCropSectionId(cropType);
    const onClick = () => sellAllStoreCrop(cropType);
    if (!sectionId || typeof onClick !== 'function') {
        return;
    }

    const section = document.getElementById(sectionId);
    if (!section) {
        return;
    }

    const buttonId = `${cropType}-sell-all-button`;
    if (document.getElementById(buttonId)) {
        return;
    }

    const sellAllButton = document.createElement('button');
    sellAllButton.classList.add('store-button');
    sellAllButton.id = buttonId;
    sellAllButton.textContent = 'Sell';
    sellAllButton.dataset.actionAmount = 'All';
    sellAllButton.addEventListener('click', onClick);
    section.appendChild(sellAllButton);

    syncStoreSectionFocus(section);
}

function addBulkWaterRefillButton(achievementValue, bonusTier) {
    const buyWaterSection = document.getElementById('buyWaterSection');
    if (!buyWaterSection) {
        return;
    }

    const tierConfig = bulkTiers.waterRefills[bonusTier - 1];
    const refillAmount = tierConfig?.quantity;
    const costMultiplier = tierConfig?.costMultiplier;
    if (!refillAmount) {
        return;
    }

    const scaledCost = Math.max(1, Math.ceil((refillAmount / storeValues.waterQuantity) * storeValues.waterCost * (costMultiplier || 1)));

    const buttonId = `bulk-water-refill-${achievementValue}`;
    if (document.getElementById(buttonId)) {
        return;
    }

    const waterButton = document.createElement('button');
    waterButton.classList.add('store-button');
    waterButton.id = buttonId;
    waterButton.textContent = 'Buy';
    waterButton.dataset.actionAmount = `${refillAmount}x`;
    waterButton.addEventListener('click', () => buyStoreBulkWaterRefill(refillAmount, scaledCost));
    buyWaterSection.appendChild(waterButton);

    const waterCost = document.createElement('span');
    waterCost.classList.add('item-price');
    waterCost.id = `${buttonId}-cost`;
    waterCost.textContent = `${scaledCost} coins`;
    buyWaterSection.appendChild(waterCost);

    syncStoreSectionFocus(buyWaterSection);
}

function setStorePlotCostLabel(cost) {
    const buyPlotCost = document.getElementById('plot-cost');
    if (!buyPlotCost) {
        return;
    }

    const normalizedCost = Math.max(0, Number(cost) || 0);
    buyPlotCost.textContent = `${normalizedCost} coin(s)`;
}

export { initializeStore, 
         initializeStoreTitle, 
         getStoreValues, 
         getStoreValuesSnapshot,
         applyStoreValuesSnapshot,
         updateStoreValues,
         setStorePlotCostLabel,
         addBulkSeedButton, 
         addBulkCropSaleButton,
         addSellAllCropButton,
         addBulkWaterRefillButton };
