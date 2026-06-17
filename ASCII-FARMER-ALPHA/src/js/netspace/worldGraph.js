// netspace/worldGraph.js
// Query/mutation layer for the world graph (net-space node tree).
//
// DESIGN DECISION: This module is NOT a data factory. buildDefaultWorldGraph()
// in v2StateShape.js owns the initial graph structure (farm-node-1 at origin,
// trunk-root at (0, -220), 3 locked slots). The worldGraph slice is already
// populated on first boot by initializeWorldState() in worldState.js.
// This module reads and mutates world.worldGraph via the worldState.js API.

import {
    getWorldState,
    dispatchWorldAction,
} from '../worldState.js';

// ─────────────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * No-op guard: returns immediately if the world graph already has nodes.
 * buildDefaultWorldGraph() in v2StateShape.js is the authoritative data factory
 * and runs during initializeWorldState(). This function exists only as a safe
 * call site for future extensions.
 */
export function initializeWorldGraph() {
    const { worldGraph } = getWorldState();
    if (
        worldGraph &&
        typeof worldGraph.nodes === 'object' &&
        Object.keys(worldGraph.nodes).length > 0
    ) {
        return;
    }
    // Graph is unexpectedly empty — this should not happen after Phase 1 boot.
    // Log a warning but do not attempt to reconstruct data here.
    console.warn('[worldGraph] initializeWorldGraph: worldGraph.nodes is empty. ' +
        'Ensure initializeWorldState() ran before this call.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the current world graph state.
 * Treat the returned value as read-only — mutate only via this module's write functions.
 *
 * @returns {import('../schemas/v2StateShape.js').WorldGraph}
 */
export function getGraphState() {
    return getWorldState().worldGraph;
}

/**
 * Returns a copy of the world-space position of the given node, or null if not found.
 *
 * @param {string} nodeId
 * @returns {{ x: number, y: number } | null}
 */
export function getNodePosition(nodeId) {
    const node = getWorldState().worldGraph.nodes[nodeId];
    return node ? { ...node.position } : null;
}

/**
 * Returns all edges in the world graph as a new array.
 *
 * @returns {import('../schemas/v2StateShape.js').WorldGraphEdge[]}
 */
export function getAllEdges() {
    return [...getWorldState().worldGraph.edges];
}

/**
 * Returns all locked slots in the world graph as a new array.
 *
 * @returns {import('../schemas/v2StateShape.js').WorldGraphSlot[]}
 */
export function getLockedSlots() {
    return [...getWorldState().worldGraph.lockedSlots];
}

/**
 * Returns all graph elements visible within the given camera viewport.
 * The camera position is the center of the viewport in world-space coordinates.
 *
 * A padding margin is added so elements near the edge of the viewport
 * are included before they fully enter view (prevents pop-in during panning).
 *
 * Only locked slots with visible === true are included.
 * Edges are included if either endpoint node is within bounds.
 *
 * @param {number} cameraX   - World-space x of viewport center
 * @param {number} cameraY   - World-space y of viewport center
 * @param {number} viewWidth  - Viewport width in world-space units
 * @param {number} viewHeight - Viewport height in world-space units
 * @returns {{
 *   nodes: import('../schemas/v2StateShape.js').WorldGraphNode[],
 *   edges: import('../schemas/v2StateShape.js').WorldGraphEdge[],
 *   lockedSlots: import('../schemas/v2StateShape.js').WorldGraphSlot[],
 * }}
 */
export function getVisibleElements(cameraX, cameraY, viewWidth, viewHeight) {
    const graph = getWorldState().worldGraph;

    // Extra padding so objects near the viewport boundary render before
    // they fully enter — prevents visible pop-in while panning.
    const EDGE_MARGIN = 150;
    const halfW = viewWidth / 2 + EDGE_MARGIN;
    const halfH = viewHeight / 2 + EDGE_MARGIN;
    const left   = cameraX - halfW;
    const right  = cameraX + halfW;
    const top    = cameraY - halfH;
    const bottom = cameraY + halfH;

    const isInBounds = ({ x, y }) =>
        x >= left && x <= right && y >= top && y <= bottom;

    const visibleNodes = Object.values(graph.nodes).filter((node) =>
        isInBounds(node.position),
    );
    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));

    // Include an edge if either endpoint is within bounds.
    const visibleEdges = graph.edges.filter(
        (edge) => visibleNodeIds.has(edge.from) || visibleNodeIds.has(edge.to),
    );

    const visibleSlots = graph.lockedSlots.filter(
        (slot) => slot.visible && isInBounds(slot.position),
    );

    return { nodes: visibleNodes, edges: visibleEdges, lockedSlots: visibleSlots };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sets the visibility of a locked slot.
 * Called by the milestone system to reveal slots on the world map when
 * a milestone reward fires.
 *
 * @param {string} slotId
 * @param {boolean} visible
 */
export function setSlotVisibility(slotId, visible) {
    const graph = getWorldState().worldGraph;
    const updatedSlots = graph.lockedSlots.map((slot) =>
        slot.id === slotId ? { ...slot, visible } : slot,
    );
    dispatchWorldAction({
        type: 'world.patch',
        payload: {
            updates: {
                worldGraph: { ...graph, lockedSlots: updatedSlots },
            },
        },
        meta: { source: 'worldGraph.setSlotVisibility' },
    });
}

/**
 * Converts a locked slot into an active node in the world graph.
 *
 * Steps:
 *  1. Locates the slot by id — returns false if not found.
 *  2. Creates a new WorldGraphNode at the slot's position using nodeData.
 *  3. Finds the nearest parent node (closest existing node that is "below"
 *     the slot in the upward-growing tree — i.e., has a greater y value).
 *  4. Adds an edge from parent → new node.
 *  5. Removes the slot from lockedSlots.
 *
 * NOTE: Making child slots visible after an unlock is the responsibility of
 * the milestone system (milestones.js → applyMilestone → setSlotVisibility).
 * This function only handles the structural graph mutation.
 *
 * @param {string} slotId - ID of the locked slot to convert
 * @param {{ id: string, type?: string, label?: string }} nodeData - New node identity
 * @returns {boolean} true if the slot was found and converted; false otherwise
 */
export function unlockSlot(slotId, nodeData) {
    const graph = getWorldState().worldGraph;

    const slotIndex = graph.lockedSlots.findIndex((s) => s.id === slotId);
    if (slotIndex === -1) {
        return false;
    }

    const slot = graph.lockedSlots[slotIndex];

    /** @type {import('../schemas/v2StateShape.js').WorldGraphNode} */
    const newNode = {
        id: nodeData.id,
        type: nodeData.type || 'farm',
        label: nodeData.label || nodeData.id,
        position: { ...slot.position },
        unlockedAt: Date.now(),
    };

    const parentNode = _findParentNode(graph, slot.position);

    const updatedNodes = { ...graph.nodes, [newNode.id]: newNode };
    const updatedEdges = [...graph.edges];
    if (parentNode) {
        updatedEdges.push({
            id: `edge-${parentNode.id}-${newNode.id}`,
            from: parentNode.id,
            to: newNode.id,
        });
    }
    const updatedSlots = graph.lockedSlots.filter((s) => s.id !== slotId);

    dispatchWorldAction({
        type: 'world.patch',
        payload: {
            updates: {
                worldGraph: {
                    nodes: updatedNodes,
                    edges: updatedEdges,
                    lockedSlots: updatedSlots,
                },
            },
        },
        meta: { source: 'worldGraph.unlockSlot' },
    });

    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finds the most appropriate parent node for a slot being unlocked.
 *
 * The tree grows upward in screen space (more negative y = higher in tree).
 * The parent of a slot is the existing node that:
 *   - Has a greater y value than the slot (i.e., is "below" it / closer to root)
 *   - Among those candidates, has the smallest y (i.e., is closest to the slot)
 *
 * Example: slot at y=-440, candidates trunk-root(y=-220) and farm-node-1(y=0).
 * Both have y > -440. The one with the smallest y among them is trunk-root(-220). ✓
 *
 * @param {import('../schemas/v2StateShape.js').WorldGraph} graph
 * @param {{ x: number, y: number }} slotPosition
 * @returns {import('../schemas/v2StateShape.js').WorldGraphNode | null}
 */
function _findParentNode(graph, slotPosition) {
    const candidates = Object.values(graph.nodes).filter(
        (node) => node.type !== 'locked' && node.position.y > slotPosition.y,
    );
    if (candidates.length === 0) {
        return null;
    }
    // Return the candidate closest to the slot from below (smallest y among candidates).
    return candidates.reduce((closest, node) =>
        node.position.y < closest.position.y ? node : closest,
    );
}
