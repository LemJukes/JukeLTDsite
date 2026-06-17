// cropConfig.js
// Configuration for different crop types

const cropTypes = {
    wheat: {
        id: 'wheat',
        name: 'Wheat',
        pluralName: 'Wheat',
        symbol: '¥',
        waterStages: 3,
        salePrice: 2,
        seedCost: 1
    },
    corn: {
        id: 'corn',
        name: 'Corn',
        pluralName: 'Corn',
        symbol: '₡',
        waterStages: 4,
        salePrice: 7,
        seedCost: 4
    },
    tomato: {
        id: 'tomato',
        name: 'Tomato',
        pluralName: 'Tomatoes',
        symbol: '₮',
        waterStages: 5,
        salePrice: 16,
        seedCost: 9
    },
    potato: {
        id: 'potato',
        name: 'Potato',
        pluralName: 'Potatoes',
        symbol: '₱',
        waterStages: 5,
        salePrice: 24,
        seedCost: 14
    },
    carrot: {
        id: 'carrot',
        name: 'Carrot',
        pluralName: 'Carrots',
        symbol: '₵',
        waterStages: 6,
        salePrice: 34,
        seedCost: 20
    }
};

// Helper function to get growth symbol based on water count
// Growth cycles through: / → | → \ → repeat
function getGrowthSymbol(waterCount) {
    const symbols = ['/', '|', '\\'];
    return symbols[waterCount % 3];
}

function getCropConfig(cropId) {
    return cropTypes[cropId];
}

function getAllCropTypes() {
    return Object.values(cropTypes);
}

function getCropIds() {
    return Object.keys(cropTypes);
}

function getCropLabel(cropId, { plural = false, includeSymbol = true } = {}) {
    const cropConfig = getCropConfig(cropId);
    if (!cropConfig) {
        return plural ? 'Crops' : 'Crop';
    }

    const baseLabel = plural
        ? (cropConfig.pluralName || `${cropConfig.name}s`)
        : cropConfig.name;

    if (!includeSymbol) {
        return baseLabel;
    }

    return `${baseLabel} (${cropConfig.symbol})`;
}

export { cropTypes, getGrowthSymbol, getCropConfig, getAllCropTypes, getCropIds, getCropLabel };
