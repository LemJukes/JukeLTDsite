import { initializeResourceBarTitle, initializeResourceBar } from '../../ui/resource.js';
import {
    clearSnapshot,
    initializePersistence,
    loadSnapshot,
    exportSaveToString,
    importSaveFromString,
} from '../../persistence.js';
import { wrapSectionsInMacWindows } from '../../ui/macWindow.js';
import {
    initializeWorldState,
    reconcileAllFieldsProgress,
    getWorldState,
    getNodeState,
    dispatchWorldAction,
    flushPendingStatePersist,
} from '../../worldState.js';
import { initializeSceneManager, mountScene, registerSceneChangeListener, getSceneComponent, getCurrentScene } from '../../sceneManager.js';
import {
    initializeField,
    initializeFieldTitle,
    updateField,
    refreshFieldTitlebarControl,
    startFieldRenderSync,
    runFieldSimulationStep,
} from '../../ui/field.js';
import { initializeStore, initializeStoreTitle } from '../../ui/store.js';
import { initializeStoreEffects } from '../storeEffects.js';
import { initializeQuestEffects } from '../questEffects.js';
import { initializeUpgradeEffects } from '../upgradeEffects.js';
import { initializeAchievementEffects } from '../achievementEffects.js';
import { initializePlotEffects } from '../plotEffects.js';
import { initializeWaterAutoBuyerEffects } from '../waterAutoBuyerEffects.js';
import { initializeToolbox, initializeToolboxTitle, selectTool, selectSeedType } from '../../ui/toolbox.js';
import { initializeClicksDisplay } from '../../ui/clicks.js';
import { initializeAchievementsDisplay } from '../../ui/achievements.js';
import { initializeQuests, initializeQuestsTitle, refreshQuestWindow } from '../../ui/quests.js';
import { showConfirmation, showNotification, showDialog } from '../../ui/macNotifications.js';
import { showWelcomeMessage, showReplayTutorial, runNetSpaceTutorial, setNetworkIconGlow } from '../../ui/tutorials.js';
import { trackAchievements } from '../../handlers/achievementHandlers.js';
import { getBoundActionForKey } from '../../ui/keybinds.js';
import { bindKeysToScene, dispatchKeyEvent, zoomIn, zoomOut } from '../../ui/sceneAwareKeybinds.js';
import { initializeCameraController, panCamera, ARROW_PAN_STEP } from '../../netspace/cameraController.js';
import { initializeNetspaceCanvas, setNodeEnterCallback, startRenderer, stopRenderer, getSelectedNodeId } from '../../netspace/netspaceRenderer.js';
import { initializeNodeOverview, mountNodeOverview, unmountNodeOverview } from '../../netspace/nodeOverviewUI.js';
import { registerFarmrApi, transitionTo } from '../../ui/sceneTransitions.js';
import { initializeWaterAutoBuyerEngine, runWaterAutoBuyerSimulationStep } from '../../handlers/waterAutoBuyerHandlers.js';
import { initializeDevSmokeTestApi } from '../../dev/smokeTest.js';
import { initializeDevPanel } from '../../dev/devPanel.js';
import {
    initializeDesktopWindowManager,
    registerDesktopWindow,
    showDesktopShell,
    setSelectedIcon,
} from '../../ui/desktopWindowManager.js';
import { initializeAmbientFarmr } from '../../ui/ambientFarmr.js';
import { initializeTextScale } from '../../ui/desktopTextScale.js';
import { checkMilestones } from '../../world/milestones.js';
import {
    startGameClock,
    stopGameClock,
    registerSimulationStepListener,
    getGameClockStats,
    resetGameClockStats,
} from '../../engine/gameClock.js';
import { runAutofarmerSimulationStep } from '../../netspace/autofarmers.js';

const BOOT_TITLE_DURATION_MS = 2000;
const BOOT_LOADER_DURATION_MS = 1600;
const LAST_SCENE_STORAGE_KEY = 'asciiFarmerLastScene';
const GAME_CLOCK_FIXED_STEP_MS = 100;
const OPTIONS_SECTION_COLLAPSE_KEYS = {
    stats: 'statsWindowCollapsed',
    achievements: 'achievementsWindowCollapsed',
};

