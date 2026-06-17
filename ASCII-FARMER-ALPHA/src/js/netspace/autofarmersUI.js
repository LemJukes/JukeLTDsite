// netspace/autofarmersUI.js
// Zoom 1 UI for autofarmer module slots.
// Provides the button element rendered inside the field snapshot grid and the
// dialogs used to build, upgrade, and configure autofarmers.
//
// All dialogs use macNotifications.showDialog(), which automatically inherits
// the netspace theme applied by sceneTransitions.js (Step 12b).
//
// Public API:
//   renderModuleSlotButton(nodeId, plotIndex, onUpdate) → HTMLButtonElement
//   showBuildDialog(nodeId, plotIndex, onUpdate)         → Promise<void>
//   showConfigDialog(nodeId, plotIndex, onUpdate)        → Promise<void>

import { getNodeState, getWorldState } from '../worldState.js';
import { showNotification, showConfirmation } from '../ui/macNotifications.js';
import { buildAutofarmer, getAutofarmCost, getAutofarmState } from './autofarmers.js';
import { revertPlot, destroyAutofarmer, getDestroyAutofarmerCost } from './plotConversionTunnel.js';

const DETAIL_OVERLAY_ID = 'autofarmer-detail-overlay';
const DETAIL_WINDOW_ID = 'autofarmer-detail-window';
const SCREEN_MARGIN_PX = 8;
const ANCHOR_GAP_PX = 6;
const AUTOFARMER_ASSET_DIR = './src/assets/AutoFarmer';
const AUTOFARMER_SPRITES = {
    desktopLight: `${AUTOFARMER_ASSET_DIR}/AutoFarmer.gif`,
    desktopDark: `${AUTOFARMER_ASSET_DIR}/AutoFarmerDark.gif`,
    desktopError: `${AUTOFARMER_ASSET_DIR}/AutoFarmerError.gif`,
    net: `${AUTOFARMER_ASSET_DIR}/AutoFarmer-net.gif`,
    netError: `${AUTOFARMER_ASSET_DIR}/AutoFarmerError-net.gif`,
};

let activeDetailOverlay = null;
let activeEscHandler = null;
let returnFocusElement = null;

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _el(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls)  el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
}

function _row(key, val) {
    const tr = document.createElement('tr');
    const th = _el('th', null, key);
    const td = _el('td', null, val);
    tr.append(th, td);
    return tr;
}

function countInstalledAutofarmers(nodeState) {
    const field = nodeState?.fields?.[nodeState.activeFieldId];
    if (!field || !Array.isArray(field.plotStates)) {
        return 0;
    }

    return field.plotStates.filter((plot) => plot?.moduleSlotType === 'autofarmer' && plot?.moduleState).length;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getAnchorRect(anchorEl) {
    if (!(anchorEl instanceof HTMLElement)) {
        return null;
    }

    const rect = anchorEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return null;
    }

    return rect;
}

function positionWindow(windowEl, anchorRect) {
    const leftRoom = anchorRect.left - SCREEN_MARGIN_PX;
    const rightRoom = window.innerWidth - anchorRect.right - SCREEN_MARGIN_PX;
    const expandRight = rightRoom >= leftRoom;
    const maxTop = Math.max(SCREEN_MARGIN_PX, window.innerHeight - 220);
    const topValue = clamp(anchorRect.top - 8, SCREEN_MARGIN_PX, maxTop);

    windowEl.style.top = `${Math.round(topValue)}px`;

    if (expandRight) {
        const left = clamp(anchorRect.right + ANCHOR_GAP_PX, SCREEN_MARGIN_PX, window.innerWidth - 80);
        windowEl.style.left = `${Math.round(left)}px`;
        windowEl.style.right = 'auto';
        windowEl.classList.add('autofarmer-detail-window--expand-right');
        return;
    }

    const right = clamp(window.innerWidth - anchorRect.left + ANCHOR_GAP_PX, SCREEN_MARGIN_PX, window.innerWidth - 80);
    windowEl.style.left = 'auto';
    windowEl.style.right = `${Math.round(right)}px`;
    windowEl.classList.add('autofarmer-detail-window--expand-left');
}

function closeAnchoredDetailWindow() {
    if (activeEscHandler) {
        document.removeEventListener('keydown', activeEscHandler);
        activeEscHandler = null;
    }

    if (activeDetailOverlay && activeDetailOverlay.parentElement) {
        activeDetailOverlay.parentElement.removeChild(activeDetailOverlay);
    }

    activeDetailOverlay = null;

    if (returnFocusElement instanceof HTMLElement && typeof returnFocusElement.focus === 'function') {
        returnFocusElement.focus();
    }

    returnFocusElement = null;
}

