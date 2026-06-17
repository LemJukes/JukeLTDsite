import { configurePlotHandlerAdapters } from '../handlers/plotHandlers.js';
import { updateResourceBar } from '../ui/resource.js';
import { getUpgradeValues, updateUpgradeValues, renderClickUpgradesSection } from '../ui/upgrades.js';
import { playPlotBubbleForState, playAdjacentBubbleForState } from '../ui/sfx.js';
import { updateClicksDisplay } from '../ui/clicks.js';
import { updateToolboxDisplay } from '../ui/toolbox.js';
import { showNotification } from '../ui/macNotifications.js';

let plotEffectsInitialized = false;

function getPlotButtonByIndex(plotIndex) {
    const field = document.getElementById('field');
    if (!field) {
        return null;
    }

    return field.querySelector(`.plotButton[data-plot-index="${plotIndex}"]`);
}

export function initializePlotEffects() {
    if (plotEffectsInitialized) {
        return;
    }

    configurePlotHandlerAdapters({
        updateResourceBar,
        getUpgradeValues,
        updateUpgradeValues,
        renderClickUpgradesSection,
        playPlotBubbleForState,
        playAdjacentBubbleForState,
        updateClicksDisplay,
        updateToolboxDisplay,
        showNotification,
        getPlotButtonByIndex,
    });

    plotEffectsInitialized = true;
}