let gameClockWired = false;
let gameClockSimulationBound = false;

function ensureGameClockSimulationBound() {
    if (!gameClockSimulationBound) {
        gameClockSimulationBound = true;
        registerSimulationStepListener((stepMs) => {
            runAutofarmerSimulationStep();
            runWaterAutoBuyerSimulationStep(stepMs);
            runFieldSimulationStep(stepMs);
        });
    }
}

function initializeGameClock() {
    ensureGameClockSimulationBound();

    startGameClock({ fixedStepMs: GAME_CLOCK_FIXED_STEP_MS });

    if (!gameClockWired) {
        gameClockWired = true;
        window.addEventListener('beforeunload', () => {
            stopGameClock();
        }, { once: true });
    }

    window.__asciiFarmerGameClock = {
        start: () => startGameClock({ fixedStepMs: GAME_CLOCK_FIXED_STEP_MS }),
        stop: () => stopGameClock(),
        getStats: () => getGameClockStats(),
        resetStats: () => resetGameClockStats(),
    };
}

function delay(ms) {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

async function runBootSequence() {
    const bootSequence = document.getElementById('boot-sequence');
    const bootLoader = document.getElementById('boot-loader');
    const bootLoaderFill = document.getElementById('boot-loader-fill');

    if (!bootSequence || !bootLoader || !bootLoaderFill) {
        return;
    }

    bootLoaderFill.style.width = '0%';
    await delay(BOOT_TITLE_DURATION_MS);

    bootLoader.classList.add('boot-loader--visible');

    const startTime = performance.now();
    await new Promise((resolve) => {
        let settled = false;

        function updateProgress(now) {
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / BOOT_LOADER_DURATION_MS);
            bootLoaderFill.style.width = `${Math.round(progress * 100)}%`;

            if (progress >= 1) {
                settled = true;
                resolve();
                return true;
            }

            return false;
        }

        function step(now) {
            if (settled) {
                return;
            }

            if (updateProgress(now)) {
                return;
            }

            window.requestAnimationFrame(step);
        }

        const fallbackIntervalId = window.setInterval(() => {
            if (settled) {
                window.clearInterval(fallbackIntervalId);
                return;
            }

            if (updateProgress(performance.now())) {
                window.clearInterval(fallbackIntervalId);
            }
        }, 50);

        window.requestAnimationFrame(step);
    });

    bootSequence.classList.add('boot-sequence--hidden');
    await delay(350);
}

function shouldUseNetspaceBootTheme(hasSnapshot) {
    if (!hasSnapshot) {
        return false;
    }

    const lastScene = localStorage.getItem(LAST_SCENE_STORAGE_KEY);
    return lastScene === 'worldMap' || lastScene === 'nodeOverview';
}

function applyBootSequenceTheme(useNetspaceTheme) {
    const bootSequence = document.getElementById('boot-sequence');
    if (!bootSequence) {
        return;
    }

    bootSequence.classList.toggle('boot-sequence--netspace', Boolean(useNetspaceTheme));
}

function registerDesktopWindows() {
    registerDesktopWindow('mac-window-resource-bar', { x: 28, y: 48, open: false, iconId: 'desktop-icon-resources' });
    registerDesktopWindow('mac-window-toolbox-container', { x: 124, y: 60, open: false, iconId: 'desktop-icon-tools' });
    registerDesktopWindow('mac-window-field', { x: 64, y: 88, open: false, iconId: 'desktop-icon-field', resizable: true });
    registerDesktopWindow('mac-window-store', { x: 188, y: 94, open: false, iconId: 'desktop-icon-store' });
    registerDesktopWindow('mac-window-upgrades-container', { x: 210, y: 62, open: false, iconId: 'desktop-icon-upgrades' });
    registerDesktopWindow('mac-window-quests', { x: 176, y: 128, open: false, iconId: 'desktop-icon-quests' });
    registerDesktopWindow('mac-window-options', { x: 38, y: 36, open: false });
    registerDesktopWindow('mac-window-textscale', { x: 84, y: 124, open: false });
}

