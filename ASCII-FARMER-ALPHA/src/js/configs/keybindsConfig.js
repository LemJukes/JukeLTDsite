export const KEYBINDS_STORAGE_KEY = 'asciiFarmerKeybinds';
export const PLOT_MAPPINGS_STORAGE_KEY = 'asciiFarmerPlotMappings';

export const KEYBIND_ACTIONS = [
    { id: 'tool.plow', label: 'Select Plow', type: 'tool', value: 'Plow', defaultKey: 'A' },
    { id: 'tool.seedBag', label: 'Select Seed Bag', type: 'tool', value: 'Seed Bag', defaultKey: 'S' },
    { id: 'tool.wateringCan', label: 'Select Watering Can', type: 'tool', value: 'Watering Can', defaultKey: 'D' },
    { id: 'tool.scythe', label: 'Select Scythe', type: 'tool', value: 'Scythe', defaultKey: 'F' },
    { id: 'seed.wheat', label: 'Select Wheat Seed', type: 'seed', value: 'wheat', defaultKey: 'Z' },
    { id: 'seed.corn', label: 'Select Corn Seed', type: 'seed', value: 'corn', defaultKey: 'X' },
    { id: 'seed.tomato', label: 'Select Tomato Seed', type: 'seed', value: 'tomato', defaultKey: 'C' },
    { id: 'seed.potato', label: 'Select Potato Seed', type: 'seed', value: 'potato', defaultKey: 'V' },
    { id: 'seed.carrot', label: 'Select Carrot Seed', type: 'seed', value: 'carrot', defaultKey: 'B' },
];

export const DEFAULT_KEYBINDS = Object.fromEntries(
    KEYBIND_ACTIONS.map((action) => [action.id, action.defaultKey]),
);

// Keys 1–0 are permanently reserved for plot navigation.
// Players configure which plot number each key targets, not which key to use.
export const PLOT_KEY_ACTIONS = [
    { id: 'plot.key.1', key: '1', label: 'Key 1 \u2192 Plot', defaultTargetPlot: 1 },
    { id: 'plot.key.2', key: '2', label: 'Key 2 \u2192 Plot', defaultTargetPlot: 2 },
    { id: 'plot.key.3', key: '3', label: 'Key 3 \u2192 Plot', defaultTargetPlot: 3 },
    { id: 'plot.key.4', key: '4', label: 'Key 4 \u2192 Plot', defaultTargetPlot: 4 },
    { id: 'plot.key.5', key: '5', label: 'Key 5 \u2192 Plot', defaultTargetPlot: 5 },
    { id: 'plot.key.6', key: '6', label: 'Key 6 \u2192 Plot', defaultTargetPlot: 6 },
    { id: 'plot.key.7', key: '7', label: 'Key 7 \u2192 Plot', defaultTargetPlot: 7 },
    { id: 'plot.key.8', key: '8', label: 'Key 8 \u2192 Plot', defaultTargetPlot: 8 },
    { id: 'plot.key.9', key: '9', label: 'Key 9 \u2192 Plot', defaultTargetPlot: 9 },
    { id: 'plot.key.0', key: '0', label: 'Key 0 \u2192 Plot', defaultTargetPlot: 10 },
];

export const DEFAULT_PLOT_MAPPINGS = Object.fromEntries(
    PLOT_KEY_ACTIONS.map((action) => [action.id, action.defaultTargetPlot]),
);
