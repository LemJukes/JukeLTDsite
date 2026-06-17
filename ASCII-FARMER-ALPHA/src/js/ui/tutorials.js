import { getActiveNodeState as getState, getWorldState, dispatchWorldAction } from '../worldState.js';
import { getCurrentScene } from '../sceneManager.js';
import { openDesktopWindow, closeDesktopWindow } from './desktopWindowManager.js';
import { showDialog } from './macNotifications.js';

const TUTORIAL_FLAG_DEFAULTS = {
    upgradesIconHintShown: false,
    questsIconHintShown: false,
    netSpaceTutorialShown: false,
    additionalAutofarmersUnlocked: false,
};

const NETSPACE_GREEN_SPRITE_PLACEHOLDER_PATH = './src/assets/farmr/farmr-netspace-green-placeholder.gif';

let netSpaceTutorialRunning = false;
const pendingHintFlags = new Set();

function isCurrentlyDark() {
    if (document.body.classList.contains('dark')) return true;
    if (document.body.classList.contains('light')) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function addHighlights(...selectors) {
    selectors.forEach((sel) => {
        try {
            document.querySelectorAll(sel).forEach((el) => el.classList.add('tutorial-highlight'));
        } catch {
            // ignore invalid selectors
        }
    });
}

function removeAllHighlights() {
    document.querySelectorAll('.tutorial-highlight').forEach((el) =>
        el.classList.remove('tutorial-highlight'),
    );
}

function getTutorialFlags(world = getWorldState()) {
    return {
        ...TUTORIAL_FLAG_DEFAULTS,
        ...(world.tutorialFlags ?? {}),
    };
}

function updateTutorialFlags(patch) {
    const world = getWorldState();
    dispatchWorldAction({
        type: 'world.patch',
        payload: {
            updates: {
                tutorialFlags: {
                    ...getTutorialFlags(world),
                    ...patch,
                },
            },
        },
        meta: { source: 'tutorials.updateTutorialFlags' },
    });
}

function getIconElement(iconId) {
    return iconId ? document.getElementById(iconId) : null;
}

function setHighlightedIcon(iconId, highlighted) {
    const icon = getIconElement(iconId);
    if (!icon) {
        return;
    }
    icon.classList.toggle('tutorial-highlight', Boolean(highlighted));
}

function setHighlightedSelectors(selectors, highlighted) {
    selectors.forEach((selector) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach((element) => {
            element.classList.toggle('tutorial-highlight', Boolean(highlighted));
        });
    });
}

function getTutorialSpriteSrc() {
    return isCurrentlyDark()
        ? './src/assets/farmr/farmr-sprite-DarkMode.gif'
        : './src/assets/farmr/farmr-sprite.gif';
}

function getNetSpaceTutorialSpriteSrc() {
    const configured = typeof window.__ASCII_FARMER_NETSPACE_FARMR_SPRITE === 'string'
        ? window.__ASCII_FARMER_NETSPACE_FARMR_SPRITE.trim()
        : '';

    // Placeholder hook for a future green Net-Space farmr variant.
    // Once the art is ready, either set window.__ASCII_FARMER_NETSPACE_FARMR_SPRITE
    // or point this constant at the final asset path.
    if (configured.length > 0 && configured !== NETSPACE_GREEN_SPRITE_PLACEHOLDER_PATH) {
        return configured;
    }

    return getTutorialSpriteSrc();
}

function createFarmrDialogBody(message, spriteSrc = getTutorialSpriteSrc()) {
    const bodyEl = document.createElement('div');
    bodyEl.className = 'mac-welcome-body';

    const sprite = document.createElement('img');
    sprite.className = 'mac-welcome-sprite';
    sprite.alt = 'farmr the digital farmer';
    sprite.src = spriteSrc;

    const messageEl = document.createElement('p');
    messageEl.className = 'mac-welcome-message';
    messageEl.textContent = message;

    bodyEl.append(sprite, messageEl);
    return bodyEl;
}

