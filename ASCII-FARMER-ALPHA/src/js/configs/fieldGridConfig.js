const FIELD_GRID_WIDTH = 9;
const FIELD_GRID_HEIGHT = 9;
const FIELD_GRID_CAPACITY = FIELD_GRID_WIDTH * FIELD_GRID_HEIGHT;
const FIELD_CENTER_INDEX = Math.floor(FIELD_GRID_CAPACITY / 2);

function isValidPlotIndex(index) {
    return Number.isInteger(index) && index >= 0 && index < FIELD_GRID_CAPACITY;
}

function getOrthogonalNeighborIndices(index) {
    if (!isValidPlotIndex(index)) {
        return [];
    }

    const row = Math.floor(index / FIELD_GRID_WIDTH);
    const col = index % FIELD_GRID_WIDTH;
    const neighbors = [];

    if (row > 0) {
        neighbors.push(((row - 1) * FIELD_GRID_WIDTH) + col);
    }

    if (row < (FIELD_GRID_HEIGHT - 1)) {
        neighbors.push(((row + 1) * FIELD_GRID_WIDTH) + col);
    }

    if (col > 0) {
        neighbors.push((row * FIELD_GRID_WIDTH) + (col - 1));
    }

    if (col < (FIELD_GRID_WIDTH - 1)) {
        neighbors.push((row * FIELD_GRID_WIDTH) + (col + 1));
    }

    return neighbors;
}

function countOwnedPlots(plotStates) {
    if (!Array.isArray(plotStates)) {
        return 0;
    }

    return plotStates.reduce((count, plotState) => count + (plotState?.owned ? 1 : 0), 0);
}

function getAvailablePlotPurchaseIndices(field) {
    if (!field || !Array.isArray(field.plotStates)) {
        return [];
    }

    const { plotStates } = field;
    const available = [];

    for (let i = 0; i < FIELD_GRID_CAPACITY; i++) {
        const plotState = plotStates[i];
        if (plotState?.owned) {
            continue;
        }

        const hasOwnedNeighbor = getOrthogonalNeighborIndices(i).some((neighborIndex) => plotStates[neighborIndex]?.owned);
        if (hasOwnedNeighbor) {
            available.push(i);
        }
    }

    return available;
}

export {
    FIELD_GRID_WIDTH,
    FIELD_GRID_HEIGHT,
    FIELD_GRID_CAPACITY,
    FIELD_CENTER_INDEX,
    isValidPlotIndex,
    getOrthogonalNeighborIndices,
    countOwnedPlots,
    getAvailablePlotPurchaseIndices,
};
