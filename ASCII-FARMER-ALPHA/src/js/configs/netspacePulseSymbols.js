import { cropTypes } from './cropConfig.js';
import { getNodeCropEntries } from '../state/nodeCropView.js';

// Manually add custom pulse symbols here. `address` is optional and will be
// derived from `symbol` when omitted.
const MANUAL_NETSPACE_SYMBOLS = [
    // { key: 'power', label: 'Power', symbol: '⌁', address: 'U+2301' },
    // { key: 'warning', label: 'Warning', symbol: '⚠', address: 'U+26A0' },
];

const RESOURCE_SYMBOL_PROVIDERS = [
    function getUnlockedCropSymbols(nodeState) {
        return getNodeCropEntries(nodeState)
            .filter((entry) => entry.unlocked)
            .map((entry) => {
                const crop = cropTypes[entry.cropId];
                if (!crop?.symbol) {
                    return null;
                }

                return {
                    key: `crop:${crop.id}`,
                    label: crop.name,
                    symbol: crop.symbol,
                };
            })
            .filter(Boolean);
    },
];

function formatUnicodeAddress(symbol, explicitAddress) {
    if (typeof explicitAddress === 'string' && explicitAddress.trim().length > 0) {
        return explicitAddress.trim().toUpperCase();
    }

    const codePoint = typeof symbol === 'string' && symbol.length > 0
        ? symbol.codePointAt(0)
        : null;

    if (!Number.isInteger(codePoint)) {
        return 'U+003F';
    }

    return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

function normalizeSymbolEntry(entry, source) {
    if (!entry || typeof entry.symbol !== 'string' || entry.symbol.length === 0) {
        return null;
    }

    const address = formatUnicodeAddress(entry.symbol, entry.address);
    return {
        key: entry.key || `${source}:${entry.symbol}:${address}`,
        label: entry.label || entry.key || entry.symbol,
        symbol: entry.symbol,
        address,
        source,
        segment: `(${entry.symbol})${address}`,
    };
}

export function getManualNetspaceSymbols() {
    return MANUAL_NETSPACE_SYMBOLS.slice();
}

export function buildNetspacePulseSymbolPool(nodeState, {
    manualSymbols = MANUAL_NETSPACE_SYMBOLS,
    providers = RESOURCE_SYMBOL_PROVIDERS,
} = {}) {
    const entries = [];

    providers.forEach((provider) => {
        if (typeof provider !== 'function') {
            return;
        }

        const providedEntries = provider(nodeState);
        if (!Array.isArray(providedEntries)) {
            return;
        }

        providedEntries.forEach((entry) => {
            const normalizedEntry = normalizeSymbolEntry(entry, 'resource');
            if (normalizedEntry) {
                entries.push(normalizedEntry);
            }
        });
    });

    if (Array.isArray(manualSymbols)) {
        manualSymbols.forEach((entry) => {
            const normalizedEntry = normalizeSymbolEntry(entry, 'manual');
            if (normalizedEntry) {
                entries.push(normalizedEntry);
            }
        });
    }

    const dedupedEntries = [];
    const seenKeys = new Set();

    entries.forEach((entry) => {
        if (seenKeys.has(entry.key)) {
            return;
        }

        seenKeys.add(entry.key);
        dedupedEntries.push(entry);
    });

    return dedupedEntries;
}
