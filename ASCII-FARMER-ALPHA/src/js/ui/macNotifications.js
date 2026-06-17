import { bindAudioContextWarmup, loadAudioBuffer, playAudioBuffer } from './audioEngine.js';

const notificationQueue = [];
let activeNotification = null;
let overlayEl = null;
let _activeTheme = 'desktop';
let activeKeydownHandler = null;
let activeDialogFocus = null;

const CATEGORY_SOUNDS = {
    achievement: 1,
    unlock: 2,
    error: 3,
    quest: 4,
    success: 5,
    warning: 6,
};

const notificationBuffers = new Map();

async function preloadNotificationSounds() {
    const uniqueSoundIndexes = [...new Set(Object.values(CATEGORY_SOUNDS))];
    for (const soundIndex of uniqueSoundIndexes) {
        const url = `./src/assets/Notification Sounds/Notif${soundIndex}.wav`;
        const buffer = await loadAudioBuffer(url);
        if (buffer) {
            notificationBuffers.set(soundIndex, buffer);
        }
    }
}

function playNotificationSound(category = 'error') {
    const soundIndex = CATEGORY_SOUNDS[category] ?? CATEGORY_SOUNDS.error;
    const buffer = notificationBuffers.get(soundIndex);
    playAudioBuffer(buffer, 1);
}

preloadNotificationSounds();
bindAudioContextWarmup();

function ensureOverlay() {
    if (overlayEl && document.body.contains(overlayEl)) {
        return overlayEl;
    }

    overlayEl = document.createElement('div');
    overlayEl.id = 'mac-notification-overlay';
    overlayEl.className = 'mac-notification-overlay';
    document.body.appendChild(overlayEl);
    return overlayEl;
}

function createWindowTitlebar(title, onClose) {
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

function createDialogShell(title, onClose, options = {}) {
    const {
        dialogClassName = '',
        contentClassName = '',
    } = options;

    const dialog = document.createElement('div');
    dialog.className = `mac-window mac-dialog-window ${dialogClassName}`.trim();
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', title);

    const titlebar = createWindowTitlebar(title, onClose);

    const content = document.createElement('div');
    content.className = `mac-dialog-content ${contentClassName}`.trim();

    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'mac-button-group';

    content.append(buttonGroup);
    dialog.append(titlebar, content);

    return {
        dialog,
        content,
        buttonGroup,
    };
}

function dismissActiveNotification(result) {
    if (!activeNotification) {
        return;
    }

    const { resolve, onConfirm, onCancel } = activeNotification;
    const wasConfirmed = result === true;

    if (overlayEl) {
        overlayEl.classList.remove('mac-notification-overlay--visible');
        overlayEl.replaceChildren();
    }

    if (activeKeydownHandler) {
        document.removeEventListener('keydown', activeKeydownHandler, true);
        activeKeydownHandler = null;
    }

    const previousFocusedEl = activeDialogFocus?.previouslyFocusedEl;
    if (previousFocusedEl instanceof HTMLElement && previousFocusedEl.isConnected) {
        queueMicrotask(() => {
            previousFocusedEl.focus();
        });
    }
    activeDialogFocus = null;

    if (wasConfirmed) {
        if (typeof onConfirm === 'function') {
            onConfirm();
        }
    } else if (typeof onCancel === 'function') {
        onCancel();
    }

    if (typeof resolve === 'function') {
        resolve(result);
    }

    activeNotification = null;
    showNextNotification();
}

function createButton(label, onClick, autofocus = false) {
    const button = document.createElement('button');
    button.className = 'mac-button';
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);

    if (autofocus) {
        queueMicrotask(() => button.focus());
    }

    return button;
}

function createMessageElement(message) {
    const messageEl = document.createElement('p');
    messageEl.className = 'mac-dialog-message';
    messageEl.textContent = message;
    return messageEl;
}

function shouldIgnoreSpaceShortcut(target) {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    const tagName = target.tagName;
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || target.isContentEditable;
}

function getSpacebarDismissButton(dialog) {
    if (!(dialog instanceof HTMLElement)) {
        return null;
    }

    const activeEl = document.activeElement;
    if (activeEl instanceof HTMLButtonElement && dialog.contains(activeEl)) {
        return activeEl;
    }

    return dialog.querySelector('.mac-button:last-of-type');
}

function isSpaceKey(event) {
    return event.key === ' ' || event.key === 'Space' || event.key === 'Spacebar';
}

function isTabKey(event) {
    return event.key === 'Tab';
}

function isEscapeKey(event) {
    return event.key === 'Escape' || event.key === 'Esc';
}

