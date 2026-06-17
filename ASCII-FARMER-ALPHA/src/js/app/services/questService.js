import {
    QUESTS_UPDATED_EVENT,
    getQuestPanelData,
    deliverQuest,
    confirmQuestCancellation,
} from '../../handlers/questHandlers.js';

function getQuestPanelViewData() {
    return getQuestPanelData();
}

function deliverQuestContract(questId) {
    return deliverQuest(questId);
}

function requestQuestCancellation(questId) {
    return confirmQuestCancellation(questId);
}

export {
    QUESTS_UPDATED_EVENT,
    getQuestPanelViewData,
    deliverQuestContract,
    requestQuestCancellation,
};
