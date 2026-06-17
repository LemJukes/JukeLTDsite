import {
    getQuestPanelViewData,
    deliverQuestContract,
    requestQuestCancellation,
    QUESTS_UPDATED_EVENT,
} from "../app/services/questService.js";
import { RESOURCES_UPDATED_EVENT } from "./resource.js";
import { closeDesktopWindow } from "./desktopWindowManager.js";
import { showDesktopIconHint } from './tutorials.js';
import { registerRenderListener } from '../engine/gameClock.js';

const QUESTS_TITLE_ID = 'quests-container-title';
const QUESTS_CONTAINER_ID = 'quests';
const QUEST_TIMER_REFRESH_MS = 1000;

let currentQuestIndex = 0;
let questsListenerAttached = false;
let questTimerRenderUnsubscribe = null;
let questTimerAccumulatorMs = 0;
let isQuestPointerActive = false;
let hasPendingQuestRefresh = false;
let questRefreshQueued = false;

function isCurrentlyDark() {
    if (document.body.classList.contains('dark')) return true;
    if (document.body.classList.contains('light')) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function createCell(text, className = '') {
    const cell = document.createElement('td');
    if (className) {
        cell.className = className;
    }

    cell.textContent = text;
    return cell;
}

function setQuestWindowVisibility(isVisible) {
    const questWindow = document.getElementById('mac-window-quests');
    const questIcon = document.getElementById('desktop-icon-quests');

    if (questIcon) {
        questIcon.classList.toggle('desktop-icon--hidden', !isVisible);
        if (isVisible) {
            void showDesktopIconHint({
                iconId: 'desktop-icon-quests',
                title: 'Quests Available',
                message: 'This icon opens the Quests window. Use it to track contracts, rewards, and timed deliveries.',
                flagName: 'questsIconHintShown',
                category: 'quest',
            });
        }
    }

    if (!isVisible && questWindow) {
        closeDesktopWindow('mac-window-quests');
    }
}

function stopQuestTimerRefresh() {
    if (questTimerRenderUnsubscribe) {
        questTimerRenderUnsubscribe();
        questTimerRenderUnsubscribe = null;
    }

    questTimerAccumulatorMs = 0;
}

function ensureQuestTimerRefresh() {
    if (questTimerRenderUnsubscribe) {
        return;
    }

    questTimerAccumulatorMs = 0;
    questTimerRenderUnsubscribe = registerRenderListener(({ frameDeltaMs }) => {
        questTimerAccumulatorMs += Math.max(0, Number(frameDeltaMs) || 0);
        if (questTimerAccumulatorMs < QUEST_TIMER_REFRESH_MS) {
            return;
        }

        questTimerAccumulatorMs = 0;
        requestQuestRefresh();
    });
}

function syncQuestTimerRefresh(panelData) {
    const hasTimedActiveQuest = panelData.activeQuests.some((quest) => quest.isTimedQuest);

    if (hasTimedActiveQuest) {
        ensureQuestTimerRefresh();
        return;
    }

    stopQuestTimerRefresh();
}

function renderQuestPager(pagerHost, totalQuests) {
    if (totalQuests < 2) {
        pagerHost.replaceChildren();
        return;
    }

    const prevButton = document.createElement('button');
    prevButton.className = 'mac-button quest-pager-button';
    prevButton.type = 'button';
    prevButton.textContent = '←';
    prevButton.setAttribute('aria-label', 'Show previous quest');
    prevButton.disabled = currentQuestIndex === 0;
    prevButton.addEventListener('click', () => {
        currentQuestIndex = Math.max(0, currentQuestIndex - 1);
        requestQuestRefresh();
    });

    const pageLabel = document.createElement('span');
    pageLabel.className = 'quest-page-label';
    pageLabel.textContent = `Request ${currentQuestIndex + 1} of ${totalQuests}`;

    const nextButton = document.createElement('button');
    nextButton.className = 'mac-button quest-pager-button';
    nextButton.type = 'button';
    nextButton.textContent = '→';
    nextButton.setAttribute('aria-label', 'Show next quest');
    nextButton.disabled = currentQuestIndex >= totalQuests - 1;
    nextButton.addEventListener('click', () => {
        currentQuestIndex = Math.min(totalQuests - 1, currentQuestIndex + 1);
        requestQuestRefresh();
    });

    pagerHost.replaceChildren(prevButton, pageLabel, nextButton);
}

function renderQuestTable(requirementRows) {
    const table = document.createElement('table');
    table.className = 'quest-requirements-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.append(
        createCell('Crop', 'quest-table-heading'),
        createCell('Current', 'quest-table-heading'),
        createCell('✓', 'quest-table-heading quest-table-ready-col'),
        createCell('Required', 'quest-table-heading'),
    );
    thead.appendChild(headRow);

    const tbody = document.createElement('tbody');
    requirementRows.forEach((row) => {
        const tableRow = document.createElement('tr');
        tableRow.className = row.isReady ? 'quest-row quest-row--ready' : 'quest-row';
        const indicator = createCell(row.isReady ? '✓' : '–', 'quest-table-ready-col');
        if (row.isReady) {
            indicator.classList.add('quest-ready-indicator');
        }
        tableRow.append(
            createCell(row.label),
            createCell(String(row.currentAmount)),
            indicator,
            createCell(String(row.requiredAmount)),
        );
        tbody.appendChild(tableRow);
    });

    table.append(thead, tbody);
    return table;
}