function applyOptionsSubsectionState(sectionEl, toggleButton, isCollapsed) {
    if (!sectionEl || !toggleButton) {
        return;
    }

    sectionEl.classList.toggle('options-subsection--collapsed', isCollapsed);
    toggleButton.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');

    const indicator = toggleButton.querySelector('.options-subsection-indicator');
    if (indicator) {
        indicator.textContent = isCollapsed ? '+' : '\u2212';
    }
}

function initializeOptionsSubsectionToggles() {
    const sections = [
        {
            sectionId: 'options-stats-section',
            buttonId: 'options-stats-toggle',
            storageKey: OPTIONS_SECTION_COLLAPSE_KEYS.stats,
        },
        {
            sectionId: 'options-achievements-section',
            buttonId: 'options-achievements-toggle',
            storageKey: OPTIONS_SECTION_COLLAPSE_KEYS.achievements,
        },
    ];

    sections.forEach(({ sectionId, buttonId, storageKey }) => {
        const sectionEl = document.getElementById(sectionId);
        const toggleButton = document.getElementById(buttonId);
        if (!sectionEl || !toggleButton) {
            return;
        }

        const isInitiallyCollapsed = localStorage.getItem(storageKey) === 'true';
        applyOptionsSubsectionState(sectionEl, toggleButton, isInitiallyCollapsed);

        toggleButton.addEventListener('click', () => {
            const nextCollapsed = !sectionEl.classList.contains('options-subsection--collapsed');
            applyOptionsSubsectionState(sectionEl, toggleButton, nextCollapsed);
            localStorage.setItem(storageKey, nextCollapsed ? 'true' : 'false');
        });
    });
}

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

function initializeNetworkIconButton() {
    const icon = document.getElementById('desktop-icon-network');
    if (!icon) {
        return;
    }

    icon.addEventListener('click', () => {
        setSelectedIcon(icon.id);
    });

    icon.addEventListener('dblclick', () => {
        transitionTo('worldMap');
    });
}

function initializeResetSaveButton() {
    const resetSaveButton = document.getElementById('reset-save-button');
    if (!resetSaveButton) {
        return;
    }

    resetSaveButton.textContent = '↺';
    resetSaveButton.setAttribute('aria-label', 'Reset Save Data');

    resetSaveButton.addEventListener('click', () => {
        showConfirmation('Delete save data and reload the page?', {
            title: 'Reset Save',
            onConfirm: () => {
                window.__asciiFarmerSkipUnloadSave = true;
                clearSnapshot();
                window.location.reload();
            },
        });
    });
}

function initializeReplayTutorialButton() {
    const replayBtn = document.getElementById('replay-tutorial-button');
    if (!replayBtn) {
        return;
    }

    replayBtn.addEventListener('click', () => {
        showReplayTutorial();
    });
}

function initializeSaveExportButton() {
    const exportBtn = document.getElementById('export-save-button');
    if (!exportBtn) {
        return;
    }

    exportBtn.addEventListener('click', () => {
        const encoded = exportSaveToString();

        if (!encoded) {
            showNotification('No save data found to export.', 'Export Save', 'error');
            return;
        }

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(encoded).then(() => {
                showNotification('Save code copied to clipboard! Paste it somewhere safe to keep a backup.', 'Export Save', 'success');
            }).catch(() => {
                showExportFallbackDialog(encoded);
            });
        } else {
            showExportFallbackDialog(encoded);
        }
    });
}

function showExportFallbackDialog(encoded) {
    const wrap = document.createElement('div');
    wrap.className = 'save-import-wrap';

    const label = document.createElement('p');
    label.className = 'save-import-label';
    label.textContent = 'Copy the save code below and store it somewhere safe:';

    const textarea = document.createElement('textarea');
    textarea.className = 'save-import-textarea';
    textarea.readOnly = true;
    textarea.value = encoded;
    textarea.addEventListener('focus', () => textarea.select());

    wrap.append(label, textarea);

    showDialog({
        title: 'Export Save',
        category: 'success',
        body: wrap,
    });
}

