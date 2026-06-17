// ./ui/field.js
import { getActiveNodeState as getState, updateActiveNodeState as updateState, reconcileAllFieldsProgress } from "../worldState.js";
import {
    performPlotClick,
    getFieldAverageFallowDurationMs,
    syncFieldPlotButtonPresentation,
} from '../app/services/fieldService.js';
import { checkMilestones } from '../world/milestones.js';
import { getCurrentScene } from '../sceneManager.js';
import { isDesktopWindowOpen } from './desktopWindowManager.js';
import { updateResourceBar } from './resource.js';
import { registerRenderListener } from '../engine/gameClock.js';
import { buildFieldRenderViewModel } from '../app/fieldViewModel.js';
import {
    FIELD_CENTER_INDEX,
    FIELD_GRID_CAPACITY,
    FIELD_GRID_WIDTH,
} from '../configs/fieldGridConfig.js';

const FIELD_SUBTITLE_ID = 'field-subtitlebar';
const FIELD_SUBTITLE_PLOTS_ID = 'field-subtitle-plots';
const FIELD_SUBTITLE_SELECTOR_ID = 'field-subtitle-selector';
const FIELD_SUBTITLE_FALLOW_ID = 'field-subtitle-fallow';
const FIELD_RENDER_SYNC_INTERVAL_MS = 200;
const FIELD_SIMULATION_SYNC_INTERVAL_MS = 200;
const FIELD_VIEWPORT_MIN_SIZE = 5;
const FIELD_DEFAULT_CELL_SIZE_PX = 56;
const FIELD_MIN_CELL_SIZE_FLOOR_PX = 28;
const FIELD_MIN_CELL_MEASURE_SAMPLE = '⊠';
const FIELD_RESIZE_HANDLE_PROXIMITY_PX = 64;

let fieldTimerRenderUnsubscribe = null;
let fieldRenderAccumulatorMs = 0;
let fieldSimulationAccumulatorMs = 0;
let fieldWindowResizeObserver = null;
let fieldWindowLayoutListenerBound = false;
let fieldWindowPointerTrackingBound = false;
let cachedMinCellFontSignature = '';
let cachedMinCellSizePx = FIELD_MIN_CELL_SIZE_FLOOR_PX;

function getActiveFieldFromSnapshot(gameState) {
    if (!gameState?.fields || !gameState?.activeFieldId) {
        return null;
    }

    return gameState.fields[gameState.activeFieldId] || null;
}

function ensureActiveFieldPlotStates(gameState) {
    const activeField = getActiveFieldFromSnapshot(gameState);
    if (!activeField) {
        return null;
    }

    const currentPlotStates = Array.isArray(activeField.plotStates) ? activeField.plotStates : [];
    const requestedOwnedCount = Math.max(1, Math.min(FIELD_GRID_CAPACITY, Number(activeField.plots) || 1));
    const normalizedPlotStates = Array.from({ length: FIELD_GRID_CAPACITY }, (_, index) => {
        const existing = currentPlotStates[index];
        const shouldOwnByCount = requestedOwnedCount === 1
            ? index === FIELD_CENTER_INDEX
            : index < requestedOwnedCount;

        if (!existing || typeof existing !== 'object') {
            return {
                owned: shouldOwnByCount,
                symbol: '~',
                cropType: null,
                waterCount: 0,
                disabledUntil: 0,
                lastCompletedCropType: null,
                fallowPenaltySteps: 0,
                lastFallowDurationMs: 0,
                lastUpdatedAt: Date.now(),
                destroyed: false,
            };
        }

        const hasExplicitOwnership = typeof existing.owned === 'boolean';
        const isOwned = hasExplicitOwnership ? existing.owned : shouldOwnByCount;
        if (!isOwned) {
            return {
                owned: false,
                symbol: '~',
                cropType: null,
                waterCount: 0,
                disabledUntil: 0,
                lastCompletedCropType: null,
                fallowPenaltySteps: 0,
                lastFallowDurationMs: 0,
                lastUpdatedAt: Number(existing.lastUpdatedAt) || Date.now(),
                destroyed: false,
            };
        }

        return {
            ...existing,
            owned: true,
            lastUpdatedAt: Number(existing.lastUpdatedAt) || Date.now(),
        };
    });

    let plots = normalizedPlotStates.reduce((count, plotState) => count + (plotState?.owned ? 1 : 0), 0);
    if (plots < 1) {
        normalizedPlotStates[FIELD_CENTER_INDEX] = {
            owned: true,
            symbol: '~',
            cropType: null,
            waterCount: 0,
            disabledUntil: 0,
            lastCompletedCropType: null,
            fallowPenaltySteps: 0,
            lastFallowDurationMs: 0,
            lastUpdatedAt: Date.now(),
            destroyed: false,
        };
        plots = 1;
    }

    if (currentPlotStates.length === FIELD_GRID_CAPACITY && Number(activeField.plots) === plots) {
        return activeField;
    }

    const updatedField = {
        ...activeField,
        plots,
        plotStates: normalizedPlotStates,
    };

    const updatedFields = {
        ...gameState.fields,
        [gameState.activeFieldId]: updatedField,
    };

    updateState({ fields: updatedFields });
    return updatedField;
}

