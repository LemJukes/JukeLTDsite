import { isCurrentlyDark } from './darkMode.js';

const INTRO_STORAGE_KEY = 'ambientFarmrIntroSeen';
const FARMR_WIDTH_PX = 96;
const FARMR_HEIGHT_PX = 96;
const MIN_IDLE_SEGMENT_MS = 1100;
const MAX_IDLE_SEGMENT_MS = 2600;
const RETURN_TRAVEL_RATIO = 0.125;
const INTRO_VISIT_MIN_DELAY_MS = 45_000;
const INTRO_VISIT_MAX_DELAY_MS = 90_000;
const VISIT_MIN_DELAY_MS = 4 * 60_000;
const VISIT_MAX_DELAY_MS = 7 * 60_000;
const VISIBILITY_RETRY_MIN_DELAY_MS = 45_000;
const VISIBILITY_RETRY_MAX_DELAY_MS = 90_000;
const WALK_PIXELS_PER_SECOND = 180;
const LATER_BUBBLE_CHANCE = 0.22;
const BUBBLE_MIN_MS = 5_000;
const BUBBLE_MAX_MS = 10_000;
const LEFT_ENTRY_EXTRA_TRAVEL_PX = 56;

const IDLE_SEQUENCE_PATTERNS = [
    ['stand', 'blink', 'stand'],
    ['stand', 'lookAround'],
    ['stand', 'lookAround', 'blink'],
    ['stand', 'blink', 'stand', 'lookAround'],
];

const ENCOURAGEMENT_MESSAGES = [
    "Keep going. You're doing great!",
    'Oh, one more harvest never hurts, right?',
    'Nice pace. Keep those plots moving.',
    'Hey nice crops!',
    'Thats a good lookin field you got goin there!',
    'Those seeds sure are thirsty!',
    'Looking good! The harvest is gonna be great.',
];

const ANIMATION_ASSETS = {
    light: {
        stand: './src/assets/farmr/Desktop Animations/Farmr - Stand.gif',
        blink: './src/assets/farmr/Desktop Animations/Farmr - Blink.gif',
        lookAround: './src/assets/farmr/Desktop Animations/Farmr - Walk Cycle Look Around.gif',
        walkLeft: './src/assets/farmr/Desktop Animations/Farmr - Walk Cycle Left.gif',
        walkRight: './src/assets/farmr/Desktop Animations/Farmr - Walk Cycle Right.gif',
    },
    dark: {
        stand: './src/assets/farmr/Desktop Animations/Farmr - Stand Dark.gif',
        blink: './src/assets/farmr/Desktop Animations/Farmr - Blink Dark.gif',
        lookAround: './src/assets/farmr/Desktop Animations/Farmr - Walk Cycle Dark Look Around.gif',
        walkLeft: './src/assets/farmr/Desktop Animations/Farmr - Walk Cycle Dark Left.gif',
        walkRight: './src/assets/farmr/Desktop Animations/Farmr - Walk Cycle Dark Right.gif',
    },
};

let workspaceEl = null;
let surfaceEl = null;
let layerEl = null;
let farmrEl = null;
let spriteEl = null;
let bubbleEl = null;
let bubbleMessageEl = null;
let visitTimerId = null;
let bubbleTimerId = null;
let currentSegment = null;
let currentSide = 'left';
let currentPosition = { x: 0, y: 0 };
let currentBehavior = 'stand';
let isInitialized = false;
let isVisitActive = false;
let _scriptedVisitActive = false;
let bodyClassObserver = null;
let mediaQueryList = null;
let mediaQueryListener = null;
let currentVisitToken = 0;

function randomBetween(min, max) {
    return min + (Math.random() * Math.max(0, max - min));
}

function clearScheduledVisit() {
    if (visitTimerId) {
        window.clearTimeout(visitTimerId);
        visitTimerId = null;
    }
}

function clearBubbleTimer() {
    if (bubbleTimerId) {
        window.clearTimeout(bubbleTimerId);
        bubbleTimerId = null;
    }
}

