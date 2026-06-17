import { openDesktopWindow } from './desktopWindowManager.js';

const TEXT_SCALE_STORAGE_KEY = 'textScalePx';
const DEFAULT_TEXT_SCALE = 12;
const MIN_TEXT_SCALE = 10;
const MAX_TEXT_SCALE = 16;

function clampTextScale(value) {
    return Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, value));
}

function renderTextScaleValue(value) {
    const label = document.getElementById('text-scale-value');
    if (label) {
        label.textContent = `${value}px`;
    }
}

function applyTextScale(value) {
    const clampedValue = clampTextScale(value);
    document.documentElement.style.setProperty('--ui-text-scale', `${clampedValue}px`);
    localStorage.setItem(TEXT_SCALE_STORAGE_KEY, String(clampedValue));
    renderTextScaleValue(clampedValue);
    return clampedValue;
}

function getStoredTextScale() {
    const storedValue = Number(localStorage.getItem(TEXT_SCALE_STORAGE_KEY));
    if (!Number.isFinite(storedValue)) {
        return DEFAULT_TEXT_SCALE;
    }

    return clampTextScale(storedValue);
}

function initializeTextScale() {
    const openButton = document.getElementById('text-scale-toggle');
    const decreaseButton = document.getElementById('text-scale-decrease');
    const increaseButton = document.getElementById('text-scale-increase');

    const initialValue = applyTextScale(getStoredTextScale());
    renderTextScaleValue(initialValue);

    if (openButton) {
        openButton.addEventListener('click', () => {
            openDesktopWindow('mac-window-textscale');
        });
    }

    if (decreaseButton) {
        decreaseButton.addEventListener('click', () => {
            applyTextScale(getStoredTextScale() - 1);
        });
    }

    if (increaseButton) {
        increaseButton.addEventListener('click', () => {
            applyTextScale(getStoredTextScale() + 1);
        });
    }
}

export { initializeTextScale };