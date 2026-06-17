const WINDOW_POSITION_STORAGE_PREFIX = 'desktopWindowPosition:';
const WINDOW_SIZE_STORAGE_PREFIX = 'desktopWindowSize:';
const WINDOW_OPEN_ANIMATION_MS = 210;

const registeredWindows = new Map();

let desktopHost = null;
let desktopShell = null;
let desktopWorkspace = null;
let selectedIconId = null;
let nextZIndex = 100;
let activeOpenAnimations = new Map();

function getPositionStorageKey(windowId) {
    return `${WINDOW_POSITION_STORAGE_PREFIX}${windowId}`;
}

function getSizeStorageKey(windowId) {
    return `${WINDOW_SIZE_STORAGE_PREFIX}${windowId}`;
}

function getWorkspaceBounds() {
    const workspaceRect = desktopWorkspace?.getBoundingClientRect();
    return {
        width: workspaceRect?.width || window.innerWidth,
        height: workspaceRect?.height || window.innerHeight,
    };
}

function getWindowMinimumSize(windowEl) {
    const computedStyles = window.getComputedStyle(windowEl);
    return {
        width: Math.max(0, Math.ceil(parseFloat(computedStyles.minWidth) || 0)),
        height: Math.max(0, Math.ceil(parseFloat(computedStyles.minHeight) || 0)),
    };
}

function getWindowFittedSize(windowEl) {
    return {
        width: Math.max(0, Math.ceil(Number(windowEl?.dataset?.fittedWidth) || 0)),
        height: Math.max(0, Math.ceil(Number(windowEl?.dataset?.fittedHeight) || 0)),
    };
}

function clampWindowSize(windowEl, x, y, width, height) {
    const workspaceBounds = getWorkspaceBounds();
    const minimumSize = getWindowMinimumSize(windowEl);
    const maxWidth = Math.max(minimumSize.width, workspaceBounds.width - Math.max(8, x) - 12);
    const maxHeight = Math.max(minimumSize.height, workspaceBounds.height - Math.max(32, y) - 12);

    return {
        width: Math.min(Math.max(minimumSize.width, Math.round(width)), Math.round(maxWidth)),
        height: Math.min(Math.max(minimumSize.height, Math.round(height)), Math.round(maxHeight)),
    };
}

function normalizeWindowResizeTarget(windowEl, x, y, width, height) {
    const clampedSize = clampWindowSize(windowEl, x, y, width, height);
    const fittedSize = getWindowFittedSize(windowEl);
    if (!fittedSize.width || !fittedSize.height) {
        return clampedSize;
    }

    const deltaWidth = Math.abs(clampedSize.width - fittedSize.width);
    const deltaHeight = Math.abs(clampedSize.height - fittedSize.height);
    const prefersWidth = deltaWidth >= deltaHeight;
    const axisScale = prefersWidth
        ? (clampedSize.width / Math.max(1, fittedSize.width))
        : (clampedSize.height / Math.max(1, fittedSize.height));

    return clampWindowSize(
        windowEl,
        x,
        y,
        fittedSize.width * axisScale,
        fittedSize.height * axisScale,
    );
}

function getResizeAspectRatio(windowEl, fallbackWidth, fallbackHeight) {
    const datasetRatio = Number(windowEl?.dataset?.lockedAspectRatio);
    if (Number.isFinite(datasetRatio) && datasetRatio > 0) {
        return datasetRatio;
    }

    return Math.max(0.1, fallbackWidth / Math.max(1, fallbackHeight));
}

function resizeWithLockedAspectRatio(windowEl, x, y, baseWidth, baseHeight, targetWidth, targetHeight, aspectRatio) {
    const widthScale = targetWidth / Math.max(1, baseWidth);
    const heightScale = targetHeight / Math.max(1, baseHeight);
    const scale = Math.max(0.1, Math.abs(widthScale - 1) >= Math.abs(heightScale - 1) ? widthScale : heightScale);

    return clampWindowSize(
        windowEl,
        x,
        y,
        baseWidth * scale,
        (baseWidth * scale) / Math.max(0.1, aspectRatio),
    );
}

function clampPosition(windowEl, x, y) {
    const workspaceBounds = getWorkspaceBounds();
    const windowRect = windowEl.getBoundingClientRect();
    const maxX = Math.max(8, workspaceBounds.width - windowRect.width - 12);
    const maxY = Math.max(32, workspaceBounds.height - windowRect.height - 12);

    return {
        x: Math.min(Math.max(8, x), maxX),
        y: Math.min(Math.max(32, y), maxY),
    };
}