function delay(ms) {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

function isDesktopVisible() {
    if (!surfaceEl) {
        return false;
    }

    if (document.hidden) {
        return false;
    }

    if (document.querySelector('.mac-notification-overlay--visible, .keybinds-overlay--visible')) {
        return false;
    }

    return surfaceEl.offsetWidth > 0 && surfaceEl.offsetHeight > 0;
}

function getThemeKey() {
    return isCurrentlyDark() ? 'dark' : 'light';
}

function setSpriteForBehavior(behavior) {
    currentBehavior = behavior;

    if (!spriteEl) {
        return;
    }

    const themeAssets = ANIMATION_ASSETS[getThemeKey()] || ANIMATION_ASSETS.light;
    const assetKey = behavior;

    spriteEl.src = themeAssets[assetKey] || themeAssets.stand;
}

function updateFarmrPosition(x, y) {
    currentPosition = { x, y };

    if (!farmrEl) {
        return;
    }

    farmrEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function getWorkspaceBounds() {
    if (!surfaceEl) {
        return {
            width: window.innerWidth,
            height: window.innerHeight,
        };
    }

    const rect = surfaceEl.getBoundingClientRect();
    return {
        width: rect.width || window.innerWidth,
        height: rect.height || window.innerHeight,
    };
}

function getSafePlacement(side) {
    const { width, height } = getWorkspaceBounds();
    const leftSafeInset = 12;
    const rightReserved = 104;
    const usableWidth = Math.max(180, width - leftSafeInset - rightReserved - FARMR_WIDTH_PX);
    const travelDistance = Math.max(72, usableWidth * RETURN_TRAVEL_RATIO);
    const bottomInset = 16;
    const y = Math.max(32, height - FARMR_HEIGHT_PX - bottomInset);
    const offscreenPadding = 18;
    const maxOnscreenX = Math.max(leftSafeInset, width - FARMR_WIDTH_PX - rightReserved);
    const onscreenLeft = Math.min(maxOnscreenX, leftSafeInset + travelDistance + LEFT_ENTRY_EXTRA_TRAVEL_PX);
    const onscreenRight = Math.max(leftSafeInset, maxOnscreenX - travelDistance);

    if (side === 'left') {
        return {
            startX: -FARMR_WIDTH_PX - offscreenPadding,
            endX: onscreenLeft,
            y,
        };
    }

    return {
        startX: width + offscreenPadding,
        endX: onscreenRight,
        y,
    };
}

function getWalkDurationMs(startX, endX) {
    const distance = Math.abs(endX - startX);
    return Math.max(650, Math.round((distance / WALK_PIXELS_PER_SECOND) * 1000));
}

async function animateTo(x, y) {
    if (!farmrEl) {
        return;
    }

    const startX = currentPosition.x;
    const durationMs = getWalkDurationMs(startX, x);
    farmrEl.style.transitionDuration = `${durationMs}ms`;
    updateFarmrPosition(x, y);
    await delay(durationMs + 60);
}

function snapToPosition(x, y) {
    if (!farmrEl) {
        return;
    }

    const previousTransitionDuration = farmrEl.style.transitionDuration;
    farmrEl.style.transitionDuration = '0ms';
    updateFarmrPosition(x, y);
    void farmrEl.offsetWidth;
    farmrEl.style.transitionDuration = previousTransitionDuration;
}

function pickIdleSequence() {
    const template = IDLE_SEQUENCE_PATTERNS[Math.floor(Math.random() * IDLE_SEQUENCE_PATTERNS.length)] || ['stand'];
    return template.map((behavior) => ({
        behavior,
        durationMs: Math.round(randomBetween(MIN_IDLE_SEGMENT_MS, MAX_IDLE_SEGMENT_MS)),
    }));
}

function shouldShowBubble() {
    if (!localStorage.getItem(INTRO_STORAGE_KEY)) {
        return true;
    }

    return Math.random() < LATER_BUBBLE_CHANCE;
}

function getBubbleMessage() {
    if (!localStorage.getItem(INTRO_STORAGE_KEY)) {
        localStorage.setItem(INTRO_STORAGE_KEY, 'true');
        return "Just sayin' Hi!";
    }

    return ENCOURAGEMENT_MESSAGES[Math.floor(Math.random() * ENCOURAGEMENT_MESSAGES.length)] || ENCOURAGEMENT_MESSAGES[0];
}

function hideBubble() {
    clearBubbleTimer();

    if (!bubbleEl) {
        return;
    }

    bubbleEl.classList.remove('is-visible', 'ambient-farmr-bubble--left', 'ambient-farmr-bubble--right');
    bubbleEl.setAttribute('aria-hidden', 'true');
}

function showBubble(message) {
    if (!bubbleEl || !bubbleMessageEl) {
        return BUBBLE_MIN_MS;
    }

    const durationMs = Math.round(randomBetween(BUBBLE_MIN_MS, BUBBLE_MAX_MS));
    bubbleMessageEl.textContent = message;
    bubbleEl.classList.toggle('ambient-farmr-bubble--left', currentSide === 'left');
    bubbleEl.classList.toggle('ambient-farmr-bubble--right', currentSide === 'right');
    bubbleEl.classList.add('is-visible');
    bubbleEl.setAttribute('aria-hidden', 'false');

    clearBubbleTimer();
    bubbleTimerId = window.setTimeout(() => {
        hideBubble();
    }, durationMs);

    return durationMs;
}

function createBubble() {
    const bubble = document.createElement('div');
    bubble.className = 'ambient-farmr-bubble mac-window';
    bubble.setAttribute('aria-hidden', 'true');

    const titlebar = document.createElement('div');
    titlebar.className = 'mac-titlebar';

    const title = document.createElement('span');
    title.className = 'mac-title';
    title.textContent = 'farmr';

    const content = document.createElement('div');
    content.className = 'mac-dialog-content';

    const message = document.createElement('p');
    message.className = 'mac-dialog-message';

    titlebar.appendChild(title);
    content.appendChild(message);
    bubble.append(titlebar, content);

    bubbleMessageEl = message;
    return bubble;
}

function buildFarmrDom() {
    const hostEl = surfaceEl || workspaceEl;
    const referenceNode = document.getElementById('desktop-secondary-windows');

    layerEl = document.createElement('div');
    layerEl.className = 'ambient-farmr-layer';

    farmrEl = document.createElement('div');
    farmrEl.className = 'ambient-farmr';
    farmrEl.setAttribute('aria-hidden', 'true');

    spriteEl = document.createElement('img');
    spriteEl.className = 'ambient-farmr-sprite';
    spriteEl.alt = '';
    spriteEl.decoding = 'async';

    bubbleEl = createBubble();

    farmrEl.append(spriteEl, bubbleEl);
    layerEl.appendChild(farmrEl);

    if (referenceNode?.parentNode === hostEl) {
        hostEl.insertBefore(layerEl, referenceNode);
        return;
    }

    hostEl.appendChild(layerEl);
}

function hideFarmr() {
    hideBubble();

    if (!farmrEl) {
        return;
    }

    farmrEl.classList.remove('is-visible', 'ambient-farmr--left', 'ambient-farmr--right');
}

async function playIdleSequence(sequence, token) {
    for (const segment of sequence) {
        if (token !== currentVisitToken) {
            return;
        }

        currentSegment = segment.behavior;
        setSpriteForBehavior(segment.behavior);
        await delay(segment.durationMs);
    }
}

async function runVisit() {
    if (!workspaceEl || isVisitActive || _scriptedVisitActive) {
        return;
    }

    if (!isDesktopVisible()) {
        scheduleNextVisit(randomBetween(VISIBILITY_RETRY_MIN_DELAY_MS, VISIBILITY_RETRY_MAX_DELAY_MS));
        return;
    }

    isVisitActive = true;
    currentVisitToken += 1;
    const token = currentVisitToken;
    currentSide = Math.random() < 0.5 ? 'left' : 'right';

    const placement = getSafePlacement(currentSide);
    farmrEl.classList.toggle('ambient-farmr--left', currentSide === 'left');
    farmrEl.classList.toggle('ambient-farmr--right', currentSide === 'right');
    snapToPosition(placement.startX, placement.y);
    farmrEl.classList.add('is-visible');
    setSpriteForBehavior(currentSide === 'left' ? 'walkRight' : 'walkLeft');
    await delay(30);
    await animateTo(placement.endX, placement.y);

    if (token !== currentVisitToken) {
        isVisitActive = false;
        return;
    }

    const idleSequence = pickIdleSequence();
    const shouldBubble = shouldShowBubble();

    if (shouldBubble) {
        const bubbleDurationMs = showBubble(getBubbleMessage());
        const bubbleHoldSequence = pickIdleSequence();
        let elapsedMs = 0;
        let sequenceIndex = 0;

        while (elapsedMs < bubbleDurationMs && token === currentVisitToken) {
            const segment = bubbleHoldSequence[sequenceIndex % bubbleHoldSequence.length];
            const durationMs = Math.min(segment.durationMs, bubbleDurationMs - elapsedMs);
            currentSegment = segment.behavior;
            setSpriteForBehavior(segment.behavior);
            await delay(durationMs);
            elapsedMs += durationMs;
            sequenceIndex += 1;
        }

        hideBubble();
    } else {
        await playIdleSequence(idleSequence, token);
    }

    if (token === currentVisitToken) {
        setSpriteForBehavior(currentSide === 'left' ? 'walkLeft' : 'walkRight');
        await animateTo(placement.startX, placement.y);
    }

    hideFarmr();
    isVisitActive = false;
    scheduleNextVisit(randomBetween(VISIT_MIN_DELAY_MS, VISIT_MAX_DELAY_MS));
}

/**
 * Plays a scripted farmr visit with specific dialogue lines.
 * Walks the farmr in, shows each line as a speech bubble, then walks out.
 * Cancels any currently active ambient visit.
 *
 * @param {string[]} lines - Dialogue lines to show in sequence.
 * @param {number} [delayBetweenMs=3000] - How long to show each line.
 * @returns {Promise<void>}
 */
async function playScriptedVisit(lines, delayBetweenMs = 3000) {
    if (!workspaceEl || !farmrEl) {
        return;
    }

    // Take ownership — cancel any active ambient visit
    _scriptedVisitActive = true;
    currentVisitToken += 1;
    const token = currentVisitToken;
    clearScheduledVisit();

    currentSide = Math.random() < 0.5 ? 'left' : 'right';
    const placement = getSafePlacement(currentSide);

    farmrEl.classList.toggle('ambient-farmr--left', currentSide === 'left');
    farmrEl.classList.toggle('ambient-farmr--right', currentSide === 'right');
    snapToPosition(placement.startX, placement.y);
    farmrEl.classList.add('is-visible');
    setSpriteForBehavior(currentSide === 'left' ? 'walkRight' : 'walkLeft');

    await delay(30);
    await animateTo(placement.endX, placement.y);

    if (token !== currentVisitToken) {
        _scriptedVisitActive = false;
        return;
    }

    setSpriteForBehavior('stand');

    for (let i = 0; i < lines.length; i++) {
        if (token !== currentVisitToken) {
            break;
        }

        showBubble(lines[i]);
        await delay(delayBetweenMs);
        hideBubble();

        if (i < lines.length - 1) {
            await delay(250);
        }
    }

    if (token === currentVisitToken) {
        setSpriteForBehavior(currentSide === 'left' ? 'walkLeft' : 'walkRight');
        await animateTo(placement.startX, placement.y);
    }

    hideFarmr();
    _scriptedVisitActive = false;
    scheduleNextVisit(randomBetween(VISIT_MIN_DELAY_MS, VISIT_MAX_DELAY_MS));
}

function scheduleNextVisit(delayMs = randomBetween(VISIT_MIN_DELAY_MS, VISIT_MAX_DELAY_MS)) {
    visitTimerId = window.setTimeout(() => {
        visitTimerId = null;
        runVisit();
    }, Math.max(0, Math.round(delayMs)));
}

function refreshActiveTheme() {
    if (!farmrEl || !farmrEl.classList.contains('is-visible')) {
        return;
    }

    setSpriteForBehavior(currentBehavior || currentSegment || 'stand');
}

function bindThemeListeners() {
    if (typeof MutationObserver === 'function' && document.body) {
        bodyClassObserver = new MutationObserver(() => {
            refreshActiveTheme();
        });
        bodyClassObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['class'],
        });
    }

    if (typeof window.matchMedia === 'function') {
        mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQueryListener = () => {
            refreshActiveTheme();
        };
        mediaQueryList.addEventListener('change', mediaQueryListener);
    }
}

function initializeAmbientFarmr() {
    if (isInitialized) {
        return {
            triggerVisit: () => runVisit(),
            scheduleNextVisit,
            playScriptedVisit,
        };
    }

    workspaceEl = document.getElementById('desktop-workspace');
    surfaceEl = document.getElementById('desktop-surface') || workspaceEl;
    if (!workspaceEl) {
        return null;
    }

    isInitialized = true;
    buildFarmrDom();
    bindThemeListeners();
    hideFarmr();
    const api = {
        triggerVisit: () => runVisit(),
        scheduleNextVisit,
        playScriptedVisit,
    };

    if (typeof window !== 'undefined') {
        Object.defineProperty(window, '__asciiFarmerAmbient', {
            configurable: true,
            enumerable: false,
            value: api,
            writable: false,
        });
    }

    scheduleNextVisit(localStorage.getItem(INTRO_STORAGE_KEY)
        ? randomBetween(VISIT_MIN_DELAY_MS, VISIT_MAX_DELAY_MS)
        : randomBetween(INTRO_VISIT_MIN_DELAY_MS, INTRO_VISIT_MAX_DELAY_MS));

    return api;
}

export { initializeAmbientFarmr };