// src/js/darkMode.js

import { isAudioEnabled, toggleAudioEnabled } from './sfx.js';
import { initializeKeybindsWindow, showKeybindsWindow } from './keybinds.js';

const STORAGE_KEY = 'colorScheme';

function isCurrentlyDark() {
    if (document.body.classList.contains('dark')) return true;
    if (document.body.classList.contains('light')) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function updateButtonIcon(btn) {
    if (isCurrentlyDark()) {
        btn.textContent = '☼';
        btn.setAttribute('aria-label', 'Switch to light mode');
        btn.setAttribute('title', 'Switch to light mode');
    } else {
        btn.textContent = '☽';
        btn.setAttribute('aria-label', 'Switch to dark mode');
        btn.setAttribute('title', 'Switch to dark mode');
    }
}

function applyStoredPreference() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark') {
        document.body.classList.add('dark');
        document.body.classList.remove('light');
    } else if (stored === 'light') {
        document.body.classList.add('light');
        document.body.classList.remove('dark');
    }
    // null → no class added; CSS media query handles it natively
}

function initializeDarkModeToggle() {
    applyStoredPreference();

    const btn = document.getElementById('dark-mode-toggle');
    if (!btn) return;

    updateButtonIcon(btn);

    btn.addEventListener('click', () => {
        if (isCurrentlyDark()) {
            document.body.classList.remove('dark');
            document.body.classList.add('light');
            localStorage.setItem(STORAGE_KEY, 'light');
        } else {
            document.body.classList.remove('light');
            document.body.classList.add('dark');
            localStorage.setItem(STORAGE_KEY, 'dark');
        }
        updateButtonIcon(btn);
    });

    // Keep icon in sync if OS preference changes and user has no stored override
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (!localStorage.getItem(STORAGE_KEY)) {
            updateButtonIcon(btn);
        }
    });
}

function updateAudioButtonIcon(btn) {
    if (isAudioEnabled()) {
        btn.textContent = '♪';
        btn.setAttribute('aria-label', 'Turn audio off');
        btn.setAttribute('title', 'Turn audio off');
        return;
    }

    btn.textContent = '✖';
    btn.setAttribute('aria-label', 'Turn audio on');
    btn.setAttribute('title', 'Turn audio on');
}

function initializeAudioToggle() {
    const btn = document.getElementById('audio-toggle');
    if (!btn) return;

    updateAudioButtonIcon(btn);

    btn.addEventListener('click', () => {
        toggleAudioEnabled();
        updateAudioButtonIcon(btn);
    });
}

function initializeOptionsWindow() {
    const keybindsBtn = document.getElementById('keybinds-toggle');
    if (keybindsBtn) {
        keybindsBtn.addEventListener('click', () => {
            showKeybindsWindow();
        });
    }
}

initializeDarkModeToggle();
initializeAudioToggle();
initializeOptionsWindow();
initializeKeybindsWindow();

export { isCurrentlyDark };