function initializeSaveImportButton() {
    const importBtn = document.getElementById('import-save-button');
    if (!importBtn) {
        return;
    }

    importBtn.addEventListener('click', () => {
        const wrap = document.createElement('div');
        wrap.className = 'save-import-wrap';

        const label = document.createElement('p');
        label.className = 'save-import-label';
        label.textContent = 'Paste your save code below. This will overwrite your current save.';

        const textarea = document.createElement('textarea');
        textarea.className = 'save-import-textarea';
        textarea.placeholder = 'Paste save code here...';

        wrap.append(label, textarea);

        showDialog({
            title: 'Import Save',
            category: 'warning',
            body: wrap,
            buttons: [
                { label: 'Cancel', value: false },
                { label: 'Import', value: true, autofocus: false },
            ],
            closeValue: false,
        }).then((confirmed) => {
            if (!confirmed) {
                return;
            }

            const success = importSaveFromString(textarea.value);

            if (!success) {
                showNotification('Invalid save code. Please check and try again.', 'Import Save', 'error');
                return;
            }

            showNotification('Save imported successfully! Reloading...', 'Import Save', 'success');
            window.setTimeout(() => window.location.reload(), 1200);
        });
    });
}

function isEditableElement(element) {
    if (!element) {
        return false;
    }

    const tagName = element.tagName;
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || element.isContentEditable;
}

function hasBlockingShortcutOverlay() {
    return Boolean(document.querySelector(
        '.keybinds-overlay--visible, .mac-notification-overlay--visible',
    ));
}

const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

function isPopulatedOwnedNode(nodeId) {
    if (typeof nodeId !== 'string' || nodeId.length < 1) {
        return false;
    }

    const world = getWorldState();
    const isOwned = Array.isArray(world.ownedNodeIds) && world.ownedNodeIds.includes(nodeId);
    return isOwned && Boolean(getNodeState(nodeId));
}

function tryEnterSelectedNodeOverview() {
    const selectedNodeId = getSelectedNodeId();
    if (!isPopulatedOwnedNode(selectedNodeId)) {
        showNotification('Select an active populated node first.', 'Net-Space', 'warning');
        return;
    }

    transitionTo('nodeOverview', selectedNodeId);
}

function initializeSceneBindings() {
    const desktopHandlers = {};
    ARROW_KEYS.forEach((key) => { desktopHandlers[key] = () => {}; });
    bindKeysToScene('desktop', desktopHandlers);

    const nodeOverviewHandlers = {};
    ARROW_KEYS.forEach((key) => { nodeOverviewHandlers[key] = (e) => { e.preventDefault(); }; });
    bindKeysToScene('nodeOverview', nodeOverviewHandlers);

    const worldMapHandlers = {
        ArrowLeft: (e) => { e.preventDefault(); panCamera(-ARROW_PAN_STEP, 0); },
        ArrowRight: (e) => { e.preventDefault(); panCamera(ARROW_PAN_STEP, 0); },
        ArrowUp: (e) => { e.preventDefault(); panCamera(0, -ARROW_PAN_STEP); },
        ArrowDown: (e) => { e.preventDefault(); panCamera(0, ARROW_PAN_STEP); },
    };
    bindKeysToScene('worldMap', worldMapHandlers);
}

function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
        if (event.defaultPrevented || event.isComposing || event.repeat) {
            return;
        }

        if (event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }

        if (isEditableElement(document.activeElement) || hasBlockingShortcutOverlay()) {
            return;
        }

        if (ARROW_KEYS.has(event.key)) {
            dispatchKeyEvent(event);
            return;
        }

        if (event.key === 'PageUp') {
            event.preventDefault();
            zoomOut();
            return;
        }

        if (event.key === 'PageDown') {
            event.preventDefault();

            if (getCurrentScene().name === 'worldMap') {
                tryEnterSelectedNodeOverview();
                return;
            }

            zoomIn();
            return;
        }

        const boundAction = getBoundActionForKey(event.key);
        if (!boundAction) {
            return;
        }

        if (boundAction.type === 'tool') {
            event.preventDefault();
            selectTool(boundAction.value);
            return;
        }

        if (boundAction.type === 'seed') {
            event.preventDefault();
            selectSeedType(boundAction.value);
            return;
        }

        if (boundAction.type !== 'plot') {
            return;
        }

        const plotButtons = document.querySelectorAll('.plotButton');
        const plotIndex = boundAction.value;
        const targetPlotButton = plotButtons[plotIndex];

        if (!targetPlotButton || targetPlotButton.disabled) {
            return;
        }

        event.preventDefault();
        targetPlotButton.click();
    });
}