function isTextEntryTarget(target) {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    const tagName = target.tagName;
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || target.isContentEditable;
}

function isSpaceOrEnterKey(event) {
    return event.key === ' ' || event.key === 'Space' || event.key === 'Spacebar' || event.key === 'Enter';
}

function showFarmrDialog({ title, message, buttons, closeValue = true, spriteSrc = getTutorialSpriteSrc() }) {
    return showDialog({
        title,
        category: 'success',
        body: createFarmrDialogBody(message, spriteSrc),
        buttons: buttons ?? [{ label: 'OK', value: true, autofocus: true }],
        dialogClassName: 'mac-welcome-window',
        closeValue,
    });
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function getDesktopIconAnchorRect(iconEl) {
    if (!iconEl) {
        return null;
    }

    const rect = iconEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return null;
    }

    return rect;
}

function positionTutorialFlyout(dialogEl, iconEl) {
    const anchorRect = getDesktopIconAnchorRect(iconEl);
    if (!anchorRect) {
        dialogEl.style.left = '24px';
        dialogEl.style.top = '24px';
        return;
    }

    const margin = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const dialogRect = dialogEl.getBoundingClientRect();

    const leftCandidate = anchorRect.right + margin;
    const rightSpace = viewportWidth - leftCandidate - margin;
    const fallbackLeft = anchorRect.left - dialogRect.width - margin;
    const left = rightSpace >= dialogRect.width
        ? leftCandidate
        : fallbackLeft >= margin
            ? fallbackLeft
            : viewportWidth - dialogRect.width - margin;

    const top = clamp(
        anchorRect.top + Math.round((anchorRect.height - dialogRect.height) / 2),
        margin,
        Math.max(margin, viewportHeight - dialogRect.height - margin),
    );

    dialogEl.style.left = `${Math.round(left)}px`;
    dialogEl.style.top = `${Math.round(top)}px`;
}

function createFloatingTutorialFlyout({ iconId, title, message, onClose }) {
    const iconEl = getIconElement(iconId);

    const container = document.createElement('div');
    container.className = 'mac-tutorial-flyout';

    const dialog = document.createElement('div');
    dialog.className = 'mac-window mac-dialog-window mac-welcome-window mac-tutorial-flyout-window';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'false');
    dialog.setAttribute('aria-label', title);

    const titlebar = document.createElement('div');
    titlebar.className = 'mac-titlebar';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'mac-close-btn';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', `Close ${title}`);
    closeBtn.setAttribute('title', `Close ${title}`);

    const titleSpan = document.createElement('span');
    titleSpan.className = 'mac-title';
    titleSpan.textContent = title;

    titlebar.append(closeBtn, titleSpan);

    const content = document.createElement('div');
    content.className = 'mac-dialog-content';

    const bodyEl = document.createElement('div');
    bodyEl.className = 'mac-welcome-body';

    const sprite = document.createElement('img');
    sprite.className = 'mac-welcome-sprite';
    sprite.alt = 'farmr the digital farmer';
    sprite.src = getTutorialSpriteSrc();

    const messageEl = document.createElement('p');
    messageEl.className = 'mac-welcome-message';
    messageEl.textContent = message;

    const footer = document.createElement('div');
    footer.className = 'mac-welcome-footer';

    const spacer = document.createElement('span');
    spacer.className = 'mac-welcome-progress';
    spacer.textContent = ' ';

    const okBtn = document.createElement('button');
    okBtn.className = 'mac-button';
    okBtn.type = 'button';
    okBtn.textContent = 'OK';

    footer.append(spacer, okBtn);
    bodyEl.append(sprite, messageEl);
    content.append(bodyEl, footer);
    dialog.append(titlebar, content);
    container.append(dialog);
    document.body.appendChild(container);

    let cleanedUp = false;
    let keydownHandler = null;

    const reposition = () => {
        positionTutorialFlyout(dialog, iconEl);
    };

    const cleanup = () => {
        if (cleanedUp) {
            return;
        }

        cleanedUp = true;
        if (keydownHandler) {
            document.removeEventListener('keydown', keydownHandler, true);
            keydownHandler = null;
        }
        window.removeEventListener('resize', reposition, true);
        window.removeEventListener('scroll', reposition, true);
        removeAllHighlights();
        container.remove();

        if (typeof onClose === 'function') {
            onClose();
        }
    };

    closeBtn.addEventListener('click', cleanup);
    okBtn.addEventListener('click', cleanup);

    keydownHandler = (event) => {
        if (!container.isConnected || !isSpaceOrEnterKey(event) || isTextEntryTarget(event.target)) {
            return;
        }

        event.preventDefault();
        cleanup();
    };

    document.addEventListener('keydown', keydownHandler, true);

    dialog.style.visibility = 'hidden';
    requestAnimationFrame(() => {
        reposition();
        dialog.style.visibility = 'visible';
    });

    window.addEventListener('resize', reposition, true);
    window.addEventListener('scroll', reposition, true);
    queueMicrotask(() => okBtn.focus());

    return {
        close: cleanup,
        dialog,
        reposition,
    };
}

