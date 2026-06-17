// ui/resource.js
import { getActiveNodeState as getState, logWorldState as logGameState } from "../worldState.js";
import { trackAchievements } from "../handlers/achievementHandlers.js";
import { getStoreValues, initializeStore } from "./store.js";
import { getCropLabel } from "../configs/cropConfig.js";
import { getNodeCropEntries } from "../state/nodeCropView.js";
//import { logUpgradeValues } from "./upgrades.js";

const RESOURCES_UPDATED_EVENT = 'resources:updated';
const resourceFlashFrameHandles = new WeakMap();

function buildCropResourceItems(gameState, valueKey) {
    return getNodeCropEntries(gameState).map((entry) => ({
        label: getCropLabel(entry.cropId),
        value: entry[valueKey],
        elementId: valueKey === 'seedCount' ? `${entry.cropId}-seeds` : entry.cropId,
        ariaLabel: `${getCropLabel(entry.cropId, { includeSymbol: false })} ${valueKey === 'seedCount' ? 'seeds' : 'crops'}`,
        itemId: entry.cropId === 'wheat'
            ? (valueKey === 'seedCount' ? null : 'wheat-item')
            : (valueKey === 'seedCount' ? `${entry.cropId}-seeds-item` : `${entry.cropId}-item`),
        display: entry.unlocked ? 'flex' : 'none',
    }));
}

function createResourceItem(label, value, elementId, ariaLabel, options = {}) {
    const resourceItem = document.createElement('div');
    resourceItem.classList.add('resource-item');

    if (options.offset) {
        resourceItem.classList.add('resource-item--offset');
    }

    if (options.subitem) {
        resourceItem.classList.add('resource-subitem');
    }

    if (options.itemId) {
        resourceItem.id = options.itemId;
    }

    if (options.display) {
        resourceItem.style.display = options.display;
    }

    const labelEl = document.createElement('span');
    labelEl.classList.add('resource-item-label');
    labelEl.textContent = `${label}:`;

    const valueEl = document.createElement('span');
    valueEl.classList.add('resource-value');
    valueEl.id = elementId;
    valueEl.setAttribute('aria-label', ariaLabel);
    valueEl.textContent = String(value);

    resourceItem.appendChild(labelEl);
    resourceItem.appendChild(valueEl);
    return resourceItem;
}

function createResourceGroup(title, items) {
    const resourceGroup = document.createElement('div');
    resourceGroup.classList.add('resource-group');
    resourceGroup.innerHTML = `<strong>${title}</strong>`;

    items.forEach((item) => {
        resourceGroup.appendChild(createResourceItem(item.label, item.value, item.elementId, item.ariaLabel, {
            subitem: true,
            itemId: item.itemId,
            display: item.display,
        }));
    });

    return resourceGroup;
}

function initializeResourceBarTitle() {
    // Resource Bar Title
    const resourceBarTitle = document.createElement('section');
    resourceBarTitle.classList.add('container-title');
    resourceBarTitle.id = 'resource-bar-title';
    resourceBarTitle.setAttribute('aria-label', 'Resource Bar Title');
    resourceBarTitle.textContent = 'Player Resources';

    const mainDiv = document.querySelector('main');
    if (mainDiv) {
        mainDiv.appendChild(resourceBarTitle);
    } else {
        console.error('Main div not found');
    }
}

function initializeResourceBar(){ 
    // Create the resource bar container
    const resourcePanel = document.createElement('section');
    resourcePanel.classList.add('resource-panel');
    resourcePanel.id = 'resource-bar';
    resourcePanel.setAttribute('aria-label', 'Resource Bars');

    const primaryResourceBar = document.createElement('div');
    primaryResourceBar.classList.add('resource-bar');
    primaryResourceBar.id = 'resource-bar-primary';
    primaryResourceBar.setAttribute('aria-label', 'Primary Resource Bar');

    const secondaryResourceBar = document.createElement('div');
    secondaryResourceBar.classList.add('resource-bar');
    secondaryResourceBar.id = 'resource-bar-secondary';
    secondaryResourceBar.setAttribute('aria-label', 'Secondary Resource Bar');

    const tertiaryResourceBar = document.createElement('div');
    tertiaryResourceBar.classList.add('resource-bar');
    tertiaryResourceBar.id = 'resource-bar-tertiary';
    tertiaryResourceBar.setAttribute('aria-label', 'Tertiary Resource Bar');

    const gameState = getState(); // Retrieves the initial player resource values
    
    // Coins Section
    primaryResourceBar.appendChild(createResourceGroup('Coins', [
        {
            label: 'Balance',
            value: gameState.coins,
            elementId: 'coins',
            ariaLabel: 'Player coins',
        },
    ]));

    // Equipment Resources Section
    secondaryResourceBar.appendChild(createResourceGroup('Equipment Resources', [
        {
            label: 'Water',
            value: gameState.water,
            elementId: 'water',
            ariaLabel: 'Current water',
        },
        {
            label: 'Water Cap',
            value: gameState.waterCapacity,
            elementId: 'water-capacity',
            ariaLabel: 'Water capacity',
        },
    ]));

    // Seeds Group
    tertiaryResourceBar.appendChild(createResourceGroup('Seeds', buildCropResourceItems(gameState, 'seedCount')));

    // Crops Group
    tertiaryResourceBar.appendChild(createResourceGroup('Crops', buildCropResourceItems(gameState, 'cropCount')));

    resourcePanel.appendChild(primaryResourceBar);
    resourcePanel.appendChild(secondaryResourceBar);
    resourcePanel.appendChild(tertiaryResourceBar);

    const htmlMain = document.querySelector('main');
    htmlMain.appendChild(resourcePanel);
}