function initializeStatePhase(snapshot) {
    initializeWorldState(snapshot);
    reconcileAllFieldsProgress();
    applyBootSequenceTheme(shouldUseNetspaceBootTheme(Boolean(snapshot)));
}

function initializeUiPhase() {
    initializeResourceBarTitle();
    initializeResourceBar();
    initializeToolboxTitle();
    initializeToolbox();
    initializeFieldTitle();
    initializeField();
    updateField();
    initializeQuestsTitle();
    initializeQuests();
    initializeStoreTitle();
    initializeStore();
    initializeStoreEffects();
    initializeQuestEffects();
    initializeUpgradeEffects();
    initializeAchievementEffects();
    initializePlotEffects();
    initializeWaterAutoBuyerEffects();
    initializeResetSaveButton();
    initializeReplayTutorialButton();
    initializeSaveExportButton();
    initializeSaveImportButton();
    initializeOptionsSubsectionToggles();
    initializeClicksDisplay();
    initializeAchievementsDisplay();
    initializeSceneBindings();
    initializeKeyboardShortcuts();
    trackAchievements();
    initializeWaterAutoBuyerEngine();
    wrapSectionsInMacWindows();
    refreshFieldTitlebarControl();
    refreshQuestWindow();
}

function initializeScenePhase() {
    initializeDesktopWindowManager();
    registerDesktopWindows();
    initializeNetworkIconButton();
    syncNetworkIconVisibility();
    initializeSceneManager();
    initializeNetspaceCanvas(getSceneComponent('worldMap'));
    initializeCameraController();
    setNodeEnterCallback((nodeId) => {
        if (!isPopulatedOwnedNode(nodeId)) {
            showNotification('Only active populated nodes can be opened.', 'Net-Space', 'warning');
            return;
        }

        transitionTo('nodeOverview', nodeId);
    });
    initializeNodeOverview();
    registerSceneChangeListener((newScene, nodeId, prevScene) => {
        localStorage.setItem(LAST_SCENE_STORAGE_KEY, newScene);

        if (newScene === 'desktop' && isPopulatedOwnedNode(nodeId)) {
            const world = getWorldState();
            if (world.activeNodeId !== nodeId) {
                dispatchWorldAction({
                    type: 'world.patch',
                    payload: {
                        updates: {
                            activeNodeId: nodeId,
                        },
                    },
                    meta: { source: 'main.sceneChange.desktopActiveNodeSync' },
                });
            }
        }

        if (newScene === 'worldMap' || newScene === 'nodeOverview') {
            const world = getWorldState();
            if (world.worldStats.netSpaceFirstAccessAt === null) {
                dispatchWorldAction({
                    type: 'world.patch',
                    payload: {
                        updates: {
                            worldStats: {
                                ...world.worldStats,
                                netSpaceFirstAccessAt: Date.now(),
                            },
                        },
                    },
                    meta: { source: 'main.sceneChange.netSpaceFirstAccess' },
                });
                checkMilestones();
            }
        }

        if (newScene === 'nodeOverview') {
            mountNodeOverview(nodeId);
        } else if (prevScene === 'nodeOverview') {
            unmountNodeOverview();
        }

        if (newScene === 'worldMap') {
            startRenderer();
            void runNetSpaceTutorial();
        } else if (prevScene === 'worldMap') {
            stopRenderer();
        }
    });

    initializeTextScale();
}

async function finalizeBootPhase(snapshot) {
    ensureGameClockSimulationBound();
    await runBootSequence();
    mountScene('desktop', getWorldState().activeNodeId);
    showDesktopShell();

    const ambientApi = initializeAmbientFarmr();
    if (ambientApi) {
        registerFarmrApi(ambientApi);
    }

    if (!snapshot) {
        await showWelcomeMessage();
    }

    initializeGameClock();
    startFieldRenderSync();
}

export async function runAppBootstrap() {
    initializeDevSmokeTestApi();
    initializeDevPanel();

    void initializePersistence();
    const snapshot = loadSnapshot();

    initializeStatePhase(snapshot);
    initializeUiPhase();
    initializeScenePhase();
    await finalizeBootPhase(snapshot);
}
