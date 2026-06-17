// world/milestones.js
// World milestone registry: conditions, rewards, and evaluation.
//
// Three initial milestones:
//   'net-space-unlocked' — fires when world.netSpaceUnlocked becomes true
//   'first-autofarmer'   — fires when any module-slot plot has an autofarmer moduleState
//   'time-to-grid'       — fires when the player first visits Net-Space
//
// Rewards are applied at most once per milestone (idempotent via completedMilestones[]).

import {
    getWorldState,
    dispatchWorldAction,
    getActiveNodeState,
    getAllNodeStates,
} from '../worldState.js';
import { setSlotVisibility } from '../netspace/worldGraph.js';

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Milestone
 * @property {string} id
 * @property {string} label
 * @property {(world: import('../schemas/v2StateShape.js').WorldState, nodes: Object.<string, import('../schemas/v2StateShape.js').NodeState>) => boolean} condition
 * @property {(world: import('../schemas/v2StateShape.js').WorldState, nodes: Object.<string, import('../schemas/v2StateShape.js').NodeState>) => void} reward
 */

/** @type {Milestone[]} */
export const MILESTONES = [
    {
        id: 'net-space-unlocked',
        label: 'Net-Space Online',
        /**
         * Fires once world.netSpaceUnlocked is set to true (by the unlock quest reward handler).
         */
        condition: (world) => world.netSpaceUnlocked === true,
        /**
         * Makes the first locked branch slot visible on the world map.
         */
        reward: () => {
            setSlotVisibility('slot-branch-a', true);
        },
    },
    {
        id: 'first-autofarmer',
        label: 'First Autofarmer',
        /**
         * Fires when at least one autofarmer module has been built across all nodes.
         */
        condition: (_world, nodes) => {
            return Object.values(nodes).some((node) => {
                if (!node.fields || typeof node.fields !== 'object') {
                    return false;
                }
                return Object.values(node.fields).some((field) => {
                    if (!Array.isArray(field.plotStates)) {
                        return false;
                    }
                    return field.plotStates.some(
                        (plot) =>
                            plot.plotType === 'module-slot' &&
                            plot.moduleSlotType === 'autofarmer' &&
                            plot.moduleState !== null,
                    );
                });
            });
        },
        /**
         * Makes the two side branch slots visible on the world map.
         */
        reward: () => {
            setSlotVisibility('slot-branch-b', true);
            setSlotVisibility('slot-branch-c', true);
        },
    },
    {
        id: 'time-to-grid',
        label: 'Time to Grid',
        /**
         * Fires once netSpaceFirstAccessAt is recorded (player first visits Net-Space).
         */
        condition: (world) => world.worldStats.netSpaceFirstAccessAt !== null,
        /**
         * Records how long it took from game start to first Net-Space access.
         * Also unlocks the 'time-to-grid' world achievement.
         *
         * @param {import('../schemas/v2StateShape.js').WorldState} world
         */
        reward: (world) => {
            const nodeState = getActiveNodeState();
            const gameStartedAt = Number(nodeState?.gameStartedAt) || 0;
            const firstAccessAt = Number(world.worldStats.netSpaceFirstAccessAt) || 0;

            if (gameStartedAt > 0 && firstAccessAt > 0) {
                const timeToGridMs = Math.max(0, firstAccessAt - gameStartedAt);
                dispatchWorldAction({
                    type: 'world.patch',
                    payload: {
                        updates: {
                            worldStats: {
                                ...world.worldStats,
                                timeToGridMs,
                            },
                        },
                    },
                    meta: { source: 'milestones.timeToGrid.reward' },
                });
            }

            // Unlock world achievement (idempotent — completedMilestones already
            // updated before this reward fires, so no double-fire risk here).
            const freshWorld = getWorldState();
            if (!freshWorld.worldAchievementsUnlocked.includes('time-to-grid')) {
                dispatchWorldAction({
                    type: 'world.patch',
                    payload: {
                        updates: {
                            worldAchievementsUnlocked: [
                                ...freshWorld.worldAchievementsUnlocked,
                                'time-to-grid',
                            ],
                        },
                    },
                    meta: { source: 'milestones.timeToGrid.achievementUnlock' },
                });
            }
        },
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns 'completed' if the milestone has been marked done, 'locked' otherwise.
 *
 * @param {string} milestoneId
 * @returns {'locked' | 'completed'}
 */
export function getMilestoneStatus(milestoneId) {
    const { completedMilestones } = getWorldState();
    return completedMilestones.includes(milestoneId) ? 'completed' : 'locked';
}

/**
 * Marks a milestone as completed and fires its reward function.
 * No-op if the milestone is already completed or unknown.
 *
 * @param {string} milestoneId
 */
export function applyMilestone(milestoneId) {
    const world = getWorldState();
    if (world.completedMilestones.includes(milestoneId)) {
        return;
    }

    const milestone = MILESTONES.find((m) => m.id === milestoneId);
    if (!milestone) {
        console.warn(`[milestones] Unknown milestone: "${milestoneId}"`);
        return;
    }

    // Mark as completed before firing the reward to prevent re-entrant calls.
    dispatchWorldAction({
        type: 'world.patch',
        payload: {
            updates: {
                completedMilestones: [...world.completedMilestones, milestoneId],
            },
        },
        meta: { source: 'milestones.applyMilestone' },
    });

    // Fetch fresh world + nodes for the reward function.
    const freshWorld = getWorldState();
    const nodes = getAllNodeStates();
    milestone.reward(freshWorld, nodes);

    console.log(`[milestones] Completed: "${milestoneId}" (${milestone.label})`);
}

/**
 * Checks all uncompleted milestones against the current world state.
 * Applies rewards for any newly met milestones.
 * Returns an array of milestone IDs that were newly completed in this call.
 *
 * Safe to call frequently — already-completed milestones are skipped immediately.
 *
 * @returns {string[]}
 */
export function checkMilestones() {
    const world = getWorldState();
    const nodes = getAllNodeStates();
    const newlyCompleted = [];

    for (const milestone of MILESTONES) {
        if (world.completedMilestones.includes(milestone.id)) {
            continue;
        }

        if (milestone.condition(world, nodes)) {
            applyMilestone(milestone.id);
            newlyCompleted.push(milestone.id);
        }
    }

    return newlyCompleted;
}
