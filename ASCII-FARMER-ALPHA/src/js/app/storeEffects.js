import { configureStoreHandlerAdapters } from '../handlers/storeHandlers.js';
import { getStoreValues, updateStoreValues, setStorePlotCostLabel } from '../ui/store.js';
import { updateResourceBar } from '../ui/resource.js';
import { updateField } from '../ui/field.js';
import { updateClicksDisplay } from '../ui/clicks.js';
import { playCoinGainBurst } from '../ui/sfx.js';
import { showNotification, showDialog } from '../ui/macNotifications.js';

let storeEffectsInitialized = false;

export function initializeStoreEffects() {
    if (storeEffectsInitialized) {
        return;
    }

    configureStoreHandlerAdapters({
        getStoreValues,
        updateStoreValues,
        updateResourceBar,
        updateField,
        updateClicksDisplay,
        playCoinGainBurst,
        showNotification,
        showDialog,
        setPlotCostLabel: setStorePlotCostLabel,
    });

    storeEffectsInitialized = true;
}