function waitForCondition(predicate, intervalMs = 300, timeoutMs = 120000) {
    return new Promise((resolve) => {
        const startedAt = Date.now();
        const timerId = window.setInterval(() => {
            if (predicate()) {
                window.clearInterval(timerId);
                resolve(true);
                return;
            }

            if (Date.now() - startedAt >= timeoutMs) {
                window.clearInterval(timerId);
                resolve(false);
            }
        }, intervalMs);
    });
}

function hasModuleSlot() {
    const node = getState();
    const field = node?.fields?.[node.activeFieldId];
    return Boolean(field?.plotStates?.some((plot) => plot?.plotType === 'module-slot'));
}

function hasAutofarmerInstalled() {
    const node = getState();
    const field = node?.fields?.[node.activeFieldId];
    return Boolean(field?.plotStates?.some((plot) => plot?.moduleSlotType === 'autofarmer' && plot?.moduleState));
}

async function showIconHint({ iconId, title, message, flagName, category = 'success' }) {
    const world = getWorldState();
    const flags = getTutorialFlags(world);
    if (flagName && flags[flagName]) {
        return false;
    }
    if (flagName && pendingHintFlags.has(flagName)) {
        return false;
    }

    if (flagName) {
        pendingHintFlags.add(flagName);
    }

    setHighlightedIcon(iconId, true);
    try {
        await new Promise((resolve) => {
            createFloatingTutorialFlyout({
                iconId,
                title,
                message,
                onClose: resolve,
            });
        });
    } finally {
        setHighlightedIcon(iconId, false);
        if (flagName) {
            updateTutorialFlags({ [flagName]: true });
            pendingHintFlags.delete(flagName);
        }
    }

    return true;
}