function updateResourceBar() {
    const gameState = getState();
    const storeValues = getStoreValues();

    // Update the resource values in the UI
    updateResourceValue('coins', gameState.coins);
    
    getNodeCropEntries(gameState).forEach((entry) => {
        updateResourceValue(`${entry.cropId}-seeds`, entry.seedCount);
        updateResourceValue(entry.cropId, entry.cropCount);

        const seedItem = document.getElementById(`${entry.cropId}-seeds-item`);
        if (seedItem) {
            seedItem.style.display = entry.unlocked ? 'flex' : 'none';
        }

        const cropItem = document.getElementById(`${entry.cropId}-item`);
        if (cropItem) {
            cropItem.style.display = entry.unlocked ? 'flex' : 'none';
        }
    });
    
    updateResourceValue('water', gameState.water);
    updateResourceValue('water-capacity', gameState.waterCapacity);
    
    updatePlotCostDisplay();
    trackAchievements();
    logGameState();
    document.dispatchEvent(new CustomEvent(RESOURCES_UPDATED_EVENT));
//    logUpgradeValues();    
}

function updateResourceValue(elementId, nextValue) {
    const element = document.getElementById(elementId);
    if (!element) {
        return;
    }

    const nextText = String(nextValue);
    const previousText = element.textContent ?? '';
    if (previousText === nextText) {
        return;
    }

    element.textContent = nextText;
    element.classList.add('resource-value');
    const flashColor = computeNearOppositeFlashColor(element);
    element.style.setProperty('--resource-flash-color', flashColor);

    const pendingFrameHandle = resourceFlashFrameHandles.get(element);
    if (pendingFrameHandle) {
        window.cancelAnimationFrame(pendingFrameHandle);
    }

    element.classList.remove('resource-value--flash');
    const frameHandle = window.requestAnimationFrame(() => {
        const nestedFrameHandle = window.requestAnimationFrame(() => {
            element.classList.add('resource-value--flash');
            resourceFlashFrameHandles.delete(element);
        });

        resourceFlashFrameHandles.set(element, nestedFrameHandle);
    });

    resourceFlashFrameHandles.set(element, frameHandle);
}

function computeNearOppositeFlashColor(element) {
    const computedColor = getComputedStyle(element).color;
    const computedBackground = getComputedStyle(element).backgroundColor;
    const channelMatches = computedColor.match(/\d+(?:\.\d+)?/g);
    const backgroundMatches = computedBackground.match(/\d+(?:\.\d+)?/g);
    if (!channelMatches || channelMatches.length < 3) {
        return 'rgba(240, 240, 240, 0.45)';
    }

    const [r, g, b] = channelMatches.slice(0, 3).map((value) => {
        return Math.max(0, Math.min(255, Number.parseFloat(value)));
    });

    const [bgR, bgG, bgB] = (backgroundMatches && backgroundMatches.length >= 3
        ? backgroundMatches.slice(0, 3)
        : ['255', '255', '255'])
        .map((value) => {
            return Math.max(0, Math.min(255, Number.parseFloat(value)));
        });

    const opposite = [255 - r, 255 - g, 255 - b];
    let nearOpposite = opposite.map((oppositeChannel, index) => {
        const originalChannel = [r, g, b][index];
        return Math.round((oppositeChannel * 0.85) + (originalChannel * 0.15));
    });

    const distanceFromBackground = Math.sqrt(
        ((nearOpposite[0] - bgR) ** 2)
        + ((nearOpposite[1] - bgG) ** 2)
        + ((nearOpposite[2] - bgB) ** 2),
    );

    // Guarantee visible contrast against the value box background.
    if (distanceFromBackground < 80) {
        nearOpposite = [
            Math.round((bgR * 0.15) + ((255 - bgR) * 0.85)),
            Math.round((bgG * 0.15) + ((255 - bgG) * 0.85)),
            Math.round((bgB * 0.15) + ((255 - bgB) * 0.85)),
        ];
    }

    return `rgba(${nearOpposite[0]}, ${nearOpposite[1]}, ${nearOpposite[2]}, 0.45)`;
}


function updatePlotCostDisplay() {
    const gameState = getState();
    const storeValues = getStoreValues();
    const buyPlotCost = document.getElementById('plot-cost');
    if (buyPlotCost) {
        buyPlotCost.textContent = `${storeValues.plotCost} coin(s)`;
        //console.log(`Updated plot cost display to ${gameState.plotCost} coin(s)`); // Debug statement
    } else {
        console.log('Error: buyPlotCost element not found'); // Debug statement
    }
}

export { RESOURCES_UPDATED_EVENT, initializeResourceBarTitle, initializeResourceBar, updateResourceBar };