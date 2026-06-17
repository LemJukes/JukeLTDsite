const progressionConfig = {
    achievements: {
        totalCoinsSpent: [80, 240, 700, 2000],
        totalCoinsEarned: [20, 90, 260, 700, 1600],
        waterRefillsPurchased: [4, 12, 28, 55, 95, 150, 230, 340, 500],
        seedsBought: {
            wheat: [15, 50, 140, 300, 600, 1100, 1900, 3000, 4500],
            corn: [10, 35, 100, 220, 450, 850, 1450, 2300, 3400],
            tomato: [8, 25, 70, 160, 330, 620, 1050, 1700, 2500],
            potato: [6, 20, 60, 150, 300, 560, 950, 1500, 2200],
            carrot: [5, 16, 48, 120, 250, 470, 800, 1300, 1900],
        },
        cropsSold: {
            wheat: [12, 40, 120],
            corn: [9, 30, 85],
            tomato: [7, 22, 60],
            potato: [6, 18, 52],
            carrot: [5, 15, 44],
        },
    },
    unlocks: {
        cropsByTotalCoinsEarned: {
            corn: 250,
            tomato: 500,
            potato: 800,
            carrot: 1200,
        },
        fieldsBySpendAndFirstFieldPlots: {
            coinsSpent: 50000,
            firstFieldRequiredPlots: 81,
        },
        upgradeSections: {
            waterUpgradesByWaterRefills: 4,
            clickUpgradesByCoinsEarned: 20,
        },
        expandedClickByCoinsSpent: {
            mk1: 240,
            mk2: 700,
            mk3: 2000,
            mk4: 6000,
            mk5: 18000,
            mk6: 54000,
        },
        toolAutoChangerChargePacksByCoinsEarned: {
            pack100: 90,
            pack500: 260,
            pack1000: 700,
        },
        waterAutoBuyerByWaterRefills: 50,
    },
    storeEconomy: {
        seedCosts: {
            wheat: 1,
            corn: 4,
            tomato: 9,
            potato: 14,
            carrot: 20,
        },
        sellPrices: {
            wheat: 2,
            corn: 7,
            tomato: 16,
            potato: 24,
            carrot: 34,
        },
        water: {
            cost: 1,
            quantity: 10,
            autoBuyer: {
                triggerBelow: 5,
                surchargeMultiplier: 1.1,
                tickMs: 500,
            },
        },
        plot: {
            baseCost: 10,
            scalingStartPlotCount: 9,
            scalingMultiplier: 1.06,
            fallowTime: {
                minPlotCount: 3,
                maxPlotCount: 81,
                minDurationMs: 250,
                maxDurationMs: 30000,
                repeatPenaltyStepMultiplier: 0.2,
                durationCapMultiplier: 3,
            },
        },
        fieldPurchase: {
            baseCost: 1000,
            costIncreasePerField: 1000,
        },
    },
    upgradesEconomy: {
        waterCapacity: {
            baseCost: 35,
            scalingMultiplier: 1.06,
            capacityIncrease: 10,
        },
        waterAutoBuyer: {
            baseCost: 90,
        },
        expandedClick: {
            mk1Cost: 140,
            mk2Cost: 600,
            mk3Cost: 1800,
            mk4Cost: 5400,
            mk5Cost: 16200,
            mk6Cost: 48600,
        },
        toolAutoChanger: {
            baseCost: 90,
            chargePackCosts: {
                pack100: 30,
                pack500: 115,
                pack1000: 210,
            },
        },
    },
    bulkTiers: {
        seedPacks: [
            { quantity: 5, discountMultiplier: 0.9 },
            { quantity: 15, discountMultiplier: 0.8 },
            { quantity: 30, discountMultiplier: 0.72 },
            { quantity: 60, discountMultiplier: 0.68 },
            { quantity: 120, discountMultiplier: 0.64 },
            { quantity: 220, discountMultiplier: 0.6 },
            { quantity: 400, discountMultiplier: 0.56 },
            { quantity: 700, discountMultiplier: 0.52 },
            { quantity: 1000, discountMultiplier: 0.5 },
        ],
        cropSales: [
            { quantity: 5, bonusPercent: 8 },
            { quantity: 15, bonusPercent: 18 },
            { quantity: 30, bonusPercent: 30 },
        ],
        waterRefills: [
            { quantity: 30, costMultiplier: 0.95 },
            { quantity: 80, costMultiplier: 0.85 },
            { quantity: 160, costMultiplier: 0.75 },
            { quantity: 250, costMultiplier: 0.7 },
            { quantity: 360, costMultiplier: 0.65 },
            { quantity: 500, costMultiplier: 0.6 },
            { quantity: 650, costMultiplier: 0.56 },
            { quantity: 820, costMultiplier: 0.53 },
            { quantity: 1000, costMultiplier: 0.5 },
        ],
    },
};

function getAchievementValues() {
    return {
        totalCoinsSpent: [...progressionConfig.achievements.totalCoinsSpent],
        totalCoinsEarned: [...progressionConfig.achievements.totalCoinsEarned],
        waterRefillsPurchased: [...progressionConfig.achievements.waterRefillsPurchased],
        seedsBoughtByCrop: {
            wheat: [...progressionConfig.achievements.seedsBought.wheat],
            corn: [...progressionConfig.achievements.seedsBought.corn],
            tomato: [...progressionConfig.achievements.seedsBought.tomato],
            potato: [...progressionConfig.achievements.seedsBought.potato],
            carrot: [...progressionConfig.achievements.seedsBought.carrot],
        },
        cropsSoldByCrop: {
            wheat: [...progressionConfig.achievements.cropsSold.wheat],
            corn: [...progressionConfig.achievements.cropsSold.corn],
            tomato: [...progressionConfig.achievements.cropsSold.tomato],
            potato: [...progressionConfig.achievements.cropsSold.potato],
            carrot: [...progressionConfig.achievements.cropsSold.carrot],
        },
    };
}

export { progressionConfig, getAchievementValues };