function refreshFieldTitlebarControl() {
    const fieldWindow = document.getElementById('mac-window-field');
    if (!fieldWindow) {
        return;
    }

    ensureFieldWindowResizeObserver(fieldWindow);

    const titleContainer = fieldWindow.querySelector('.mac-title');
    if (!titleContainer) {
        return;
    }

    titleContainer.textContent = 'The Field';
    refreshFieldSubtitlebarControl(fieldWindow);
}

function formatFallowSeconds(durationMs) {
    const seconds = Math.max(0, Number(durationMs) || 0) / 1000;
    return `${seconds.toFixed(1)}s`;
}

function getOrCreateSubtitleElement(fieldWindow) {
    let subtitleBar = fieldWindow.querySelector(`#${FIELD_SUBTITLE_ID}`);
    const macContentInner = fieldWindow.querySelector('.mac-content-inner');

    if (!subtitleBar) {
        subtitleBar = document.createElement('div');
        subtitleBar.id = FIELD_SUBTITLE_ID;
        subtitleBar.classList.add('mac-subtitlebar');

        const plotsDisplay = document.createElement('span');
        plotsDisplay.id = FIELD_SUBTITLE_PLOTS_ID;
        plotsDisplay.classList.add('mac-subtitle-value', 'mac-subtitle-left');

        const selectorSlot = document.createElement('div');
        selectorSlot.id = FIELD_SUBTITLE_SELECTOR_ID;
        selectorSlot.classList.add('mac-subtitle-center');

        const fallowDisplay = document.createElement('span');
        fallowDisplay.id = FIELD_SUBTITLE_FALLOW_ID;
        fallowDisplay.classList.add('mac-subtitle-value', 'mac-subtitle-right');

        subtitleBar.appendChild(plotsDisplay);
        subtitleBar.appendChild(selectorSlot);
        subtitleBar.appendChild(fallowDisplay);
    }

    if (macContentInner) {
        const shouldMoveIntoContent = subtitleBar.parentElement !== macContentInner;
        const shouldMoveToFront = macContentInner.firstElementChild !== subtitleBar;
        if (shouldMoveIntoContent || shouldMoveToFront) {
            macContentInner.prepend(subtitleBar);
        }
        return subtitleBar;
    }

    if (!subtitleBar.parentElement) {
        const titlebar = fieldWindow.querySelector('.mac-titlebar');
        if (!titlebar || !titlebar.parentElement) {
            return null;
        }

        titlebar.insertAdjacentElement('afterend', subtitleBar);
    }

    return subtitleBar;
}

function refreshFieldSubtitlebarControl(fieldWindow) {
    const gameState = getState();
    const activeField = getActiveFieldFromSnapshot(gameState);
    if (!activeField) {
        return;
    }

    const subtitleBar = getOrCreateSubtitleElement(fieldWindow);
    if (!subtitleBar) {
        return;
    }

    const plotsDisplay = subtitleBar.querySelector(`#${FIELD_SUBTITLE_PLOTS_ID}`);
    const selectorSlot = subtitleBar.querySelector(`#${FIELD_SUBTITLE_SELECTOR_ID}`);
    const fallowDisplay = subtitleBar.querySelector(`#${FIELD_SUBTITLE_FALLOW_ID}`);
    if (!plotsDisplay || !selectorSlot || !fallowDisplay) {
        return;
    }

    plotsDisplay.textContent = `Plots: ${activeField.plots}`;
    const fallowMs = getFieldAverageFallowDurationMs(activeField, gameState);
    fallowDisplay.textContent = `Avg. Fallow: ${formatFallowSeconds(fallowMs)}`;
    fallowDisplay.title = `Average Fallow Time: ${formatFallowSeconds(fallowMs)}`;
    subtitleBar.classList.remove('mac-subtitlebar--no-center');
    selectorSlot.style.display = 'none';
    selectorSlot.textContent = '';

    refreshFieldWindowSizing();
}