function buildStartupTutorialSteps() {
    return [
        {
            mode: 'both',
            title: (mode) => (mode === 'new-game' ? 'Welcome to ASCII Farmer!' : 'Tutorial'),
            message: (mode) =>
                mode === 'new-game'
                    ? `Howdy Partner! I'm farmr, the caretaker of this here farm — and I sure am glad you showed up when you did!\n\nThings have been getting a little overwhelming for one critter to manage alone.\n\nLet me show you how things work around these parts. I'll walk you through a few windows and we'll even grow your very first crop together!\n\n  -- farmr`
                    : `Howdy! It's farmr here. Let me walk you back through how this farm works.\n\n  -- farmr`,
            dialogMode: 'overlay',
        },
        {
            mode: 'both',
            title: 'Your Resources',
            message: `Take a look at the Resources window!\n\nAt the top you'll find your Coins — that's your spending money for buying supplies and expansions.\n\nBelow that is your Water supply and maximum capacity. At the bottom you'll see your Seed and Crop inventories.\n\nKeep an eye on all of these — you'll be managing them constantly.`,
            dialogMode: 'floating',
            onEnter: ({ openedWindows }) => {
                openedWindows.push('mac-window-resource-bar');
                openDesktopWindow('mac-window-resource-bar');
                addHighlights('#mac-window-resource-bar');
            },
            onExit: () => removeAllHighlights(),
        },
        {
            mode: 'both',
            title: 'Your Tools',
            message: `This is your Toolbox! You have four tools to work with:\n\n  Plow — Breaks up untilled soil so you can plant in it.\n  Seed Bag — Plants seeds into tilled plots.\n  Watering Can — Waters growing crops.\n  Scythe — Harvests ripe crops.\n\nSelect a tool by clicking it (or bind tools to keyboard shortcuts in Options).`,
            dialogMode: 'floating',
            onEnter: ({ openedWindows }) => {
                openedWindows.push('mac-window-toolbox-container');
                openDesktopWindow('mac-window-toolbox-container');
                addHighlights('#mac-window-toolbox-container');
            },
            onExit: () => removeAllHighlights(),
        },
        {
            mode: 'new-game',
            title: "Let's Grow Your First Crop!",
            message: `Now let's put those tools to work!\n\nI'll open the Field and walk you through planting and harvesting your first wheat crop step by step.\n\nFollow along — I'll highlight each window as we go!`,
            dialogMode: 'floating',
            onEnter: ({ openedWindows }) => {
                openedWindows.push('mac-window-field');
                openDesktopWindow('mac-window-field');
                addHighlights('#mac-window-field');
            },
            onExit: () => removeAllHighlights(),
        },
        {
            mode: 'new-game',
            title: 'Step 1 of 4 \u2014 Plow the Soil',
            message: `Select the Plow tool in the Toolbox, then click any empty (~) plot on the Field to till the soil.`,
            dialogMode: 'floating',
            onEnter: (ctx) => {
                const state = getState();
                const field = state.fields?.[state.activeFieldId];
                if (field) {
                    const idx = field.plotStates.findIndex(
                        (p) => p.owned && p.symbol === '~' && !p.destroyed,
                    );
                    ctx.setTutorialPlotIndex(idx);
                }
                addHighlights('#mac-window-toolbox-container', '#mac-window-field');
            },
            onExit: () => removeAllHighlights(),
            waitFor: (ctx) => ctx.getTutorialPlotState()?.symbol === '=',
        },
        {
            mode: 'new-game',
            title: 'Step 2 of 4 \u2014 Plant Seeds',
            message: `Nice! Now select the Seed Bag in the Toolbox and click the tilled (=) plot in the Field to plant your wheat seed.`,
            dialogMode: 'floating',
            onEnter: () => {
                addHighlights('#mac-window-toolbox-container', '#mac-window-field');
            },
            onExit: () => removeAllHighlights(),
            waitFor: (ctx) => ctx.getTutorialPlotState()?.symbol === '.',
        },
        {
            mode: 'new-game',
            title: 'Step 3 of 4 \u2014 Water the Crop',
            message: `Select the Watering Can in the Toolbox and keep clicking the planted plot in the Field until the crop is fully grown!\n\nWater progress: (0 / 4)`,
            dialogMode: 'floating',
            onEnter: () => {
                addHighlights('#mac-window-toolbox-container', '#mac-window-field');
            },
            onExit: () => removeAllHighlights(),
            waitFor: (ctx) => ctx.getTutorialPlotState()?.symbol === '¥',
            liveMessage: (ctx) => {
                const count = ctx.getTutorialPlotState()?.waterCount ?? 0;
                return `Select the Watering Can in the Toolbox and keep clicking the planted plot in the Field until the crop is fully grown!\n\nWater progress: (${count} / 4)`;
            },
        },
        {
            mode: 'new-game',
            title: 'Step 4 of 4 \u2014 Harvest!',
            message: `It's ripe! Select the Scythe in the Toolbox and click the ripe crop (¥) in the Field to bring in the harvest.`,
            dialogMode: 'floating',
            onEnter: (ctx) => {
                ctx.setInitialWheat(getState().wheat);
                addHighlights('#mac-window-toolbox-container', '#mac-window-field');
            },
            onExit: () => removeAllHighlights(),
            waitFor: (ctx) => getState().wheat > ctx.getInitialWheat(),
        },
        {
            mode: 'replay',
            title: 'The Field',
            message: `The Field is where the real work happens. Here's the full process for growing a crop:\n\n  1. Plow — Select the Plow, then click an empty plot (~) to till the soil.\n  2. Plant — Select the Seed Bag, then click the tilled plot (=) to plant seeds.\n  3. Water — Select the Watering Can, then click the growing crop to water it. Wheat takes 4 waters to ripen (other crops take more).\n  4. Harvest — Select the Scythe, then click the ripe crop symbol to harvest. Using the Scythe guarantees a successful harvest!`,
            dialogMode: 'floating',
        },
        {
            mode: 'both',
            title: 'The Store',
            message: (mode) =>
                mode === 'new-game'
                    ? `Great harvest! Now head to the Store to sell your wheat for Coins.\n\nYou'll also want to restock on wheat seeds — you planted your last one! Check the Buy section at the top, and the Sell section below it.\n\nKeep an eye on the Store — you never know what might turn up that could change the way you farm altogether!`
                    : `The Store is your trading hub.\n\nBuy seeds and refill water in the top section. Sell your harvested crops in the bottom section for Coins.\n\nKeep an eye on what's on offer — new items become available as you progress!`,
            dialogMode: 'floating',
            onEnter: ({ openedWindows }) => {
                openedWindows.push('mac-window-store');
                openDesktopWindow('mac-window-store');
                addHighlights('#mac-window-store');
            },
            onExit: () => removeAllHighlights(),
        },
        {
            mode: 'both',
            title: 'Upgrades & Quests',
            message: `Keep farming and you'll start to unlock more!\n\nUpgrades lets you improve your farm — bigger fields, better tools, and automated helpers.\n\nQuests give you goals to work toward and rewards for hitting milestones.\n\nThe Upgrades and Quests icons on the right side will light up as you progress.`,
            dialogMode: 'floating',
            onEnter: () => {
                addHighlights('#desktop-icon-upgrades', '#desktop-icon-quests');
            },
            onExit: ({ mode, openedWindows }) => {
                removeAllHighlights();
                if (mode === 'new-game') {
                    openedWindows.forEach((id) => closeDesktopWindow(id));
                    openedWindows.length = 0;
                }
            },
        },
        {
            mode: 'both',
            title: 'Options, Stats & Achievements',
            message: `Up in the top-left menu bar you'll find three buttons:\n\n  Options — Customize your experience: dark mode, keybinds, audio, text scale, and more.\n  Stats — Track your lifetime farming numbers at a glance.\n  Achievements — Challenges and milestones to work toward.\n\nYou can replay this tutorial any time from the Options menu.`,
            dialogMode: 'floating',
            onEnter: () => {
                addHighlights(
                    '#desktop-menu-options',
                    '#desktop-menu-stats',
                    '#desktop-menu-achievements',
                );
            },
            onExit: () => removeAllHighlights(),
        },
        {
            mode: 'both',
            title: (mode) => (mode === 'new-game' ? 'Now Get to Farming!' : 'Happy Farming!'),
            message: (mode) =>
                mode === 'new-game'
                    ? `That's everything you need to get started! The farm won't run itself — not without your help, anyhow.\n\nIf you've got a keyboard handy, give those keys a try too. You might find things move a whole heap faster than clicking around!\n\nGood luck out there, Partner.\n\n  -- farmr`
                    : `You're all set! Get back out there and keep that farm running.\n\nGood luck, Partner.\n\n  -- farmr`,
            dialogMode: 'floating',
        },
    ];
}