function createTitlebar(title, onClose) {
    const titlebar = document.createElement('div');
    titlebar.className = 'mac-titlebar';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'mac-close-btn';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', `Close ${title}`);
    closeBtn.setAttribute('title', `Close ${title}`);
    closeBtn.addEventListener('click', onClose);

    const titleSpan = document.createElement('span');
    titleSpan.className = 'mac-title';
    titleSpan.textContent = title;

    titlebar.append(closeBtn, titleSpan);
    return titlebar;
}

function createDetailSprite(isError) {
    const spriteWrap = document.createElement('div');
    spriteWrap.className = 'autofarmer-detail-sprite-wrap';

    const sprite = document.createElement('img');
    sprite.className = 'autofarmer-detail-sprite';
    sprite.alt = isError ? 'Autofarmer error state' : 'Autofarmer netspace state';
    sprite.src = isError ? AUTOFARMER_SPRITES.netError : AUTOFARMER_SPRITES.net;

    spriteWrap.appendChild(sprite);
    return spriteWrap;
}

function createDetailLayout(spriteEl) {
    const layout = document.createElement('div');
    layout.className = 'autofarmer-detail-layout';

    const aside = document.createElement('div');
    aside.className = 'autofarmer-detail-aside';
    aside.appendChild(spriteEl);

    const main = document.createElement('div');
    main.className = 'autofarmer-detail-main';

    layout.append(aside, main);
    return { layout, main };
}

async function showModuleSlotOptionsDialog(nodeId, plotIndex, onUpdate, anchorEl = null) {
    const ns = getNodeState(nodeId);
    if (!ns) return;

    const buildCost = getAutofarmCost();
    const coins = Math.floor(Number(ns.coins) || 0);
    const canBuildAutofarmer = coins >= buildCost;
    const options = [
        {
            id: 'build',
            title: 'Build Autofarmer',
            detail: 'Install base automation on this module slot.',
            costLabel: `¤${buildCost}`,
            disabled: !canBuildAutofarmer,
            disabledReason: canBuildAutofarmer ? '' : 'Insufficient coins',
        },
        {
            id: 'revert',
            title: 'Build Plot Tile',
            detail: 'Convert this module slot back into a standard crop plot.',
            costLabel: 'No coin cost',
            disabled: false,
            disabledReason: '',
        },
    ];

    const body = _el('div', 'autofarmer-dialog-body');
    const main = document.createElement('div');
    main.className = 'autofarmer-detail-main';
    body.appendChild(main);

    const intro = _el('p', 'mac-dialog-message', `Available: ¤${coins}`);
    main.appendChild(intro);

    const headerTable = document.createElement('table');
    headerTable.className = 'node-ov-table autofarmer-detail-table';
    headerTable.appendChild(_row('Slot', `Module ${plotIndex + 1}`));
    headerTable.querySelectorAll('th').forEach((th) => {
        th.style.textAlign = 'right';
    });
    main.appendChild(headerTable);

    const optionsList = document.createElement('div');
    optionsList.className = 'module-slot-options-list';

    options.forEach((option) => {
        const card = document.createElement('article');
        card.className = 'module-slot-option-card';

        const meta = document.createElement('div');
        meta.className = 'module-slot-option-meta';

        const title = document.createElement('h4');
        title.className = 'module-slot-option-title';
        title.textContent = option.title;

        const detail = document.createElement('p');
        detail.className = 'module-slot-option-detail';
        detail.textContent = option.detail;

        const cost = document.createElement('p');
        cost.className = 'module-slot-option-cost';
        cost.textContent = `Cost: ${option.costLabel}${option.disabledReason ? ` (${option.disabledReason})` : ''}`;

        meta.append(title, detail, cost);

        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.className = 'mac-button module-slot-option-button';
        actionButton.textContent = option.title;
        actionButton.disabled = option.disabled;

        if (option.id === 'build') {
            actionButton.addEventListener('click', () => {
                closeAnchoredDetailWindow();
                void showBuildDialog(nodeId, plotIndex, onUpdate, anchorEl);
            });
        } else if (option.id === 'revert') {
            actionButton.addEventListener('click', async () => {
                closeAnchoredDetailWindow();
                if (!revertPlot(nodeId, plotIndex)) {
                    await showNotification('Unable to restore this module slot to a crop plot.', 'Module Slot', 'error');
                    return;
                }
                onUpdate?.();
            });
        }

        card.append(meta, actionButton);
        optionsList.appendChild(card);
    });

    main.appendChild(optionsList);

    await showAnchoredDetailWindow({
        title: '⚙ Module Slot',
        anchorEl,
        body,
        buttons: [{ label: 'Close', value: false, autofocus: true }],
        closeValue: false,
    });
}

