// ui/achievements.js
import { getActiveNodeState as getState } from '../worldState.js';
import { progressionConfig } from '../configs/progressionConfig.js';
import { getCropIds, getCropLabel } from '../configs/cropConfig.js';
import { isCropUnlocked } from '../state/nodeCropView.js';

// ─── Achievement Catalog ───────────────────────────────────────────────────────
// Builds a deterministic list of every achievement in the game with metadata:
//   id          — matches the ID stored in gameState.achievementsUnlocked (or a
//                 synthetic key for milestone flags tracked on the state object)
//   title       — display name shown in the window
//   reachedValue — descriptive threshold/condition string
//   reward      — short label for what the player received
//   isUnlocked  — (state) => boolean

function buildAchievementCatalog() {
    const ach = progressionConfig.achievements;
    const unlocks = progressionConfig.unlocks;
    const bulk = progressionConfig.bulkTiers;
    const catalog = [];

    // ── Coins Earned ──────────────────────────────────────────────────────────
    const coinsEarnedRewardMap = {
        [unlocks.upgradeSections.clickUpgradesByCoinsEarned]:
            'Reward: Click Upgrades section',
        [unlocks.toolAutoChangerChargePacksByCoinsEarned.pack100]:
            'Reward: Auto-Changer Pack 100',
        [unlocks.toolAutoChangerChargePacksByCoinsEarned.pack500]:
            'Reward: Auto-Changer Pack 500',
        [unlocks.toolAutoChangerChargePacksByCoinsEarned.pack1000]:
            'Reward: Auto-Changer Pack 1000',
    };

    ach.totalCoinsEarned.forEach((threshold) => {
        catalog.push({
            id: `totalCoinsEarned-${threshold}`,
            title: 'Coins Earned',
            reachedValue: threshold.toLocaleString(),
            reward: coinsEarnedRewardMap[threshold] ?? 'Reward: None',
            isUnlocked: (state) =>
                state.achievementsUnlocked.includes(`totalCoinsEarned-${threshold}`),
        });
    });

    // ── Coins Spent ───────────────────────────────────────────────────────────
    const coinsSpentRewardMap = {
        [unlocks.expandedClickByCoinsSpent.mk1]: 'Reward: Expanded Click Mk1',
        [unlocks.expandedClickByCoinsSpent.mk2]: 'Reward: Expanded Click Mk2',
        [unlocks.expandedClickByCoinsSpent.mk3]: 'Reward: Expanded Click Mk3',
        [unlocks.expandedClickByCoinsSpent.mk4]: 'Reward: Expanded Click Mk4',
        [unlocks.expandedClickByCoinsSpent.mk5]: 'Reward: Expanded Click Mk5',
        [unlocks.expandedClickByCoinsSpent.mk6]: 'Reward: Expanded Click Mk6',
    };

    ach.totalCoinsSpent.forEach((threshold) => {
        catalog.push({
            id: `totalCoinsSpent-${threshold}`,
            title: 'Coins Spent',
            reachedValue: threshold.toLocaleString(),
            reward: coinsSpentRewardMap[threshold] ?? 'Reward: None',
            isUnlocked: (state) =>
                state.achievementsUnlocked.includes(`totalCoinsSpent-${threshold}`),
        });
    });

    // ── Water Refills Purchased ───────────────────────────────────────────────
    ach.waterRefillsPurchased.forEach((threshold, index) => {
        const tier = bulk.waterRefills[index];
        const rewardParts = [];
        if (threshold === unlocks.upgradeSections.waterUpgradesByWaterRefills) {
            rewardParts.push('Water Upgrades section');
        }
        if (tier) {
            const savings = Math.round((1 - tier.costMultiplier) * 100);
            rewardParts.push(`Bulk Water ${tier.quantity}x (${savings}% off)`);
        }
        catalog.push({
            id: `waterRefillsPurchased-${threshold}`,
            title: 'Water Refills Purchased',
            reachedValue: threshold.toLocaleString(),
            reward: rewardParts.length
                ? `Reward: ${rewardParts.join(', ')}`
                : 'Reward: None',
            isUnlocked: (state) =>
                state.achievementsUnlocked.includes(`waterRefillsPurchased-${threshold}`),
        });
    });

    // ── Seeds Bought (per crop) ───────────────────────────────────────────────
    Object.entries(ach.seedsBought).forEach(([crop, thresholds]) => {
        thresholds.forEach((threshold, index) => {
            const tier = bulk.seedPacks[index];
            const reward = tier
                ? `Reward: Bulk ${getCropLabel(crop, { includeSymbol: false })} Seeds ${tier.quantity}x (${Math.round((1 - tier.discountMultiplier) * 100)}% off)`
                : 'Reward: None';
            catalog.push({
                id: `${crop}SeedsBought-${threshold}`,
                title: `${getCropLabel(crop, { includeSymbol: false })} Seeds Bought`,
                reachedValue: threshold.toLocaleString(),
                reward,
                isUnlocked: (state) =>
                    state.achievementsUnlocked.includes(`${crop}SeedsBought-${threshold}`),
            });
        });
    });

    // ── Crops Sold (per crop) ─────────────────────────────────────────────────
    Object.entries(ach.cropsSold).forEach(([crop, thresholds]) => {
        thresholds.forEach((threshold, index) => {
            const tier = bulk.cropSales[index];
            const reward = tier
                ? `Reward: Bulk ${getCropLabel(crop, { includeSymbol: false })} Sale ${tier.quantity}x (+${tier.bonusPercent}%)`
                : 'Reward: None';
            catalog.push({
                id: `${crop}Sold-${threshold}`,
                title: `${getCropLabel(crop, { includeSymbol: false })} Sold`,
                reachedValue: threshold.toLocaleString(),
                reward,
                isUnlocked: (state) =>
                    state.achievementsUnlocked.includes(`${crop}Sold-${threshold}`),
            });
        });
    });

    getCropIds()
        .filter((cropId) => cropId !== 'wheat')
        .forEach((cropId) => {
            catalog.push({
                id: `milestone-${cropId}-unlocked`,
                title: `${getCropLabel(cropId, { includeSymbol: false })} Crop Unlocked`,
                reachedValue: `${unlocks.cropsByTotalCoinsEarned[cropId].toLocaleString()} coins earned`,
                reward: `Reward: ${getCropLabel(cropId, { includeSymbol: false })} seeds & crop access`,
                isUnlocked: (state) => isCropUnlocked(state, cropId),
            });
        });

    // ── Timed Quest Achievements ──────────────────────────────────────────────
    catalog.push({
        id: 'timedQuestsBeaten-1',
        title: 'On the Clock',
        reachedValue: 'Beat 1 timed quest before the timer ran out',
        reward: 'Reward: 100 coins',
        isUnlocked: (state) => state.achievementsUnlocked.includes('timedQuestsBeaten-1'),
    });

    catalog.push({
        id: 'timedQuestsBeaten-3',
        title: 'Time-Critical Operator',
        reachedValue: 'Beat 3 timed quests before the timer ran out',
        reward: 'Reward: 500 coins',
        isUnlocked: (state) => state.achievementsUnlocked.includes('timedQuestsBeaten-3'),
    });

    catalog.push({
        id: 'timedQuestsBeaten-all',
        title: 'Deadline Champion',
        reachedValue: 'Beat all timed quests before the timer ran out',
        reward: 'Reward: 10,000 coins',
        isUnlocked: (state) => state.achievementsUnlocked.includes('timedQuestsBeaten-all'),
    });

    return catalog;
}