function ensureFieldWindowResizeObserver(fieldWindow) {
    if (!fieldWindowLayoutListenerBound) {
        fieldWindow.addEventListener('desktopwindowlayoutchange', () => {
            refreshFieldWindowSizing();
        });
        fieldWindowLayoutListenerBound = true;
    }

    if (!fieldWindowPointerTrackingBound) {
        bindFieldResizeHandleHint(fieldWindow);
        fieldWindowPointerTrackingBound = true;
    }

    if (fieldWindowResizeObserver || typeof ResizeObserver !== 'function') {
        return;
    }

    fieldWindowResizeObserver = new ResizeObserver(() => {
        refreshFieldWindowSizing();
    });
    fieldWindowResizeObserver.observe(fieldWindow);
}

function bindFieldResizeHandleHint(fieldWindow) {
    const clearHint = () => {
        fieldWindow.classList.remove('desktop-window--resize-hint');
    };

    fieldWindow.addEventListener('pointermove', (event) => {
        const rect = fieldWindow.getBoundingClientRect();
        const distanceX = rect.right - event.clientX;
        const distanceY = rect.bottom - event.clientY;
        const isNearHandle = distanceX >= -8
            && distanceY >= -8
            && distanceX <= FIELD_RESIZE_HANDLE_PROXIMITY_PX
            && distanceY <= FIELD_RESIZE_HANDLE_PROXIMITY_PX;

        fieldWindow.classList.toggle('desktop-window--resize-hint', isNearHandle || fieldWindow.classList.contains('is-resizing'));
    });

    fieldWindow.addEventListener('pointerleave', clearHint);
    fieldWindow.addEventListener('pointercancel', clearHint);
}

function getNumericStyleValue(value) {
    return Number.parseFloat(value) || 0;
}

function getFieldSizingElements() {
    const fieldWindow = document.getElementById('mac-window-field');
    const fieldElement = document.getElementById('field');
    if (!fieldWindow || !fieldElement) {
        return null;
    }

    const contentInner = fieldWindow.querySelector('.mac-content-inner');
    const subtitleBar = fieldWindow.querySelector(`#${FIELD_SUBTITLE_ID}`);
    if (!contentInner || !subtitleBar) {
        return null;
    }

    return {
        fieldWindow,
        fieldElement,
        contentInner,
        subtitleBar,
    };
}

function getFieldLayoutMetrics(fieldElement) {
    const computedStyles = window.getComputedStyle(fieldElement);
    return {
        paddingX: getNumericStyleValue(computedStyles.paddingLeft) + getNumericStyleValue(computedStyles.paddingRight),
        paddingY: getNumericStyleValue(computedStyles.paddingTop) + getNumericStyleValue(computedStyles.paddingBottom),
        gapX: getNumericStyleValue(computedStyles.columnGap || computedStyles.gap),
        gapY: getNumericStyleValue(computedStyles.rowGap || computedStyles.gap),
        fontSignature: `${computedStyles.fontFamily}|${computedStyles.fontSize}|${computedStyles.fontWeight}`,
    };
}

function measureMinimumFieldCellSize(fieldElement) {
    const { fontSignature } = getFieldLayoutMetrics(fieldElement);
    if (cachedMinCellFontSignature === fontSignature) {
        return cachedMinCellSizePx;
    }

    const measureButton = document.createElement('button');
    measureButton.className = 'plotButton';
    measureButton.type = 'button';
    measureButton.textContent = FIELD_MIN_CELL_MEASURE_SAMPLE;
    measureButton.style.position = 'fixed';
    measureButton.style.left = '-9999px';
    measureButton.style.top = '-9999px';
    measureButton.style.width = 'auto';
    measureButton.style.height = 'auto';
    measureButton.style.visibility = 'hidden';
    measureButton.style.pointerEvents = 'none';
    measureButton.style.font = window.getComputedStyle(fieldElement).font;
    document.body.appendChild(measureButton);

    const rect = measureButton.getBoundingClientRect();
    measureButton.remove();

    cachedMinCellFontSignature = fontSignature;
    cachedMinCellSizePx = Math.max(
        FIELD_MIN_CELL_SIZE_FLOOR_PX,
        Math.ceil(Math.max(rect.width, rect.height)),
    );

    return cachedMinCellSizePx;
}