function showAnchoredDetailWindow({ title, anchorEl, body, buttons, closeValue = false }) {
    return new Promise((resolve) => {
        closeAnchoredDetailWindow();

        const overlay = document.createElement('div');
        overlay.id = DETAIL_OVERLAY_ID;
        overlay.className = 'autofarmer-detail-overlay autofarmer-detail-overlay--visible mac-notification-overlay--theme-netspace';
        overlay.setAttribute('aria-hidden', 'false');

        const dialog = document.createElement('div');
        dialog.id = DETAIL_WINDOW_ID;
        dialog.className = 'mac-window mac-dialog-window autofarmer-detail-window';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', title);

        const content = document.createElement('div');
        content.className = 'mac-dialog-content autofarmer-detail-content';

        if (body instanceof HTMLElement) {
            content.appendChild(body);
        }

        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'mac-button-group autofarmer-detail-actions';

        const closeDialog = (value) => {
            closeAnchoredDetailWindow();
            resolve(value);
        };

        const resolvedButtons = Array.isArray(buttons) && buttons.length > 0
            ? buttons
            : [{ label: 'Close', value: closeValue, autofocus: true }];

        resolvedButtons.forEach((buttonConfig, index) => {
            const button = document.createElement('button');
            button.className = 'mac-button';
            button.type = 'button';
            button.textContent = buttonConfig.label;
            button.addEventListener('click', () => closeDialog(buttonConfig.value));

            if (buttonConfig.className) {
                button.classList.add(buttonConfig.className);
            }

            if (buttonConfig.autofocus ?? index === 0) {
                queueMicrotask(() => button.focus());
            }

            buttonGroup.appendChild(button);
        });

        const titlebar = createTitlebar(title, () => closeDialog(closeValue));
        content.appendChild(buttonGroup);
        dialog.append(titlebar, content);
        overlay.appendChild(dialog);

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                closeDialog(closeValue);
            }
        });

        activeEscHandler = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeDialog(closeValue);
            }
        };

        document.addEventListener('keydown', activeEscHandler);
        document.body.appendChild(overlay);
        activeDetailOverlay = overlay;
        returnFocusElement = anchorEl instanceof HTMLElement ? anchorEl : null;

        const anchorRect = getAnchorRect(anchorEl);
        dialog.style.visibility = 'hidden';
        requestAnimationFrame(() => {
            if (anchorRect) {
                positionWindow(dialog, anchorRect);
            } else {
                dialog.style.left = '50%';
                dialog.style.top = '50%';
                dialog.style.right = 'auto';
                dialog.style.transform = 'translate(-50%, -50%)';
            }

            dialog.style.visibility = 'visible';
        });
    });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Creates and returns the button element for a module-slot plot cell in the
 * Zoom 1 field snapshot grid.
 *
 * - Empty slot  → "⚙" with "Build Autofarmer" affordance
 * - Autofarmer  → "⚙AF" with status affordance
 *
 * @param {string}   nodeId
 * @param {number}   plotIndex
 * @param {Function} [onUpdate]  Called after a state-changing action so the
 *                               caller can re-render the field snapshot.
 * @returns {HTMLButtonElement}
 */
export function renderModuleSlotButton(nodeId, plotIndex, onUpdate) {
    const ns = getNodeState(nodeId);
    const plotState = ns?.fields?.[ns.activeFieldId]?.plotStates?.[plotIndex];
    const ms = plotState?.moduleState;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'node-ov-cell node-ov-cell--module';

    if (ms) {
        const isStalled = Boolean(ms.isStalled);
        btn.textContent = '⚙AF';
        btn.title = isStalled
            ? 'Autofarmer stalled — click to view status'
            : ms.paused
                ? 'Autofarmer paused — click to view status'
                : 'Autofarmer active — click to view status';
        if (isStalled) {
            btn.classList.add('af-slot--stalled');
        } else {
            btn.classList.add('af-slot--active');
        }
        btn.addEventListener('click', () => showConfigDialog(nodeId, plotIndex, onUpdate, btn));
    } else {
        btn.textContent = '⚙';
        btn.title = 'Empty module slot — click to view construction options';
        btn.addEventListener('click', () => showModuleSlotOptionsDialog(nodeId, plotIndex, onUpdate, btn));
    }

    return btn;
}

/**
 * Shows a dialog for building a new autofarmer on an empty module slot.
 * Displays all three tier options with cost and specs.
 * Also offers a "Restore Slot" option to revert the plot back to a crop plot.
 *
 * @param {string}   nodeId
 * @param {number}   plotIndex
 * @param {Function} [onUpdate]
 */