function runTutorial(mode) {
    return new Promise((resolve) => {
        const steps = buildStartupTutorialSteps().filter((s) => s.mode === 'both' || s.mode === mode);
        let currentIndex = 0;
        const openedWindows = [];
        let tutorialPlotIndex = -1;
        let initialWheat = 0;
        let cancelled = false;
        let pollTimer = null;
        let tutorialKeydownHandler = null;

        const overlay = document.createElement('div');
        overlay.className = 'mac-notification-overlay mac-welcome-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'mac-window mac-dialog-window mac-welcome-window';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', 'Tutorial');

        const titlebar = document.createElement('div');
        titlebar.className = 'mac-titlebar';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'mac-close-btn';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close Tutorial');
        closeBtn.setAttribute('title', 'Close Tutorial');

        const titleSpan = document.createElement('span');
        titleSpan.className = 'mac-title';

        titlebar.append(closeBtn, titleSpan);

        const content = document.createElement('div');
        content.className = 'mac-dialog-content';

        const bodyEl = document.createElement('div');
        bodyEl.className = 'mac-welcome-body';

        const sprite = document.createElement('img');
        sprite.className = 'mac-welcome-sprite';
        sprite.alt = 'farmr the digital farmer';

        const messageEl = document.createElement('p');
        messageEl.className = 'mac-welcome-message';

        bodyEl.append(sprite, messageEl);

        const footer = document.createElement('div');
        footer.className = 'mac-welcome-footer';

        const progressEl = document.createElement('span');
        progressEl.className = 'mac-welcome-progress';

        const waitingEl = document.createElement('span');
        waitingEl.className = 'mac-welcome-waiting';
        waitingEl.setAttribute('aria-live', 'polite');
        waitingEl.textContent = 'Waiting for your action\u2026';

        const nextBtn = document.createElement('button');
        nextBtn.className = 'mac-button';
        nextBtn.type = 'button';

        footer.append(progressEl, waitingEl, nextBtn);
        content.append(bodyEl, footer);
        dialog.append(titlebar, content);
        overlay.append(dialog);
        document.body.appendChild(overlay);
        overlay.classList.add('mac-notification-overlay--visible');

        function getTutorialPlotState() {
            if (tutorialPlotIndex < 0) return null;
            const s = getState();
            return s.fields?.[s.activeFieldId]?.plotStates?.[tutorialPlotIndex] ?? null;
        }

        function clearPoll() {
            if (pollTimer != null) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }

        function dismiss() {
            cancelled = true;
            if (tutorialKeydownHandler) {
                document.removeEventListener('keydown', tutorialKeydownHandler, true);
                tutorialKeydownHandler = null;
            }
            clearPoll();
            removeAllHighlights();
            overlay.remove();
            resolve();
        }

        function setDialogMode(dialogMode) {
            if (dialogMode === 'floating') {
                overlay.classList.add('mac-tutorial-floating-mode');
                dialog.classList.add('mac-tutorial-floating');
            } else {
                overlay.classList.remove('mac-tutorial-floating-mode');
                dialog.classList.remove('mac-tutorial-floating');
            }
        }

        function buildCtx() {
            return {
                mode,
                openedWindows,
                getTutorialPlotIndex: () => tutorialPlotIndex,
                setTutorialPlotIndex: (i) => {
                    tutorialPlotIndex = i;
                },
                getTutorialPlotState,
                getInitialWheat: () => initialWheat,
                setInitialWheat: (v) => {
                    initialWheat = v;
                },
                messageEl,
            };
        }

        function renderStep(stepIndex) {
            const step = steps[stepIndex];
            const total = steps.length;
            const isLast = stepIndex === total - 1;

            sprite.src = isCurrentlyDark()
                ? './src/assets/farmr/farmr-sprite-DarkMode.gif'
                : './src/assets/farmr/farmr-sprite.gif';

            titleSpan.textContent = typeof step.title === 'function' ? step.title(mode) : step.title;

            const msg = typeof step.message === 'function' ? step.message(mode) : step.message;
            messageEl.textContent = msg;

            progressEl.textContent = `Step ${stepIndex + 1} of ${total}`;

            setDialogMode(step.dialogMode || 'overlay');

            const isWaitStep = Boolean(step.waitFor);
            nextBtn.style.display = isWaitStep ? 'none' : '';
            waitingEl.style.display = isWaitStep ? '' : 'none';

            if (!isWaitStep) {
                nextBtn.textContent = isLast ? "Let's Go!" : 'Next \u2192';
                queueMicrotask(() => nextBtn.focus());
            }
        }

        function advanceToStep(index) {
            clearPoll();
            removeAllHighlights();

            if (index >= steps.length) {
                dismiss();
                return;
            }

            currentIndex = index;
            const step = steps[index];
            const ctx = buildCtx();

            if (step.onEnter) step.onEnter(ctx);

            renderStep(index);

            if (step.waitFor) {
                pollTimer = setInterval(() => {
                    if (cancelled) {
                        clearPoll();
                        return;
                    }

                    const pollCtx = buildCtx();

                    if (step.liveMessage) {
                        const newMsg = step.liveMessage(pollCtx);
                        if (newMsg && newMsg !== messageEl.textContent) {
                            messageEl.textContent = newMsg;
                        }
                    }

                    if (step.waitFor(pollCtx)) {
                        if (step.onExit) step.onExit(pollCtx);
                        advanceToStep(currentIndex + 1);
                    }
                }, 300);
            }
        }

        nextBtn.addEventListener('click', () => {
            const step = steps[currentIndex];
            if (step.onExit) step.onExit(buildCtx());
            advanceToStep(currentIndex + 1);
        });

        closeBtn.addEventListener('click', dismiss);

        tutorialKeydownHandler = (event) => {
            if (!overlay.isConnected || !isSpaceOrEnterKey(event) || isTextEntryTarget(event.target)) {
                return;
            }

            event.preventDefault();

            const step = steps[currentIndex];
            if (!step || step.waitFor) {
                return;
            }

            if (step.onExit) step.onExit(buildCtx());
            advanceToStep(currentIndex + 1);
        };

        document.addEventListener('keydown', tutorialKeydownHandler, true);

        advanceToStep(0);
    });
}