function measureFieldSubtitleMinimumWidth(fieldWindow) {
    const subtitleBar = fieldWindow.querySelector(`#${FIELD_SUBTITLE_ID}`);
    if (!subtitleBar) {
        return 0;
    }

    const plotsDisplay = subtitleBar.querySelector(`#${FIELD_SUBTITLE_PLOTS_ID}`);
    const selectorSlot = subtitleBar.querySelector(`#${FIELD_SUBTITLE_SELECTOR_ID}`);
    const fallowDisplay = subtitleBar.querySelector(`#${FIELD_SUBTITLE_FALLOW_ID}`);
    const computedStyles = window.getComputedStyle(subtitleBar);
    const paddingX = getNumericStyleValue(computedStyles.paddingLeft) + getNumericStyleValue(computedStyles.paddingRight);
    const gap = getNumericStyleValue(computedStyles.columnGap || computedStyles.gap);

    return Math.ceil(
        paddingX
        + (gap * 2)
        + measureIntrinsicElementWidth(plotsDisplay)
        + measureIntrinsicElementWidth(selectorSlot)
        + measureIntrinsicElementWidth(fallowDisplay),
    );
}

function measureIntrinsicElementWidth(element) {
    if (!(element instanceof HTMLElement)) {
        return 0;
    }

    const clone = element.cloneNode(true);
    clone.style.position = 'fixed';
    clone.style.left = '-9999px';
    clone.style.top = '-9999px';
    clone.style.width = 'auto';
    clone.style.minWidth = '0';
    clone.style.maxWidth = 'none';
    clone.style.overflow = 'visible';
    clone.style.whiteSpace = 'nowrap';
    clone.style.visibility = 'hidden';
    clone.style.pointerEvents = 'none';

    document.body.appendChild(clone);
    const width = clone.getBoundingClientRect().width;
    clone.remove();

    return Math.ceil(width);
}

