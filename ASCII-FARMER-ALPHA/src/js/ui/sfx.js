import { bindAudioContextWarmup, loadAudioBuffer, playAudioBuffer } from './audioEngine.js';

const BUBBLE_FILES = [
    './src/assets/bubbleSFX/bubble01.wav',
    './src/assets/bubbleSFX/bubble02.wav',
    './src/assets/bubbleSFX/bubble03.wav',
    './src/assets/bubbleSFX/bubble04.wav',
    './src/assets/bubbleSFX/bubble05.wav',
    './src/assets/bubbleSFX/bubble06.wav',
    './src/assets/bubbleSFX/bubble07.wav',
    './src/assets/bubbleSFX/bubble08.wav',
    './src/assets/bubbleSFX/bubble09.wav',
    './src/assets/bubbleSFX/bubble10.wav'
];

const COIN_GAIN_FILE =
    './src/assets/Resource Sounds/Coin Increase - 795943__shangasdfguy123__single-classic-blink.wav';

const MAIN_STATE_VOLUME = {
    '~': 0.08,
    '=': 0.12,
    '.': 0.16,
    '/': 0.22,
    '|': 0.28,
    '\\': 0.34,
    '¥': 0.45,
    '₡': 0.45,
    '₮': 0.45
};

const ADJACENT_MULTIPLIER = 0.35;
const MIN_ADJACENT_VOLUME = 0.04;
const MAX_VOLUME = 1;
const COIN_BURST_MIN_RANDOM_DINGS = 6;
const COIN_BURST_MAX_RANDOM_DINGS = 10;
const COIN_BURST_MAX_WINDOW_MS = 240;
const COIN_BURST_MIN_VOLUME = 0.18;
const COIN_BURST_MAX_VOLUME = 0.34;
const AUDIO_STORAGE_KEY = 'audioEnabled';

let shuffleBag = [];
let audioEnabled = true;
const bubbleBuffers = new Map();
let coinGainBuffer = null;

function initializeAudioPreference() {
    const storedAudioPreference = localStorage.getItem(AUDIO_STORAGE_KEY);
    if (storedAudioPreference === 'false') {
        audioEnabled = false;
        return;
    }

    audioEnabled = true;
}

function shuffleArray(values) {
    for (let i = values.length - 1; i > 0; i--) {
        const randomIndex = Math.floor(Math.random() * (i + 1));
        const current = values[i];
        values[i] = values[randomIndex];
        values[randomIndex] = current;
    }
}

function refillShuffleBag() {
    shuffleBag = [...BUBBLE_FILES];
    shuffleArray(shuffleBag);
}

function getNextBubbleFile() {
    if (shuffleBag.length === 0) {
        refillShuffleBag();
    }

    return shuffleBag.pop();
}

function getMainVolumeForState(symbol) {
    return MAIN_STATE_VOLUME[symbol] ?? MAIN_STATE_VOLUME['.'];
}

function getAdjacentVolumeForState(symbol) {
    const scaledVolume = getMainVolumeForState(symbol) * ADJACENT_MULTIPLIER;
    return Math.max(MIN_ADJACENT_VOLUME, Math.min(scaledVolume, MAX_VOLUME));
}

async function preloadBubbleSounds() {
    for (const filePath of BUBBLE_FILES) {
        const buffer = await loadAudioBuffer(filePath);
        if (buffer) {
            bubbleBuffers.set(filePath, buffer);
        }
    }
}

async function preloadCoinGainSound() {
    coinGainBuffer = await loadAudioBuffer(COIN_GAIN_FILE);
}

function playBubbleWithVolume(volume) {
    if (!audioEnabled) {
        return;
    }

    const filePath = getNextBubbleFile();
    const buffer = bubbleBuffers.get(filePath);

    if (!buffer) {
        return;
    }

    playAudioBuffer(buffer, Math.max(0, Math.min(volume, MAX_VOLUME)));
}

function playPlotBubbleForState(symbol) {
    playBubbleWithVolume(getMainVolumeForState(symbol));
}

function playAdjacentBubbleForState(symbol) {
    playBubbleWithVolume(getAdjacentVolumeForState(symbol));
}

function getCoinBurstCount(payoutCoins) {
    const normalizedPayout = Math.max(0, Math.floor(Number(payoutCoins) || 0));
    if (normalizedPayout <= 0) {
        return 0;
    }

    if (normalizedPayout <= 5) {
        return normalizedPayout;
    }

    return COIN_BURST_MIN_RANDOM_DINGS
        + Math.floor(Math.random() * (COIN_BURST_MAX_RANDOM_DINGS - COIN_BURST_MIN_RANDOM_DINGS + 1));
}

function buildCoinBurstOffsetsMs(hitCount) {
    if (hitCount <= 0) {
        return [];
    }

    const offsets = [0];
    for (let i = 1; i < hitCount; i++) {
        // Front-load impacts to feel like a handful of coins hitting together.
        const weighted = Math.pow(Math.random(), 1.7);
        const offsetMs = Math.round(weighted * COIN_BURST_MAX_WINDOW_MS);
        offsets.push(offsetMs);
    }

    offsets.sort((a, b) => a - b);
    return offsets;
}

function playCoinGainBurst(payoutCoins) {
    if (!audioEnabled || !coinGainBuffer) {
        return;
    }

    const hitCount = getCoinBurstCount(payoutCoins);
    if (hitCount <= 0) {
        return;
    }

    const offsets = buildCoinBurstOffsetsMs(hitCount);
    offsets.forEach((offsetMs) => {
        const volume = COIN_BURST_MIN_VOLUME + (Math.random() * (COIN_BURST_MAX_VOLUME - COIN_BURST_MIN_VOLUME));
        window.setTimeout(() => {
            playAudioBuffer(coinGainBuffer, volume);
        }, offsetMs);
    });
}

function isAudioEnabled() {
    return audioEnabled;
}

function setAudioEnabled(enabled) {
    audioEnabled = Boolean(enabled);
    localStorage.setItem(AUDIO_STORAGE_KEY, audioEnabled ? 'true' : 'false');
    return audioEnabled;
}

function toggleAudioEnabled() {
    return setAudioEnabled(!audioEnabled);
}

initializeAudioPreference();
preloadBubbleSounds();
preloadCoinGainSound();
bindAudioContextWarmup();

export {
    playPlotBubbleForState,
    playAdjacentBubbleForState,
    playCoinGainBurst,
    isAudioEnabled,
    setAudioEnabled,
    toggleAudioEnabled,
};