function persistWindowPosition(windowId, x, y) {
    localStorage.setItem(getPositionStorageKey(windowId), JSON.stringify({ x, y }));
}

function persistWindowSize(windowId, width, height) {
    localStorage.setItem(getSizeStorageKey(windowId), JSON.stringify({ width, height }));
}

function restoreWindowPosition(windowId, fallbackX, fallbackY) {
    const stored = localStorage.getItem(getPositionStorageKey(windowId));
    if (!stored) {
        return { x: fallbackX, y: fallbackY };
    }

    try {
        const parsed = JSON.parse(stored);
        return {
            x: Number(parsed?.x) || fallbackX,
            y: Number(parsed?.y) || fallbackY,
        };
    } catch {
        return { x: fallbackX, y: fallbackY };
    }
}

function restoreWindowSize(windowId, fallbackWidth, fallbackHeight) {
    const stored = localStorage.getItem(getSizeStorageKey(windowId));
    if (!stored) {
        return { width: fallbackWidth, height: fallbackHeight };
    }

    try {
        const parsed = JSON.parse(stored);
        return {
            width: Number(parsed?.width) || fallbackWidth,
            height: Number(parsed?.height) || fallbackHeight,
        };
    } catch {
        return { width: fallbackWidth, height: fallbackHeight };
    }
}

function applyWindowSize(windowEl, width, height) {
    windowEl.style.width = `${Math.max(0, Math.round(width))}px`;
    windowEl.style.height = `${Math.max(0, Math.round(height))}px`;
}

function notifyWindowLayoutChanged(windowEl) {
    if (!(windowEl instanceof HTMLElement)) {
        return;
    }

    windowEl.dispatchEvent(new CustomEvent('desktopwindowlayoutchange'));
}

function withInstantIconTransition(iconEl, callback) {
    if (!iconEl) {
        callback();
        return;
    }

    const transitionTargets = iconEl.querySelectorAll('.desktop-icon-glyph, .desktop-icon-label');

    transitionTargets.forEach((target) => {
        target.style.transition = 'none';
    });

    // Force the transition override to apply before toggling the selected state.
    void iconEl.offsetWidth;
    callback();
    void iconEl.offsetWidth;

    window.requestAnimationFrame(() => {
        transitionTargets.forEach((target) => {
            target.style.removeProperty('transition');
        });
    });
}

function setSelectedIcon(iconId) {
    const previousIconEl = selectedIconId ? document.getElementById(selectedIconId) : null;
    const nextIconEl = iconId ? document.getElementById(iconId) : null;

    withInstantIconTransition(previousIconEl, () => {
        if (previousIconEl && selectedIconId !== iconId) {
            previousIconEl.classList.remove('is-selected');
        }
    });

    selectedIconId = iconId || null;

    withInstantIconTransition(nextIconEl, () => {
        if (nextIconEl && selectedIconId) {
            nextIconEl.classList.add('is-selected');
        }
    });
}

function replaceCloseButton(windowEl, onClose) {
    const currentButton = windowEl.querySelector('.mac-close-btn');
    if (!currentButton) {
        return;
    }

    const replacement = currentButton.cloneNode(true);
    currentButton.replaceWith(replacement);
    replacement.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
    });
}

function focusDesktopWindow(windowId) {
    const entry = registeredWindows.get(windowId);
    if (!entry) {
        return;
    }

    entry.windowEl.style.zIndex = String(nextZIndex++);
    registeredWindows.forEach((windowEntry, candidateId) => {
        windowEntry.windowEl.classList.toggle('is-active', candidateId === windowId);
    });

    if (entry.iconId) {
        setSelectedIcon(entry.iconId);
    }
}

function closeDesktopWindow(windowId) {
    const entry = registeredWindows.get(windowId);
    if (!entry) {
        return;
    }

    cancelOpenAnimation(windowId);

    entry.windowEl.classList.remove('is-open');
    entry.windowEl.style.display = 'none';
}

function isDesktopWindowOpen(windowId) {
    const entry = registeredWindows.get(windowId);
    if (!entry) {
        return false;
    }

    return entry.windowEl.classList.contains('is-open') || activeOpenAnimations.has(windowId);
}

function getLaunchSourceRect(entry) {
    if (!entry?.iconId) {
        return null;
    }

    const iconEl = document.getElementById(entry.iconId);
    if (!iconEl || iconEl.classList.contains('desktop-icon--hidden')) {
        return null;
    }

    const rect = iconEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return null;
    }

    return rect;
}