function refreshFieldWindowSizing(viewportSizeOverride = null) {
    const elements = getFieldSizingElements();
    if (!elements) {
        return;
    }

    const {
        fieldWindow,
        fieldElement,
        subtitleBar,
    } = elements;
    const titlebar = fieldWindow.querySelector('.mac-titlebar');

    const viewportSize = Math.max(
        FIELD_VIEWPORT_MIN_SIZE,
        Number(viewportSizeOverride || fieldElement.style.getPropertyValue('--field-visible-cells')) || FIELD_VIEWPORT_MIN_SIZE,
    );
    const metrics = getFieldLayoutMetrics(fieldElement);
    const minimumCellSizePx = measureMinimumFieldCellSize(fieldElement);
    const subtitleHeight = Math.ceil(subtitleBar.offsetHeight || 0);
    const windowStyles = window.getComputedStyle(fieldWindow);
    const chromeWidth = Math.ceil(
        getNumericStyleValue(windowStyles.borderLeftWidth)
        + getNumericStyleValue(windowStyles.borderRightWidth),
    );
    const chromeHeight = Math.ceil(
        getNumericStyleValue(windowStyles.borderTopWidth)
        + getNumericStyleValue(windowStyles.borderBottomWidth)
        + (titlebar?.offsetHeight || 0),
    );
    const subtitleMinimumWidth = measureFieldSubtitleMinimumWidth(fieldWindow);

    const windowRect = fieldWindow.getBoundingClientRect();
    const contentWidth = Math.max(0, Math.floor(windowRect.width - chromeWidth));
    const contentHeight = Math.max(0, Math.floor(windowRect.height - chromeHeight));
    let nextCellSizePx = FIELD_DEFAULT_CELL_SIZE_PX;

    if (contentWidth > 0 && contentHeight > 0) {
        const availableGridWidth = Math.max(0, contentWidth - metrics.paddingX - (metrics.gapX * Math.max(0, viewportSize - 1)));
        const availableGridHeight = Math.max(0, contentHeight - subtitleHeight - metrics.paddingY - (metrics.gapY * Math.max(0, viewportSize - 1)));
        nextCellSizePx = Math.max(
            minimumCellSizePx,
            Math.floor(Math.min(availableGridWidth / viewportSize, availableGridHeight / viewportSize)),
        );
    } else {
        nextCellSizePx = FIELD_DEFAULT_CELL_SIZE_PX;
    }

    fieldElement.style.setProperty('--field-cell-size', `${nextCellSizePx}px`);

    if (fieldWindow.offsetWidth <= 0 || fieldWindow.offsetHeight <= 0) {
        return;
    }

    const minimumGridWidth = Math.ceil(metrics.paddingX + (minimumCellSizePx * viewportSize) + (metrics.gapX * Math.max(0, viewportSize - 1)));
    const minimumGridHeight = Math.ceil(metrics.paddingY + (minimumCellSizePx * viewportSize) + (metrics.gapY * Math.max(0, viewportSize - 1)));
    const fittedGridWidth = Math.ceil(metrics.paddingX + (nextCellSizePx * viewportSize) + (metrics.gapX * Math.max(0, viewportSize - 1)));
    const fittedGridHeight = Math.ceil(metrics.paddingY + (nextCellSizePx * viewportSize) + (metrics.gapY * Math.max(0, viewportSize - 1)));
    const fittedWindowWidth = Math.max(fittedGridWidth, subtitleMinimumWidth) + chromeWidth;
    const fittedWindowHeight = subtitleHeight + fittedGridHeight + chromeHeight;

    fieldWindow.style.minWidth = `${Math.max(minimumGridWidth, subtitleMinimumWidth) + chromeWidth}px`;
    fieldWindow.style.minHeight = `${subtitleHeight + minimumGridHeight + chromeHeight}px`;
    fieldWindow.dataset.fittedWidth = String(fittedWindowWidth);
    fieldWindow.dataset.fittedHeight = String(fittedWindowHeight);
    fieldWindow.dataset.lockedAspectRatio = `${fittedWindowWidth / Math.max(1, fittedWindowHeight)}`;

    if (fieldWindow.classList.contains('desktop-window--resizable') && !fieldWindow.classList.contains('is-resizing')) {
        fieldWindow.style.width = `${fittedWindowWidth}px`;
        fieldWindow.style.height = `${fittedWindowHeight}px`;
    }
}

function initializeFieldTitle() {
    // Store Title as a Button
    const fieldTitleButton = document.createElement('section');
    fieldTitleButton.classList.add('container-title');
    fieldTitleButton.id = 'field-section-title';
    fieldTitleButton.setAttribute('aria-label', 'Field Section Title');
    fieldTitleButton.textContent = 'The Field';

    const mainDiv = document.querySelector('main');
    if (mainDiv) {
        mainDiv.appendChild(fieldTitleButton);
    } else {
        console.error('Main div not found');
    }
}

function initializeField(){
    // Store Section
    const field = document.createElement('section');
    field.classList.add('field-container');
    field.id = 'field';
    field.setAttribute('aria-label', 'The Field');

    // Append the field section to the main element
    const mainDiv = document.querySelector('main');
    if (mainDiv) {
        mainDiv.appendChild(field);
    } else {
        console.error('Main div not found');
    }
}

function applyFieldViewport(fieldElement, viewport) {
    fieldElement.style.gridTemplateColumns = `repeat(${viewport.size}, var(--field-cell-size))`;
    fieldElement.style.gridTemplateRows = `repeat(${viewport.size}, var(--field-cell-size))`;
    fieldElement.style.setProperty('--field-visible-cells', String(viewport.size));
    refreshFieldWindowSizing(viewport.size);
}

