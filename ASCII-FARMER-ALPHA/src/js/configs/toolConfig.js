const TOOLS = {
    PLOW: 'Plow',
    SEED_BAG: 'Seed Bag',
    WATERING_CAN: 'Watering Can',
    SCYTHE: 'Scythe',
};

const TOOL_ORDER = [
    TOOLS.PLOW,
    TOOLS.SEED_BAG,
    TOOLS.WATERING_CAN,
    TOOLS.SCYTHE,
];

const WATERING_SYMBOLS = ['.', '/', '|', '\\'];
const HARVEST_SYMBOLS = ['¥', '₡', '₮', '₱', '₵'];

function getRequiredToolForSymbol(symbol) {
    if (symbol === '~') {
        return TOOLS.PLOW;
    }

    if (symbol === '=') {
        return TOOLS.SEED_BAG;
    }

    if (WATERING_SYMBOLS.includes(symbol)) {
        return TOOLS.WATERING_CAN;
    }

    return null;
}

export { TOOLS, TOOL_ORDER, WATERING_SYMBOLS, HARVEST_SYMBOLS, getRequiredToolForSymbol };
