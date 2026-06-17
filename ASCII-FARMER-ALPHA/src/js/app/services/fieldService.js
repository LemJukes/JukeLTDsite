import {
    handlePlotClick,
    getAverageFieldFallowDurationMs,
    syncPlotButtonPresentation,
} from '../../handlers/plotHandlers.js';

function performPlotClick(plotButton, plotIndex) {
    return handlePlotClick(plotButton, plotIndex);
}

function getFieldAverageFallowDurationMs(activeField, gameState) {
    return getAverageFieldFallowDurationMs(activeField, gameState);
}

function syncFieldPlotButtonPresentation(plotButton, plotState, plotIndex, now) {
    return syncPlotButtonPresentation(plotButton, plotState, plotIndex, now);
}

export {
    performPlotClick,
    getFieldAverageFallowDurationMs,
    syncFieldPlotButtonPresentation,
};