const achievementCatalog = buildAchievementCatalog();

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderAchievementsWindow() {
    const mountTarget = document.getElementById('achievements-content-inner');
    if (!mountTarget) return;

    const state = getState();
    const unlockedEntries = achievementCatalog.filter((entry) => entry.isUnlocked(state));

    mountTarget.innerHTML = '';

    const container = document.createElement('div');
    container.classList.add('achievements-display');

    if (unlockedEntries.length === 0) {
        const empty = document.createElement('p');
        empty.classList.add('achievements-empty');
        empty.textContent = 'No achievements unlocked yet.';
        container.appendChild(empty);
    } else {
        const list = document.createElement('ul');
        list.classList.add('achievements-list');
        list.setAttribute('aria-label', 'Unlocked achievements');

        unlockedEntries.forEach((entry) => {
            const item = document.createElement('li');
            item.classList.add('achievement-item');

            const title = document.createElement('span');
            title.classList.add('achievement-item-title');
            title.textContent = entry.title;

            const value = document.createElement('span');
            value.classList.add('achievement-item-value');
            value.textContent = entry.reachedValue;

            const reward = document.createElement('span');
            reward.classList.add('achievement-item-reward');
            reward.textContent = entry.reward;

            item.appendChild(title);
            item.appendChild(value);
            item.appendChild(reward);
            list.appendChild(item);
        });

        container.appendChild(list);
    }

    const footer = document.createElement('div');
    footer.classList.add('achievements-footer');
    footer.textContent = `${unlockedEntries.length} / ${achievementCatalog.length} Achievements Unlocked`;
    container.appendChild(footer);

    mountTarget.appendChild(container);
}

// ─── Public Interface ─────────────────────────────────────────────────────────

function initializeAchievementsDisplay() {
    renderAchievementsWindow();
    document.addEventListener('stateUpdated', renderAchievementsWindow);
}

export { initializeAchievementsDisplay };