function renderQuestCard(container, questData, totalQuests) {
    const card = document.createElement('section');
    card.className = 'quest-card';

    const pager = document.createElement('div');
    pager.className = 'quest-pager';
    renderQuestPager(pager, totalQuests);

    const header = document.createElement('div');
    header.className = 'quest-card-header';

    const heading = document.createElement('h3');
    heading.className = 'quest-card-title';
    heading.textContent = questData.name;

    const questNumber = document.createElement('p');
    questNumber.className = 'quest-card-number';
    questNumber.textContent = `Quest #${questData.questNumber}`;

    header.append(heading, questNumber);

    const spriteSrc = isCurrentlyDark()
        ? './src/assets/farmr/farmr-sprite-DarkMode.gif'
        : './src/assets/farmr/farmr-sprite.gif';

    const sprite = document.createElement('img');
    sprite.className = 'quest-farmr-sprite';
    sprite.src = spriteSrc;
    sprite.alt = 'farmr the digital farmer';

    const issuer = document.createElement('p');
    issuer.className = 'quest-card-issuer';
    issuer.textContent = `Issuer: ${questData.issuer}`;

    const flavor = document.createElement('p');
    flavor.className = 'quest-card-flavor';
    flavor.textContent = questData.flavorText;

    const cardIntroText = document.createElement('div');
    cardIntroText.className = 'quest-card-intro-text';
    cardIntroText.append(issuer, flavor);

    const cardIntro = document.createElement('div');
    cardIntro.className = 'quest-card-intro';
    cardIntro.append(sprite, cardIntroText);

    const meta = document.createElement('div');
    meta.className = 'quest-card-meta';

    const rewardRow = document.createElement('p');
    rewardRow.className = 'quest-meta-row';
    rewardRow.textContent = `Reward: ${questData.rewardSummary}`;
    meta.appendChild(rewardRow);

    if (questData.isTimedQuest) {
        const timerRow = document.createElement('p');
        timerRow.className = 'quest-meta-row';
        timerRow.textContent = questData.isLateDelivery
            ? 'Countdown: Delivery window expired'
            : `Countdown: ${questData.timeRemainingLabel} remaining`;
        meta.appendChild(timerRow);

        const penaltyRow = document.createElement('p');
        penaltyRow.className = 'quest-meta-row';
        penaltyRow.textContent = `Late fee: ${questData.lateFeeRangeLabel} off payout (quest still completes)`;
        meta.appendChild(penaltyRow);
    }

    if (questData.isBlockedQuest && questData.unlockTargetSummary) {
        const pausedRow = document.createElement('p');
        pausedRow.className = 'quest-meta-row';
        pausedRow.textContent = `Progression paused target: ${questData.unlockTargetSummary}`;
        meta.appendChild(pausedRow);
    }

    const requirementsHeading = document.createElement('p');
    requirementsHeading.className = 'quest-section-heading';
    requirementsHeading.textContent = 'Delivery Requirements';

    const requirementsTable = renderQuestTable(questData.requirementRows);

    const actions = document.createElement('div');
    actions.className = 'quest-card-actions';

    if (questData.autoComplete) {
        const progressStatus = document.createElement('p');
        progressStatus.className = 'quest-delivery-status';
        progressStatus.textContent = questData.requirementRows[0]?.isReady
            ? 'All conditions met — auto-completing...'
            : 'Complete automated harvests to satisfy the bureau.';
        actions.append(progressStatus);
    } else {
        const status = document.createElement('p');
        status.className = 'quest-delivery-status';
        if (questData.canDeliver) {
            status.textContent = questData.isTimedQuest && questData.isLateDelivery
                ? 'Harvest is ready, but this delivery is late and will incur a payout fee.'
                : 'Harvest is ready for pickup.';
        } else if (questData.isTimedQuest && questData.isLateDelivery) {
            status.textContent = 'Timer expired. Keep growing and deliver when ready; a payout fee will apply.';
        } else if (questData.isTimedQuest) {
            status.textContent = `Keep growing. Time remaining in this window: ${questData.timeRemainingLabel}.`;
        } else {
            status.textContent = 'Keep growing until every line item is ready.';
        }

        const deliverButton = document.createElement('button');
        deliverButton.className = 'mac-button quest-deliver-button';
        deliverButton.type = 'button';
        deliverButton.textContent = 'Deliver';
        deliverButton.disabled = !questData.canDeliver;
        deliverButton.addEventListener('click', () => {
            deliverQuestContract(questData.id);
        });

        const declineButton = document.createElement('button');
        declineButton.className = 'mac-button quest-decline-button';
        declineButton.type = 'button';
        declineButton.textContent = 'Cancel Contract';
        declineButton.disabled = !questData.canDecline;
        declineButton.addEventListener('click', () => {
            void requestQuestCancellation(questData.id);
        });

        actions.append(status, deliverButton, declineButton);
    }
    card.append(pager, header, cardIntro, meta, requirementsHeading, requirementsTable, actions);
    container.replaceChildren(card);
}