export async function showBuildDialog(nodeId, plotIndex, onUpdate, anchorEl = null) {
    const ns = getNodeState(nodeId);
    if (!ns) return;

    const world = getWorldState();
    const additionalAutofarmersUnlocked = Boolean(world.tutorialFlags?.additionalAutofarmersUnlocked);
    if (!additionalAutofarmersUnlocked && countInstalledAutofarmers(ns) > 0) {
        await showNotification('Additional autofarmers are locked for now.', 'Autofarmer Locked', 'warning');
        return;
    }

    const coins = Math.floor(Number(ns.coins) || 0);
    const buildCost = getAutofarmCost();
    const affordable = coins >= buildCost;

    // ── Build the dialog body ─────────────────────────────────────────────────
    const body = _el('div', 'autofarmer-dialog-body');
    const { layout, main } = createDetailLayout(createDetailSprite(false));
    body.appendChild(layout);

    const balanceLine = _el('p', 'mac-dialog-message', `Available: ¤${coins}`);
    main.appendChild(balanceLine);

    const table = document.createElement('table');
    table.className = 'node-ov-table autofarmer-detail-table';
    table.appendChild(_row('Cost', `¤${buildCost}${affordable ? '' : ' (insufficient)'}`));
    table.appendChild(_row('Mode', 'Base Autofarmer'));
    table.appendChild(_row('Tick cadence', '1000ms/tick'));
    table.appendChild(_row('Scan radius', '1 ring around module slot'));
    table.querySelectorAll('th').forEach((th) => {
        th.style.textAlign = 'right';
    });
    if (!affordable) {
        table.style.opacity = '0.6';
    }
    main.appendChild(table);

    const result = await showAnchoredDetailWindow({
        title: '⚙ Build Autofarmer',
        anchorEl,
        body,
        buttons: [
            { label: `Build (¤${buildCost})`, value: 'build', autofocus: true },
            { label: 'Restore Slot', value: 'revert' },
            { label: 'Cancel', value: false },
        ],
        closeValue: false,
    });

    if (!result) return;

    if (result === 'revert') {
        revertPlot(nodeId, plotIndex);
        onUpdate?.();
        return;
    }

    const buildResult = buildAutofarmer(nodeId, plotIndex);
    if (!buildResult.ok) {
        await showNotification(buildResult.error, 'Build Failed', 'error');
        return;
    }

    onUpdate?.();
}

/**
 * Shows a dialog for viewing the status of an existing Autofarmer.
 *
 * @param {string}   nodeId
 * @param {number}   plotIndex
 * @param {Function} [onUpdate]
 */
export async function showConfigDialog(nodeId, plotIndex, onUpdate, anchorEl = null) {
    const ns = getNodeState(nodeId);
    if (!ns) return;

    const plotState = ns?.fields?.[ns.activeFieldId]?.plotStates?.[plotIndex];
    const ms = plotState?.moduleState;
    if (!ms) return;

    const coins = Math.floor(Number(ns.coins) || 0);
    const state = getAutofarmState(nodeId, plotIndex);
    if (!state) return;

    // ── Build the dialog body ─────────────────────────────────────────────────
    const body = _el('div', 'autofarmer-dialog-body');
    const { layout, main } = createDetailLayout(createDetailSprite(Boolean(state.isStalled)));
    body.appendChild(layout);

    // Stats table
    const statsTable = document.createElement('table');
    statsTable.className = 'node-ov-table autofarmer-detail-table';
    statsTable.appendChild(_row('Mode', 'Base Autofarmer'));
    statsTable.appendChild(_row('Tick cadence', `${state.tickIntervalMs}ms/tick`));
    statsTable.appendChild(_row('Scan radius', `Ring ${state.rangeRadius} (${state.clockwiseOrder.length} plots)`));
    statsTable.appendChild(_row('Status', state.isStalled ? 'Stalled (resource shortage)' : 'Working'));
    statsTable.appendChild(_row('Paused', state.paused ? 'Yes' : 'No'));
    statsTable.appendChild(_row('Coins', `¤${coins}`));
    statsTable.querySelectorAll('th').forEach((th) => {
        th.style.textAlign = 'right';
    });
    main.appendChild(statsTable);

    const destroyCost = getDestroyAutofarmerCost();

    // ── Buttons ───────────────────────────────────────────────────────────────
    const dialogButtons = [
        { label: `Destroy Autofarmer (¤${destroyCost})`, value: 'destroy' },
        { label: 'Close', value: false, autofocus: true },
    ];

    const result = await showAnchoredDetailWindow({
        title: '⚙ Autofarmer',
        anchorEl,
        body,
        buttons: dialogButtons,
        closeValue: false,
    });

    if (!result) return;

    if (result === 'destroy') {
        const confirmed = await showConfirmation(
            `Destroy this Autofarmer for ¤${destroyCost} and return to an empty module slot?`,
            { title: 'Destroy Autofarmer', category: 'warning' },
        );

        if (!confirmed) {
            return;
        }

        const destroyResult = destroyAutofarmer(nodeId, plotIndex);
        if (!destroyResult.ok) {
            await showNotification(destroyResult.error, 'Autofarmer', 'error');
            return;
        }

        onUpdate?.();
        return;
    }

    onUpdate?.();
}