function measureWindowRect(windowEl) {
    const previousDisplay = windowEl.style.display;
    const previousVisibility = windowEl.style.visibility;
    const previousPointerEvents = windowEl.style.pointerEvents;

    windowEl.style.visibility = 'hidden';
    windowEl.style.pointerEvents = 'none';
    windowEl.style.display = 'block';

    const rect = windowEl.getBoundingClientRect();

    windowEl.style.display = previousDisplay;
    windowEl.style.visibility = previousVisibility;
    windowEl.style.pointerEvents = previousPointerEvents;

    if (rect.width <= 0 || rect.height <= 0) {
        return null;
    }

    return rect;
}

function revealWindow(entry, windowId) {
    entry.windowEl.classList.add('is-open');
    entry.windowEl.style.display = 'block';
    notifyWindowLayoutChanged(entry.windowEl);
    focusDesktopWindow(windowId);
}

function shouldAnimateLaunch(sourceRect, targetRect) {
    if (!sourceRect || !targetRect) {
        return false;
    }

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        return false;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const sourceVisible =
        sourceRect.right >= 0 &&
        sourceRect.bottom >= 0 &&
        sourceRect.left <= viewportWidth &&
        sourceRect.top <= viewportHeight;

    return sourceVisible;
}

function cancelOpenAnimation(windowId) {
    const active = activeOpenAnimations.get(windowId);
    if (!active) {
        return;
    }

    window.clearTimeout(active.timerId);
    active.ghostEl.remove();
    activeOpenAnimations.delete(windowId);
}

function animateOpenFromIcon(windowId, entry, sourceRect, targetRect) {
    const host = desktopWorkspace || document.body;
    if (!host) {
        revealWindow(entry, windowId);
        return;
    }

    cancelOpenAnimation(windowId);

    const hostRect = host.getBoundingClientRect();
    const ghostEl = document.createElement('div');
    ghostEl.className = 'desktop-window-launch-ghost';
    ghostEl.style.left = `${sourceRect.left - hostRect.left}px`;
    ghostEl.style.top = `${sourceRect.top - hostRect.top}px`;
    ghostEl.style.width = `${sourceRect.width}px`;
    ghostEl.style.height = `${sourceRect.height}px`;

    host.appendChild(ghostEl);

    // Force style flush so transition starts from icon bounds.
    void ghostEl.offsetWidth;

    ghostEl.style.left = `${targetRect.left - hostRect.left}px`;
    ghostEl.style.top = `${targetRect.top - hostRect.top}px`;
    ghostEl.style.width = `${targetRect.width}px`;
    ghostEl.style.height = `${targetRect.height}px`;
    ghostEl.classList.add('desktop-window-launch-ghost--active');

    const timerId = window.setTimeout(() => {
        ghostEl.remove();
        activeOpenAnimations.delete(windowId);
        revealWindow(entry, windowId);
    }, WINDOW_OPEN_ANIMATION_MS);

    activeOpenAnimations.set(windowId, {
        timerId,
        ghostEl,
    });
}

function openDesktopWindow(windowId) {
    const entry = registeredWindows.get(windowId);
    if (!entry) {
        return;
    }

    if (entry.windowEl.classList.contains('is-open')) {
        focusDesktopWindow(windowId);
        return;
    }

    const sourceRect = getLaunchSourceRect(entry);
    const targetRect = measureWindowRect(entry.windowEl);

    if (shouldAnimateLaunch(sourceRect, targetRect)) {
        animateOpenFromIcon(windowId, entry, sourceRect, targetRect);
        return;
    }

    revealWindow(entry, windowId);
}

function toggleDesktopWindow(windowId) {
    if (isDesktopWindowOpen(windowId)) {
        closeDesktopWindow(windowId);
        return;
    }

    openDesktopWindow(windowId);
}

function ensureResizeHandle(windowEl) {
    let resizeHandle = windowEl.querySelector('.desktop-window-resize-handle');
    if (resizeHandle) {
        return resizeHandle;
    }

    resizeHandle = document.createElement('button');
    resizeHandle.className = 'desktop-window-resize-handle';
    resizeHandle.type = 'button';
    resizeHandle.setAttribute('aria-label', 'Resize window');
    resizeHandle.setAttribute('title', 'Resize window');
    windowEl.appendChild(resizeHandle);
    return resizeHandle;
}