function renderEmptyQuestState(container, panelData) {
    const emptyState = document.createElement('section');
    emptyState.className = 'quest-empty-state';

    const heading = document.createElement('h3');
    heading.className = 'quest-card-title';
    heading.textContent = 'No active requests';

    const body = document.createElement('p');
    body.className = 'quest-card-flavor';

    if (panelData.progressionPaused && panelData.blockedQuestName) {
        body.textContent = `${panelData.blockedQuestName} contract canceled. Future requests are currently paused.`;
    } else {
        body.textContent = panelData.completedCount > 0
            ? 'farmr has cleared the current request queue. Watch for the next produce message.'
            : 'farmr will post produce requests here once the networks start asking for harvests.';
    }

    emptyState.append(heading, body);

    container.replaceChildren(emptyState);
}

function initializeQuestsTitle() {
    if (document.getElementById(QUESTS_TITLE_ID)) {
        return;
    }

    const questsTitle = document.createElement('section');
    questsTitle.classList.add('container-title');
    questsTitle.id = QUESTS_TITLE_ID;
    questsTitle.setAttribute('aria-label', 'Quests Section Title');
    questsTitle.textContent = 'Quests';

    const mainDiv = document.querySelector('main');
    if (mainDiv) {
        mainDiv.appendChild(questsTitle);
    }
}

function initializeQuests() {
    if (document.getElementById(QUESTS_CONTAINER_ID)) {
        return;
    }

    const quests = document.createElement('section');
    quests.className = 'quests-container';
    quests.id = QUESTS_CONTAINER_ID;
    quests.setAttribute('aria-label', 'Quest Requests');

    const mainDiv = document.querySelector('main');
    if (mainDiv) {
        mainDiv.appendChild(quests);
    }

    quests.addEventListener('pointerdown', () => {
        isQuestPointerActive = true;
    });

    document.addEventListener('pointerup', () => {
        if (!isQuestPointerActive) {
            return;
        }

        isQuestPointerActive = false;
        if (hasPendingQuestRefresh) {
            hasPendingQuestRefresh = false;
            requestQuestRefresh();
        }
    });

    document.addEventListener('pointercancel', () => {
        isQuestPointerActive = false;
    });

    if (!questsListenerAttached) {
        document.addEventListener(QUESTS_UPDATED_EVENT, requestQuestRefresh);
        document.addEventListener(RESOURCES_UPDATED_EVENT, requestQuestRefresh);
        questsListenerAttached = true;
    }

    requestQuestRefresh();
}

function requestQuestRefresh() {
    if (questRefreshQueued) {
        return;
    }

    questRefreshQueued = true;
    window.requestAnimationFrame(() => {
        questRefreshQueued = false;
        refreshQuestWindow();
    });
}

function refreshQuestWindow() {
    if (isQuestPointerActive) {
        hasPendingQuestRefresh = true;
        return;
    }

    const questsContainer = document.getElementById(QUESTS_CONTAINER_ID);
    if (!questsContainer) {
        return;
    }

    const panelData = getQuestPanelViewData();
    const totalActiveQuests = panelData.activeQuests.length;
    syncQuestTimerRefresh(panelData);

    setQuestWindowVisibility(panelData.unlockedCount > 0 || panelData.progressionPaused);

    if (panelData.unlockedCount < 1 && !panelData.progressionPaused) {
        questsContainer.replaceChildren();
        return;
    }

    if (totalActiveQuests < 1) {
        currentQuestIndex = 0;
        renderEmptyQuestState(questsContainer, panelData);
        return;
    }

    currentQuestIndex = Math.min(currentQuestIndex, totalActiveQuests - 1);
    renderQuestCard(questsContainer, panelData.activeQuests[currentQuestIndex], totalActiveQuests);
}

export { initializeQuestsTitle, initializeQuests, refreshQuestWindow };