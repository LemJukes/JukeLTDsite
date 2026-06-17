function isObjectLike(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneQuestProgress(questProgress) {
    if (!isObjectLike(questProgress)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(questProgress).map(([questId, entry]) => [
            questId,
            isObjectLike(entry) ? { ...entry } : entry,
        ]),
    );
}

function cloneFieldState(fieldState) {
    if (!isObjectLike(fieldState)) {
        return fieldState;
    }

    return {
        ...fieldState,
        plotStates: Array.isArray(fieldState.plotStates)
            ? fieldState.plotStates.map((plotState) => (isObjectLike(plotState) ? { ...plotState } : plotState))
            : fieldState.plotStates,
    };
}

function cloneFieldsMap(fields) {
    if (!isObjectLike(fields)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(fields).map(([fieldId, fieldState]) => [fieldId, cloneFieldState(fieldState)]),
    );
}

export function reduceWorldPatch(worldState, updates = {}) {
    if (!isObjectLike(worldState) || !isObjectLike(updates)) {
        return worldState;
    }

    return {
        ...worldState,
        ...updates,
    };
}

export function reduceNodeEconomyPatch(nodeState, updates = {}) {
    if (!isObjectLike(nodeState) || !isObjectLike(updates)) {
        return nodeState;
    }

    return {
        ...nodeState,
        ...updates,
    };
}

export function reduceNodeQuestPatch(nodeState, updates = {}) {
    if (!isObjectLike(nodeState) || !isObjectLike(updates)) {
        return nodeState;
    }

    const nextState = { ...nodeState };

    Object.entries(updates).forEach(([key, value]) => {
        if (key === 'questProgress') {
            nextState.questProgress = cloneQuestProgress(value);
            return;
        }

        if (Array.isArray(value)) {
            nextState[key] = [...value];
            return;
        }

        if (isObjectLike(value)) {
            nextState[key] = { ...value };
            return;
        }

        nextState[key] = value;
    });

    return nextState;
}

export function reduceNodeFieldPatch(nodeState, updates = {}) {
    if (!isObjectLike(nodeState) || !isObjectLike(updates)) {
        return nodeState;
    }

    const nextState = { ...nodeState };

    Object.entries(updates).forEach(([key, value]) => {
        if (key === 'fields') {
            nextState.fields = cloneFieldsMap(value);
            return;
        }

        if (Array.isArray(value)) {
            nextState[key] = [...value];
            return;
        }

        if (isObjectLike(value)) {
            nextState[key] = { ...value };
            return;
        }

        nextState[key] = value;
    });

    return nextState;
}

export function reduceNodePatch(nodeState, updates = {}) {
    if (!isObjectLike(nodeState) || !isObjectLike(updates)) {
        return nodeState;
    }

    const fieldKeys = new Set(['fields', 'ownedFieldIds', 'activeFieldId', 'nextFieldNumber', 'plotSelectionMode', 'pendingPlotPurchase']);
    const questKeys = new Set([
        'questsUnlocked',
        'questsActive',
        'questsCompleted',
        'questProgress',
        'questUnlockThresholdOffset',
        'questPendingDeclineOffset',
        'questProgressionPaused',
        'questBlockedQuestId',
        'totalCoinsFromQuests',
        'timedQuestsBeatenOnTime',
    ]);

    const fieldUpdates = {};
    const questUpdates = {};
    const economyUpdates = {};

    Object.entries(updates).forEach(([key, value]) => {
        if (fieldKeys.has(key)) {
            fieldUpdates[key] = value;
            return;
        }

        if (questKeys.has(key)) {
            questUpdates[key] = value;
            return;
        }

        economyUpdates[key] = value;
    });

    let nextState = nodeState;

    if (Object.keys(economyUpdates).length > 0) {
        nextState = reduceNodeEconomyPatch(nextState, economyUpdates);
    }

    if (Object.keys(questUpdates).length > 0) {
        nextState = reduceNodeQuestPatch(nextState, questUpdates);
    }

    if (Object.keys(fieldUpdates).length > 0) {
        nextState = reduceNodeFieldPatch(nextState, fieldUpdates);
    }

    return nextState;
}