function wireDrag(windowId, windowEl) {
    const titlebar = windowEl.querySelector('.mac-titlebar');
    if (!titlebar) {
        return;
    }

    titlebar.addEventListener('pointerdown', (event) => {
        if (event.target.closest('button, select, input, textarea, label')) {
            return;
        }

        focusDesktopWindow(windowId);

        const rect = windowEl.getBoundingClientRect();
        const startOffsetX = event.clientX - rect.left;
        const startOffsetY = event.clientY - rect.top;

        windowEl.classList.add('is-dragging');
        titlebar.setPointerCapture(event.pointerId);

        const handlePointerMove = (moveEvent) => {
            const nextPosition = clampPosition(windowEl, moveEvent.clientX - startOffsetX, moveEvent.clientY - startOffsetY);
            windowEl.style.left = `${nextPosition.x}px`;
            windowEl.style.top = `${nextPosition.y}px`;
        };

        const handlePointerUp = () => {
            titlebar.removeEventListener('pointermove', handlePointerMove);
            titlebar.removeEventListener('pointerup', handlePointerUp);
            titlebar.removeEventListener('pointercancel', handlePointerUp);
            windowEl.classList.remove('is-dragging');
            persistWindowPosition(windowId, parseFloat(windowEl.style.left), parseFloat(windowEl.style.top));
        };

        titlebar.addEventListener('pointermove', handlePointerMove);
        titlebar.addEventListener('pointerup', handlePointerUp);
        titlebar.addEventListener('pointercancel', handlePointerUp);
    });
}

function wireResize(windowId, windowEl) {
    const resizeHandle = ensureResizeHandle(windowEl);
    if (!resizeHandle) {
        return;
    }

    resizeHandle.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        focusDesktopWindow(windowId);

        const startRect = windowEl.getBoundingClientRect();
        const startWidth = startRect.width;
        const startHeight = startRect.height;
        const startX = event.clientX;
        const startY = event.clientY;
        const currentLeft = parseFloat(windowEl.style.left) || 0;
        const currentTop = parseFloat(windowEl.style.top) || 0;
        const aspectRatio = getResizeAspectRatio(windowEl, startWidth, startHeight);

        windowEl.classList.add('is-resizing');
        resizeHandle.setPointerCapture(event.pointerId);

        const handlePointerMove = (moveEvent) => {
            const nextSize = resizeWithLockedAspectRatio(
                windowEl,
                currentLeft,
                currentTop,
                startWidth,
                startHeight,
                startWidth + (moveEvent.clientX - startX),
                startHeight + (moveEvent.clientY - startY),
                aspectRatio,
            );
            applyWindowSize(windowEl, nextSize.width, nextSize.height);
            notifyWindowLayoutChanged(windowEl);
        };

        const cleanupResize = () => {
            resizeHandle.removeEventListener('pointermove', handlePointerMove);
            resizeHandle.removeEventListener('pointerup', cleanupResize);
            resizeHandle.removeEventListener('pointercancel', cleanupResize);
            resizeHandle.removeEventListener('lostpointercapture', cleanupResize);
            windowEl.classList.remove('is-resizing');
            windowEl.classList.remove('desktop-window--resize-hint');

            notifyWindowLayoutChanged(windowEl);

            const nextRect = windowEl.getBoundingClientRect();
            persistWindowSize(windowId, nextRect.width, nextRect.height);
        };

        resizeHandle.addEventListener('pointermove', handlePointerMove);
        resizeHandle.addEventListener('pointerup', cleanupResize);
        resizeHandle.addEventListener('pointercancel', cleanupResize);
        resizeHandle.addEventListener('lostpointercapture', cleanupResize);
    });
}

function registerIcon(iconEl) {
    const targetWindowId = iconEl.dataset.windowId;
    if (!targetWindowId) {
        return;
    }

    iconEl.addEventListener('click', () => {
        setSelectedIcon(iconEl.id);
    });

    iconEl.addEventListener('dblclick', () => {
        toggleDesktopWindow(targetWindowId);
    });
}

function initializeMenuButtons() {
    const optionsButton = document.getElementById('desktop-menu-options');
    if (optionsButton) {
        optionsButton.addEventListener('click', () => {
            toggleDesktopWindow('mac-window-options');
        });
    }
}

function moveWindowIntoDesktop(windowEl) {
    if (!desktopHost || desktopHost.contains(windowEl)) {
        return;
    }

    desktopHost.appendChild(windowEl);
}

