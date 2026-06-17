import { configureQuestHandlerAdapters } from '../handlers/questHandlers.js';
import { getCropLabel as getConfiguredCropLabel } from '../configs/cropConfig.js';
import { getStoreValues } from '../ui/store.js';
import { showConfirmation, showDialog, showNotification } from '../ui/macNotifications.js';
import { updateResourceBar } from '../ui/resource.js';
import { updateClicksDisplay } from '../ui/clicks.js';
import { playCoinGainBurst } from '../ui/sfx.js';
import { setNetworkIconGlow } from '../ui/tutorials.js';
import { getWorldState } from '../worldState.js';
import {
    QUESTS_UPDATED_EVENT,
    getQuestPanelData,
    deliverQuest,
    confirmQuestCancellation,
} from '../handlers/questHandlers.js';

function isCurrentlyDark() {
    if (document.body.classList.contains('dark')) return true;
    if (document.body.classList.contains('light')) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function createQuestUnlockBody(quest) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mac-dialog-content quest-popup-content';

    const spriteSrc = isCurrentlyDark()
        ? './src/assets/farmr/farmr-sprite-DarkMode.gif'
        : './src/assets/farmr/farmr-sprite.gif';

    const sprite = document.createElement('img');
    sprite.className = 'quest-farmr-sprite';
    sprite.src = spriteSrc;
    sprite.alt = 'farmr the digital farmer';

    const intro = document.createElement('p');
    intro.className = 'mac-dialog-message';
    intro.textContent = `${quest.issuer} has routed a fresh produce request through farmr.`;

    const flavor = document.createElement('p');
    flavor.className = 'mac-dialog-message quest-popup-flavor';
    flavor.textContent = quest.flavorText;

    const introText = document.createElement('div');
    introText.append(intro, flavor);

    const introRow = document.createElement('div');
    introRow.className = 'quest-popup-intro-row';
    introRow.append(sprite, introText);

    const details = document.createElement('div');
    details.className = 'quest-popup-details';

    const questIdRow = document.createElement('p');
    questIdRow.className = 'quest-popup-meta';
    questIdRow.textContent = `Quest #${quest.questNumber}`;

    const requirementsHeading = document.createElement('p');
    requirementsHeading.className = 'quest-popup-heading';
    requirementsHeading.textContent = 'Requested Produce';

    const requirementsList = document.createElement('ul');
    requirementsList.className = 'quest-popup-requirements';

    [ 'wheat', 'corn', 'tomato', 'potato', 'carrot' ].forEach((cropType) => {
        const quantity = Number(quest.requirements?.[cropType]) || 0;
        if (quantity < 1) {
            return;
        }

        const item = document.createElement('li');
        item.textContent = `${quantity} ${getConfiguredCropLabel(cropType, { plural: true })}`;
        requirementsList.appendChild(item);
    });

    const reward = document.createElement('p');
    reward.className = 'quest-popup-meta';
    reward.textContent = `Reward: ${quest.reward?.description || 'Premium payment'}`;

    details.append(questIdRow, requirementsHeading, requirementsList, reward);
    wrapper.append(introRow, details);
    return wrapper;
}

function showQuestUnlockDialog(quest) {
    return showDialog({
        title: `New Request: ${quest.name}`,
        category: 'quest',
        body: createQuestUnlockBody(quest),
        dialogClassName: 'quest-popup-window',
        closeValue: 'review-request',
        buttons: [
            {
                label: 'Review Request',
                value: 'review-request',
                autofocus: true,
            },
            {
                label: 'Cancel Contract',
                value: 'cancel-contract',
            },
        ],
    });
}

let questEffectsInitialized = false;

function syncNetworkIconVisibility() {
    const icon = document.getElementById('desktop-icon-network');
    if (!icon) {
        return;
    }

    const world = getWorldState();
    const isUnlocked = Boolean(world.netSpaceUnlocked);
    const isTutorialShown = Boolean(world.tutorialFlags?.netSpaceTutorialShown);

    icon.classList.toggle('desktop-icon--hidden', !isUnlocked);
    setNetworkIconGlow(isUnlocked && !isTutorialShown);
}

export function initializeQuestEffects() {
    if (questEffectsInitialized) {
        return;
    }

    configureQuestHandlerAdapters({
        getStoreValues,
        showConfirmation,
        showDialog,
        showQuestUnlockDialog,
        showNotification,
        updateResourceBar,
        updateClicksDisplay,
        playCoinGainBurst,
        setNetworkIconGlow,
        syncNetworkIconVisibility,
        emitQuestUpdate: () => {
            document.dispatchEvent(new CustomEvent(QUESTS_UPDATED_EVENT));
        },
    });

    questEffectsInitialized = true;
}

export {
    configureQuestHandlerAdapters,
    QUESTS_UPDATED_EVENT,
    getQuestPanelData,
    deliverQuest,
    confirmQuestCancellation,
    showQuestUnlockDialog,
};
