let audioContext = null;
let warmupBound = false;

function getAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

async function resumeAudioContext() {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
        try {
            await ctx.resume();
        } catch (e) {
            // ignore
        }
    }
}

function bindAudioContextWarmup() {
    if (warmupBound) {
        return;
    }
    warmupBound = true;

    const warmupOnce = () => {
        resumeAudioContext();
        window.removeEventListener('pointerdown', warmupOnce, true);
        window.removeEventListener('keydown', warmupOnce, true);
        window.removeEventListener('touchstart', warmupOnce, true);
    };

    window.addEventListener('pointerdown', warmupOnce, true);
    window.addEventListener('keydown', warmupOnce, true);
    window.addEventListener('touchstart', warmupOnce, true);
}

const bufferCache = new Map();

async function loadAudioBuffer(url) {
    if (bufferCache.has(url)) {
        return bufferCache.get(url);
    }

    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const ctx = getAudioContext();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        bufferCache.set(url, audioBuffer);
        return audioBuffer;
    } catch (e) {
        return null;
    }
}

function playAudioBuffer(buffer, volume = 1) {
    if (!buffer) {
        return;
    }

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
        return;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = ctx.createGain();
    gainNode.gain.value = Math.max(0, Math.min(volume, 1));

    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start(0);
}

export { bindAudioContextWarmup, loadAudioBuffer, playAudioBuffer };