function getFocusableDialogElements(dialog) {
    if (!(dialog instanceof HTMLElement)) {
        return [];
    }

    return Array.from(dialog.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((el) => el instanceof HTMLElement && !el.hasAttribute('disabled'));
}

function trapFocusWithinDialog(event, dialog) {
    const focusableElements = getFocusableDialogElements(dialog);
    if (focusableElements.length === 0) {
        return;
    }

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    const activeEl = document.activeElement;

    if (!(activeEl instanceof HTMLElement) || !dialog.contains(activeEl)) {
        event.preventDefault();
        first.focus();
        return;
    }

    if (event.shiftKey && activeEl === first) {
        event.preventDefault();
        last.focus();
        return;
    }

    if (!event.shiftKey && activeEl === last) {
        event.preventDefault();
        first.focus();
    }
}

function showNextNotification() {
    if (activeNotification || notificationQueue.length === 0) {
        return;
    }

    activeNotification = notificationQueue.shift();

    const {
        title,
        message,
        type,
        category,
        body,
        buttons,
        dialogClassName,
        contentClassName,
        closeValue,
    } = activeNotification;

    const defaultCloseValue = closeValue ?? (type === 'confirmation' ? false : true);
    const onClose = () => dismissActiveNotification(defaultCloseValue);
    const { dialog, content, buttonGroup } = createDialogShell(title, onClose, {
        dialogClassName,
        contentClassName,
    });

    activeDialogFocus = {
        previouslyFocusedEl: document.activeElement,
    };

    if (body instanceof HTMLElement) {
        content.prepend(body);
    } else if (typeof message === 'string' && message.length > 0) {
        content.prepend(createMessageElement(message));
    }

    if (Array.isArray(buttons) && buttons.length > 0) {
        buttons.forEach((buttonConfig, index) => {
            const button = createButton(
                buttonConfig.label,
                () => dismissActiveNotification(buttonConfig.value),
                Boolean(buttonConfig.autofocus ?? index === 0),
            );

            if (buttonConfig.className) {
                button.classList.add(buttonConfig.className);
            }

            buttonGroup.appendChild(button);
        });
    } else if (type === 'confirmation') {
        const cancelBtn = createButton('Cancel', () => dismissActiveNotification(false));
        const okBtn = createButton('OK', () => dismissActiveNotification(true), true);
        buttonGroup.append(cancelBtn, okBtn);
    } else {
        const okBtn = createButton('OK', () => dismissActiveNotification(true), true);
        buttonGroup.append(okBtn);
    }

    const overlay = ensureOverlay();
    overlay.replaceChildren(dialog);
    overlay.classList.toggle('mac-notification-overlay--theme-netspace', _activeTheme === 'netspace');
    overlay.classList.add('mac-notification-overlay--visible');

    if (activeKeydownHandler) {
        document.removeEventListener('keydown', activeKeydownHandler, true);
        activeKeydownHandler = null;
    }

    activeKeydownHandler = (event) => {
        if (!activeNotification) {
            return;
        }

        if (isEscapeKey(event)) {
            event.preventDefault();
            dismissActiveNotification(defaultCloseValue);
            return;
        }

        if (isTabKey(event)) {
            trapFocusWithinDialog(event, dialog);
            return;
        }

        if (!isSpaceKey(event)) {
            return;
        }

        if (shouldIgnoreSpaceShortcut(event.target)) {
            return;
        }

        if (!overlayEl || !overlayEl.classList.contains('mac-notification-overlay--visible')) {
            return;
        }

        const dismissButton = getSpacebarDismissButton(dialog);
        if (!dismissButton || dismissButton.disabled) {
            return;
        }

        event.preventDefault();
        dismissButton.click();
    };

    document.addEventListener('keydown', activeKeydownHandler, true);

    playNotificationSound(category);
}

function enqueueNotification(notification) {
    notificationQueue.push(notification);
    showNextNotification();
}

export function showNotification(message, title = 'Notification', category = 'error') {
    return new Promise((resolve) => {
        enqueueNotification({
            type: 'notification',
            title,
            message,
            category,
            resolve,
        });
    });
}

export function showConfirmation(message, options = {}) {
    const {
        title = 'Confirm',
        category = 'warning',
        onConfirm,
        onCancel,
    } = options;

    return new Promise((resolve) => {
        enqueueNotification({
            type: 'confirmation',
            title,
            message,
            category,
            onConfirm,
            onCancel,
            resolve,
        });
    });
}

export function setNotificationTheme(theme) {
    _activeTheme = theme;
}

export function showDialog(options = {}) {
    const {
        title = 'Notification',
        category = 'success',
        message = '',
        body = null,
        buttons = null,
        dialogClassName = '',
        contentClassName = '',
        closeValue = true,
    } = options;

    return new Promise((resolve) => {
        enqueueNotification({
            type: 'custom',
            title,
            category,
            message,
            body,
            buttons,
            dialogClassName,
            contentClassName,
            closeValue,
            resolve,
        });
    });
}