function updateField() {
    reconcileAllFieldsProgress();
    const gameState = getState();
    const activeField = ensureActiveFieldPlotStates(gameState);
    if (!activeField) {
        return;
    }
    
    const fieldElement = document.getElementById('field'); // Get the field element
    if (!fieldElement) {
        console.error('Field element not found');
        return;
    }
    fieldElement.innerHTML = ''; // Clear the field element's content

    const plotStates = activeField.plotStates;
    const now = Date.now();
    const { renderIndices, viewport } = buildFieldRenderViewModel(activeField, gameState);

    applyFieldViewport(fieldElement, viewport);

    renderIndices.forEach((index) => {
        const row = Math.floor(index / FIELD_GRID_WIDTH);
        const col = index % FIELD_GRID_WIDTH;
        const relativeRow = row - viewport.startRow;
        const relativeCol = col - viewport.startCol;

        if (relativeRow < 0 || relativeRow >= viewport.size || relativeCol < 0 || relativeCol >= viewport.size) {
            return;
        }

        const plot = document.createElement('button');
        const plotState = plotStates[index];
        plot.className = 'plotButton';
        plot.dataset.plotIndex = index;
        plot.style.gridRow = String(relativeRow + 1);
        plot.style.gridColumn = String(relativeCol + 1);
        syncFieldPlotButtonPresentation(plot, plotState, index, now);

        if (plotState?.plotType === 'module-slot') {
            // Module-slot plots are non-interactive in Zoom 0
            plot.disabled = true;
            plot.dataset.plotType = 'module-slot';
        } else {
            plot.addEventListener('click', () => performPlotClick(plot, index));
        }

        fieldElement.appendChild(plot);
    });

    refreshFieldTitlebarControl();
}

function syncActiveFieldButtons() {
    updateResourceBar();

    // Skip field DOM sync unless the desktop field window is actually visible.
    const scene = getCurrentScene();
    if (scene.name !== 'desktop' || !isDesktopWindowOpen('mac-window-field')) {
        return;
    }

    const gameState = getState();
    const activeField = ensureActiveFieldPlotStates(gameState);
    if (!activeField || !Array.isArray(activeField.plotStates)) {
        return;
    }

    const fieldElement = document.getElementById('field');
    if (!fieldElement) {
        return;
    }

    const { renderIndices, viewport } = buildFieldRenderViewModel(activeField, gameState);
    applyFieldViewport(fieldElement, viewport);

    const plotButtons = fieldElement.querySelectorAll('.plotButton');
    const shouldRerender =
        plotButtons.length !== renderIndices.length
        || renderIndices.some((index, position) => {
            const button = plotButtons[position];
            return Number(button?.dataset?.plotIndex) !== index;
        });

    if (shouldRerender) {
        updateField();
        return;
    }

    const now = Date.now();
    renderIndices.forEach((index, position) => {
        const plotButton = plotButtons[position];
        const plotState = activeField.plotStates[index];
        const row = Math.floor(index / FIELD_GRID_WIDTH);
        const col = index % FIELD_GRID_WIDTH;
        const relativeRow = row - viewport.startRow;
        const relativeCol = col - viewport.startCol;

        plotButton.style.gridRow = String(relativeRow + 1);
        plotButton.style.gridColumn = String(relativeCol + 1);
        syncFieldPlotButtonPresentation(plotButton, plotState, index, now);

        if (plotState?.plotType === 'module-slot') {
            plotButton.disabled = true;
            plotButton.dataset.plotType = 'module-slot';
        }
    });

    refreshFieldTitlebarControl();
}

function runFieldSimulationStep(stepMs) {
    fieldSimulationAccumulatorMs += Math.max(0, Number(stepMs) || 0);

    while (fieldSimulationAccumulatorMs >= FIELD_SIMULATION_SYNC_INTERVAL_MS) {
        fieldSimulationAccumulatorMs -= FIELD_SIMULATION_SYNC_INTERVAL_MS;
        reconcileAllFieldsProgress();
        checkMilestones();
    }
}

function startFieldRenderSync() {
    if (fieldTimerRenderUnsubscribe !== null) {
        return;
    }

    fieldRenderAccumulatorMs = 0;
    fieldTimerRenderUnsubscribe = registerRenderListener(({ frameDeltaMs }) => {
        fieldRenderAccumulatorMs += Math.max(0, Number(frameDeltaMs) || 0);
        if (fieldRenderAccumulatorMs < FIELD_RENDER_SYNC_INTERVAL_MS) {
            return;
        }

        fieldRenderAccumulatorMs = 0;
        syncActiveFieldButtons();
    });
}

export {
    initializeFieldTitle,
    initializeField,
    updateField,
    refreshFieldTitlebarControl,
    startFieldRenderSync,
    runFieldSimulationStep,
}