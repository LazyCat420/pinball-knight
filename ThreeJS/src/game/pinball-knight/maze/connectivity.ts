import { type Grid, isWalkable, setTile, T_FLOOR } from "./generator";

// Preserve corridor tie-breaking: east, west, south, north.
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Join every walkable component to the largest one with shortest corridors.
 * Prefer routes outside `avoid`, retrying without it only when necessary.
 * No RNG is consumed; the argument preserves the existing caller contract.
 *
 * Label components once, then extend the reached set only across newly joined
 * tiles. Both floods together visit each tile at most twice. Wall searches
 * retain their original ordering but reuse a stamped queue/parent workspace.
 */
export function connectAll(g: Grid, _rng: () => number, avoid?: Uint8Array): void {
  const n = g.w * g.h;
  const labels = new Int32Array(n); // zero = unvisited
  const queue = new Int32Array(n);
  let component = 0;
  let anchor = -1;
  let largest = 0;

  // One shared label array avoids an allocation and full-grid scan per pocket.
  for (let k = 0; k < n; k++) {
    if (labels[k] || !isWalkable(g, k % g.w, Math.floor(k / g.w))) continue;
    labels[k] = ++component;
    queue[0] = k;
    let tail = 1;
    for (let head = 0; head < tail; head++) {
      const cur = queue[head];
      const i = cur % g.w;
      const j = Math.floor(cur / g.w);
      for (const [di, dj] of STEPS) {
        const x = i + di, y = j + dj;
        if (!isWalkable(g, x, y)) continue;
        const next = y * g.w + x;
        if (labels[next]) continue;
        labels[next] = component;
        queue[tail++] = next;
      }
    }
    if (tail > largest) {
      largest = tail;
      anchor = component;
    }
  }
  if (component < 2) return;

  const reached = new Uint8Array(n);
  for (let k = 0; k < n; k++) if (labels[k] === anchor) reached[k] = 1;
  // Reuse the initial labels as BFS visitation stamps now that anchor is known.
  labels.fill(0);
  const prev = new Int32Array(n);
  let stamp = 0;

  const search = (target: number, blocked?: Uint8Array): number => {
    // Defensive wrap handling for repeated searches on an enormous grid.
    if (++stamp === 0x7fffffff) { labels.fill(0); stamp = 1; }
    queue[0] = target;
    labels[target] = stamp;
    let tail = 1;
    for (let head = 0; head < tail; head++) {
      const cur = queue[head];
      const i = cur % g.w, j = Math.floor(cur / g.w);
      for (const [di, dj] of STEPS) {
        const x = i + di, y = j + dj;
        if (x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1) continue;
        const next = y * g.w + x;
        if (labels[next] === stamp || (blocked?.[next] && !reached[next])) continue;
        labels[next] = stamp;
        prev[next] = cur;
        if (reached[next]) return next;
        queue[tail++] = next;
      }
    }
    return -1;
  };

  // Reachability only grows, so no earlier index can become a new target.
  // Every successful repair absorbs a pocket; no fixed repair-count cap.
  for (let target = 0; target < n; target++) {
    if (reached[target] || !isWalkable(g, target % g.w, Math.floor(target / g.w))) continue;
    let hit = search(target, avoid);
    if (hit < 0 && avoid) hit = search(target);
    if (hit < 0) return; // malformed boundary-only map has no interior route
    for (let k = hit; k !== target; k = prev[k]) {
      setTile(g, k % g.w, Math.floor(k / g.w), T_FLOOR);
    }

    // Start at the pocket, traversing the new corridor and every component it
    // touches. Old reached tiles need no visit: their neighbours were explored.
    queue[0] = target;
    reached[target] = 1;
    let tail = 1;
    for (let head = 0; head < tail; head++) {
      const cur = queue[head];
      const i = cur % g.w, j = Math.floor(cur / g.w);
      for (const [di, dj] of STEPS) {
        const x = i + di, y = j + dj;
        if (!isWalkable(g, x, y)) continue;
        const next = y * g.w + x;
        if (reached[next]) continue;
        reached[next] = 1;
        queue[tail++] = next;
      }
    }
  }
}
