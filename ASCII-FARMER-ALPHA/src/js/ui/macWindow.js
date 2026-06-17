// src/js/ui/macWindow.js
// Wraps game section containers in Mac System 6-style window chrome.

const WINDOW_COLLAPSE_STORAGE_PREFIX = 'macWindowCollapsed:';

function getWindowCollapseStorageKey(windowId) {
    return `${WINDOW_COLLAPSE_STORAGE_PREFIX}${windowId}`;
}

/**
 * wrapInMacWindow(titleEl, contentEl)
 *
 * Replaces `titleEl` in the DOM with a Mac-style window:
 *
 *   div.mac-window
 *     div.mac-titlebar
 *       button.mac-close-btn   ← collapses/expands content
 *       span.mac-title         ← centered title text
 *       button.mac-zoom-btn    ← visual-only zoom box
 *     div.mac-content          ← CSS grid-row collapse wrapper
 *       div.mac-content-inner  ← overflow:hidden inner shell
 *         contentEl            ← original content section
 *
 * @param {HTMLElement} titleEl   - The .container-title element (removed from DOM)
 * @param {HTMLElement} contentEl - The sibling content section to move inside the window
 */
export function wrapInMacWindow(titleEl, contentEl) {
    const titleText = titleEl.textContent.trim();
    const windowId = `mac-window-${contentEl.id}`;

    // Outer window shell
    const macWindow = document.createElement('div');
    macWindow.classList.add('mac-window');
    macWindow.id = windowId;

    // Title bar
    const titlebar = document.createElement('div');
    titlebar.classList.add('mac-titlebar');

    const closeBtn = document.createElement('button');
    closeBtn.classList.add('mac-close-btn');
    closeBtn.setAttribute('aria-label', `Collapse ${titleText}`);
    closeBtn.setAttribute('type', 'button');
    closeBtn.setAttribute('title', `Collapse ${titleText}`);

    const titleSpan = document.createElement('span');
    titleSpan.classList.add('mac-title');
    titleSpan.textContent = titleText;

    titlebar.appendChild(closeBtn);
    titlebar.appendChild(titleSpan);

    // Collapsible content wrapper (CSS grid trick for smooth animation)
    const macContent = document.createElement('div');
    macContent.classList.add('mac-content');

    const macContentInner = document.createElement('div');
    macContentInner.classList.add('mac-content-inner');

    macContentInner.appendChild(contentEl);
    macContent.appendChild(macContentInner);

    macWindow.appendChild(titlebar);
    macWindow.appendChild(macContent);

    // Replace the title element in the DOM with the whole window
    titleEl.replaceWith(macWindow);

    // Main game windows are expanded by default (first launch = no stored key).
    const collapseStorageKey = getWindowCollapseStorageKey(windowId);
    const storedCollapsedState = localStorage.getItem(collapseStorageKey);
    const isInitiallyCollapsed = storedCollapsedState === 'true';

    macContent.classList.toggle('mac-content--collapsed', isInitiallyCollapsed);
    macWindow.classList.toggle('mac-window--collapsed', isInitiallyCollapsed);
    closeBtn.setAttribute('aria-label', isInitiallyCollapsed ? `Expand ${titleText}` : `Collapse ${titleText}`);
    closeBtn.setAttribute('title', isInitiallyCollapsed ? `Expand ${titleText}` : `Collapse ${titleText}`);

    // Collapse / expand toggle
    closeBtn.addEventListener('click', () => {
        const isCollapsed = macContent.classList.toggle('mac-content--collapsed');
        macWindow.classList.toggle('mac-window--collapsed', isCollapsed);
        closeBtn.setAttribute(
            'aria-label',
            isCollapsed ? `Expand ${titleText}` : `Collapse ${titleText}`
        );
        closeBtn.setAttribute('title', isCollapsed ? `Expand ${titleText}` : `Collapse ${titleText}`);
        localStorage.setItem(collapseStorageKey, isCollapsed ? 'true' : 'false');
    });
}

/**
 * wrapSectionsInMacWindows()
 *
 * Finds every .container-title inside <main> and wraps it + its next sibling
 * in Mac window chrome. Call this once, after all sections are initialized.
 */
export function wrapSectionsInMacWindows() {
    const titleElements = document.querySelectorAll('main .container-title');
    titleElements.forEach((titleEl) => {
        const contentEl = titleEl.nextElementSibling;
        if (contentEl && !titleEl.closest('.mac-window')) {
            wrapInMacWindow(titleEl, contentEl);
        }
    });
}