export function setNetworkIconGlow(isGlowing) {
    const icon = getIconElement('desktop-icon-network');
    if (!icon) {
        return;
    }

    icon.classList.toggle('desktop-icon--netspace-glow', Boolean(isGlowing));
}

export async function showDesktopIconHint(options) {
    return showIconHint(options);
}

export async function runNetSpaceTutorial() {
    const world = getWorldState();
    const flags = getTutorialFlags(world);

    if (!world.netSpaceUnlocked || flags.netSpaceTutorialShown || netSpaceTutorialRunning) {
        return;
    }

    netSpaceTutorialRunning = true;

    try {
        const netspaceSpriteSrc = getNetSpaceTutorialSpriteSrc();

        setHighlightedSelectors(['#netspace-canvas'], true);
        await showFarmrDialog({
            title: 'Net-Space',
            message: 'Net-Space is the network tree that powers your next stage of farming. Click OK, then double-click NODE-01 on the map to open its overview.',
            spriteSrc: netspaceSpriteSrc,
        });

        setHighlightedSelectors(['#netspace-canvas'], false);

        const enteredNodeOverview = await waitForCondition(() => getCurrentScene().name === 'nodeOverview');
        if (!enteredNodeOverview) {
            await showFarmrDialog({
                title: 'Tutorial Paused',
                message: 'Net-Space onboarding timed out while waiting for Node Overview. Re-open Net-Space and run the tutorial again when ready.',
                buttons: [{ label: 'OK', value: true, autofocus: true }],
                spriteSrc: netspaceSpriteSrc,
            });
            return;
        }

        setHighlightedSelectors(['#node-overview-shell', '#node-overview-stats'], true);

        await showFarmrDialog({
            title: 'Node Overview',
            message: 'Welcome to NODE-01 overview. The left panel tracks your live node resources, and the right panel is your field snapshot for module tunnel operations.',
            spriteSrc: netspaceSpriteSrc,
        });

        setHighlightedSelectors(['#node-overview-stats'], false);
        setHighlightedSelectors(['#node-overview-field'], true);

        await showFarmrDialog({
            title: 'Field Snapshot',
            message: 'Each snapshot cell mirrors a real plot. Click an eligible crop plot button to open the module tunnel conversion prompt.',
            spriteSrc: netspaceSpriteSrc,
        });

        await showFarmrDialog({
            title: 'Module Tunnel',
            message: 'This is your module-tunnel step. Convert one owned crop plot into a module slot. That single slot is the base for your first Autofarmer.',
            buttons: [{ label: 'Got it', value: true, autofocus: true }],
            spriteSrc: netspaceSpriteSrc,
        });

        setHighlightedSelectors(['#node-overview-shell'], false);

        const hasTutorialModuleSlot = await waitForCondition(() => hasModuleSlot());
        if (!hasTutorialModuleSlot) {
            await showFarmrDialog({
                title: 'Tutorial Paused',
                message: 'We did not detect a module slot conversion in time. You can continue manually and replay the tutorial from Options later.',
                buttons: [{ label: 'OK', value: true, autofocus: true }],
                spriteSrc: netspaceSpriteSrc,
            });
            return;
        }

        await showFarmrDialog({
            title: 'Module Slot Online',
            message: 'Nice tunnel conversion. The new gear cell is your module slot control point. Open it to install the starter Autofarmer package.',
            spriteSrc: netspaceSpriteSrc,
        });

        await showFarmrDialog({
            title: 'Starter Autofarmer',
            message: 'Build your starter Autofarmer now. It runs on a fixed base profile while advanced upgrade trees are offline for a later systems pass.',
            buttons: [{ label: 'Understood', value: true, autofocus: true }],
            spriteSrc: netspaceSpriteSrc,
        });

        const hasStarterAutofarmer = await waitForCondition(() => hasAutofarmerInstalled());
        if (!hasStarterAutofarmer) {
            await showFarmrDialog({
                title: 'Tutorial Paused',
                message: 'Starter Autofarmer install was not detected in time. Continue building at your pace, then replay the tutorial if needed.',
                buttons: [{ label: 'OK', value: true, autofocus: true }],
                spriteSrc: netspaceSpriteSrc,
            });
            return;
        }

        await showFarmrDialog({
            title: 'Autofarmer Status',
            message: 'Your Autofarmer is active. Watch for slot status shifts when resources run low, and keep coins, water, and seeds stocked for smooth operation.',
            buttons: [{ label: 'Let\'s run it', value: true, autofocus: true }],
            spriteSrc: netspaceSpriteSrc,
        });

        setHighlightedSelectors(['#node-overview-field'], false);

        updateTutorialFlags({
            netSpaceTutorialShown: true,
            additionalAutofarmersUnlocked: false,
        });
    } finally {
        setHighlightedSelectors(['#netspace-canvas', '#node-overview-shell', '#node-overview-field'], false);
        setNetworkIconGlow(false);
        netSpaceTutorialRunning = false;
    }
}

export function showWelcomeMessage() {
    return runTutorial('new-game');
}

export function showReplayTutorial() {
    return runTutorial('replay');
}