function registerDesktopWindow(windowId, options = {}) {
    const windowEl = document.getElementById(windowId);
    if (!windowEl) {
        return null;
    }

    moveWindowIntoDesktop(windowEl);
    windowEl.classList.add('desktop-window');

    const isResizable = Boolean(options.resizable);
    windowEl.classList.toggle('desktop-window--resizable', isResizable);

    if (isResizable) {
        const naturalRect = measureWindowRect(windowEl);
        const fallbackWidth = Math.max(0, Math.round(options.width ?? naturalRect?.width ?? 0));
        const fallbackHeight = Math.max(0, Math.round(options.height ?? naturalRect?.height ?? 0));
        const restoredSize = restoreWindowSize(windowId, fallbackWidth, fallbackHeight);
        const previewPosition = restoreWindowPosition(windowId, options.x ?? 32, options.y ?? 40);
        const clampedSize = clampWindowSize(windowEl, previewPosition.x, previewPosition.y, restoredSize.width, restoredSize.height);
        applyWindowSize(windowEl, clampedSize.width, clampedSize.height);
        persistWindowSize(windowId, clampedSize.width, clampedSize.height);
    }

    const startPosition = restoreWindowPosition(windowId, options.x ?? 32, options.y ?? 40);
    const clamped = clampPosition(windowEl, startPosition.x, startPosition.y);
    windowEl.style.left = `${clamped.x}px`;
    windowEl.style.top = `${clamped.y}px`;

    replaceCloseButton(windowEl, () => {
        closeDesktopWindow(windowId);
    });

    windowEl.addEventListener('pointerdown', () => {
        focusDesktopWindow(windowId);
    });

    wireDrag(windowId, windowEl);
    if (isResizable) {
        wireResize(windowId, windowEl);
    }

    const entry = {
        windowEl,
        iconId: options.iconId || null,
        resizable: isResizable,
    };

    registeredWindows.set(windowId, entry);

    if (options.open) {
        openDesktopWindow(windowId);
    } else {
        closeDesktopWindow(windowId);
    }

    return entry;
}

function showDesktopShell() {
    desktopShell?.classList.add('desktop-shell--visible');
}

function initializeDesktopWindowManager() {
    desktopHost = document.getElementById('desktop-secondary-windows');
    desktopShell = document.getElementById('desktop-shell');
    desktopWorkspace = document.getElementById('desktop-workspace');

    document.querySelectorAll('.desktop-icon').forEach((iconEl) => {
        registerIcon(iconEl);
    });

    initializeMenuButtons();

    desktopWorkspace?.addEventListener('pointerdown', (event) => {
        if (event.target.closest('.desktop-window, .desktop-icon, .desktop-menu-button')) {
            return;
        }

        setSelectedIcon(null);
    });

    window.addEventListener('resize', () => {
        registeredWindows.forEach((entry, windowId) => {
            if (entry.resizable) {
                const currentLeft = parseFloat(entry.windowEl.style.left) || 0;
                const currentTop = parseFloat(entry.windowEl.style.top) || 0;
                const currentRect = entry.windowEl.getBoundingClientRect();
                const aspectRatio = getResizeAspectRatio(entry.windowEl, currentRect.width, currentRect.height);
                const nextSize = resizeWithLockedAspectRatio(
                    entry.windowEl,
                    currentLeft,
                    currentTop,
                    currentRect.width,
                    currentRect.height,
                    currentRect.width,
                    currentRect.height,
                    aspectRatio,
                );
                applyWindowSize(entry.windowEl, nextSize.width, nextSize.height);
                persistWindowSize(windowId, nextSize.width, nextSize.height);
                notifyWindowLayoutChanged(entry.windowEl);
            }

            const currentLeft = parseFloat(entry.windowEl.style.left) || 0;
            const currentTop = parseFloat(entry.windowEl.style.top) || 0;
            const nextPosition = clampPosition(entry.windowEl, currentLeft, currentTop);
            entry.windowEl.style.left = `${nextPosition.x}px`;
            entry.windowEl.style.top = `${nextPosition.y}px`;
            persistWindowPosition(windowId, nextPosition.x, nextPosition.y);
        });
    });
}

export {
    closeDesktopWindow,
    focusDesktopWindow,
    initializeDesktopWindowManager,
    isDesktopWindowOpen,
    openDesktopWindow,
    registerDesktopWindow,
    setSelectedIcon,
    showDesktopShell,
    toggleDesktopWindow,
};