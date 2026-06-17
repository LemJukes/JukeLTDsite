import {
    buyWater,
    buyPlot,
    buyCropSeeds,
    sellCrop,
    sellAllCrop,
    buyBulkSeedPack,
    sellBulkCropPack,
    buyBulkWaterRefill,
} from '../../handlers/storeHandlers.js';

function buyStoreWater() {
    return buyWater();
}

function buyStorePlot() {
    return buyPlot();
}

function buyStoreCropSeeds(cropType) {
    return buyCropSeeds(cropType);
}

function sellStoreCrop(cropType) {
    return sellCrop(cropType);
}

function sellAllStoreCrop(cropType) {
    return sellAllCrop(cropType);
}

function buyStoreBulkSeedPack(cropType, quantity, totalCost) {
    return buyBulkSeedPack(cropType, quantity, totalCost);
}

function sellStoreBulkCropPack(cropType, quantity, payout) {
    return sellBulkCropPack(cropType, quantity, payout);
}

function buyStoreBulkWaterRefill(amount, cost) {
    return buyBulkWaterRefill(amount, cost);
}

export {
    buyStoreWater,
    buyStorePlot,
    buyStoreCropSeeds,
    sellStoreCrop,
    sellAllStoreCrop,
    buyStoreBulkSeedPack,
    sellStoreBulkCropPack,
    buyStoreBulkWaterRefill,
};
