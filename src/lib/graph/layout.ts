/**
 * Commit DAG -> lane assignment.
 *
 * Pure data. It knows nothing about SVG, the DOM, or row heights, so it can
 * be unit tested and reused by any renderer (plan section 13).
 *
 * The model is a set of vertical lanes. A lane is "open" while it waits for a
 * specific commit hash to appear further down the log. When that commit is
 * reached the lane is handed on to the commit's first parent, which is what
 * keeps a branch on one column instead of letting it wander.
 */
import type { Commit } from '../git/types';

export interface LaneLine {
  /** Lane the line occupies, or arrives from / departs to. */
  lane: number;
  /** Lane index used to pick a colour, so a line keeps one colour end to end. */
  colorLane: number;
}

export interface GraphRow {
  commit: Commit;
  /** Column the commit's node sits in. */
  lane: number;
  /** Lines crossing the full row height, not touching this node. */
  passes: LaneLine[];
  /** Top half: lines arriving from above into this node. */
  incoming: LaneLine[];
  /** Bottom half: lines leaving this node toward its parents. */
  outgoing: LaneLine[];
}

export interface GraphLayout {
  rows: GraphRow[];
  /** Widest point of the graph, used to size the graph column. */
  laneCount: number;
  index: Map<string, number>;
}

function firstFree(lanes: (string | null)[]): number {
  const i = lanes.indexOf(null);
  return i === -1 ? lanes.length : i;
}

export function layoutGraph(commits: Commit[]): GraphLayout {
  const rows: GraphRow[] = [];
  const index = new Map<string, number>();
  /** lanes[i] = hash the lane is currently waiting for, or null if free. */
  const lanes: (string | null)[] = [];
  let laneCount = 0;

  for (let r = 0; r < commits.length; r++) {
    const commit = commits[r];
    index.set(commit.hash, r);

    // Lanes already expecting this commit. More than one means a merge point:
    // the leftmost becomes the node's lane, the rest end here.
    const waiting: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === commit.hash) waiting.push(i);
    }

    const lane = waiting.length > 0 ? waiting[0] : firstFree(lanes);
    if (lane >= lanes.length) lanes.length = lane + 1;

    // Lines crossing this row untouched: every open lane that is not one of
    // the lanes terminating at this node.
    const passes: LaneLine[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] != null && !waiting.includes(i)) passes.push({ lane: i, colorLane: i });
    }

    const incoming: LaneLine[] = waiting.map((i) => ({ lane: i, colorLane: i }));

    // Free every lane that ended here before handing lanes to the parents.
    for (const i of waiting) lanes[i] = null;
    lanes[lane] = null;

    const outgoing: LaneLine[] = [];
    for (let p = 0; p < commit.parents.length; p++) {
      const parent = commit.parents[p];
      const existing = lanes.indexOf(parent);
      if (existing !== -1) {
        // Another branch is already heading for this parent; merge into it.
        outgoing.push({ lane: existing, colorLane: existing });
        continue;
      }
      // The first parent inherits this commit's lane, so mainline stays straight.
      const target = p === 0 ? lane : firstFree(lanes);
      if (target >= lanes.length) lanes.length = target + 1;
      lanes[target] = parent;
      outgoing.push({ lane: target, colorLane: target });
    }

    // A commit with no parents (a root) still needs its lane released.
    if (commit.parents.length === 0 && lanes[lane] === null) {
      // nothing to do: the lane is already free for reuse below this row
    }

    // Trim trailing free lanes so the graph narrows again after branches end.
    while (lanes.length > 0 && lanes[lanes.length - 1] == null) lanes.pop();

    const widest = Math.max(
      lane,
      ...passes.map((l) => l.lane),
      ...incoming.map((l) => l.lane),
      ...outgoing.map((l) => l.lane)
    );
    laneCount = Math.max(laneCount, widest + 1);

    rows.push({ commit, lane, passes, incoming, outgoing });
  }

  return { rows, laneCount, index };
}

/** Lane colours. Deliberately desaturated so the graph never shouts. */
export const LANE_COLORS = [
  '#5b9dd9', '#c98a4b', '#7fb069', '#b07ac9', '#d4707f',
  '#4fa8a0', '#c4a94b', '#8a8ed4', '#c97fa8', '#6fa3bd'
];

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}
