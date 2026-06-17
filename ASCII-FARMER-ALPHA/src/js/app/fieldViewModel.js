import {
    FIELD_GRID_WIDTH,
    FIELD_GRID_HEIGHT,
    getAvailablePlotPurchaseIndices,
} from '../configs/fieldGridConfig.js';

const FIELD_VIEWPORT_MIN_SIZE = 5;
const FIELD_VIEWPORT_MAX_SIZE = 9;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getRenderIndices(activeField, gameState) {
    if (!activeField || !Array.isArray(activeField.plotStates)) {
        return [];
    }

    const ownedIndices = [];
    activeField.plotStates.forEach((plotState, index) => {
        if (plotState?.owned) {
            ownedIndices.push(index);
        }
    });

    if (gameState?.plotSelectionMode !== 'buyPlot') {
        return ownedIndices;
    }

    const availablePurchaseIndices = getAvailablePlotPurchaseIndices(activeField);
    return [...new Set([...ownedIndices, ...availablePurchaseIndices])].sort((a, b) => a - b);
}

function calculateViewport(renderIndices) {
    if (!renderIndices.length) {
        return {
            size: FIELD_VIEWPORT_MIN_SIZE,
            startRow: 2,
            startCol: 2,
        };
    }

    let minRow = FIELD_GRID_HEIGHT;
    let maxRow = -1;
    let minCol = FIELD_GRID_WIDTH;
    let maxCol = -1;

    renderIndices.forEach((index) => {
        const row = Math.floor(index / FIELD_GRID_WIDTH);
        const col = index % FIELD_GRID_WIDTH;
        minRow = Math.min(minRow, row);
        maxRow = Math.max(maxRow, row);
        minCol = Math.min(minCol, col);
        maxCol = Math.max(maxCol, col);
    });

    const requiredRows = (maxRow - minRow) + 1;
    const requiredCols = (maxCol - minCol) + 1;
    const size = clamp(Math.max(requiredRows, requiredCols), FIELD_VIEWPORT_MIN_SIZE, FIELD_VIEWPORT_MAX_SIZE);
    const centerRow = (minRow + maxRow) / 2;
    const centerCol = (minCol + maxCol) / 2;
    const startRow = clamp(Math.round(centerRow - (size / 2)), 0, FIELD_GRID_HEIGHT - size);
    const startCol = clamp(Math.round(centerCol - (size / 2)), 0, FIELD_GRID_WIDTH - size);

    return {
        size,
        startRow,
        startCol,
    };
}

export function buildFieldRenderViewModel(activeField, gameState) {
    const renderIndices = getRenderIndices(activeField, gameState);
    return {
        renderIndices,
        viewport: calculateViewport(renderIndices),
    };
}
