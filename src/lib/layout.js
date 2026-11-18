// Layout helpers for the time grid and the all-day / month rows.

/**
 * Side-by-side layout for timed events in one day column.
 * items: [{ id, start, end }] in minutes. Returns Map(id -> { col, cols }).
 */
export function layoutDay(items) {
  const sorted = [...items]
    .map((it) => ({ ...it, end: Math.max(it.end, it.start + 1) }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const result = new Map();
  let cluster = [];
  let colEnds = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const c of cluster) result.set(c.id, { col: c.col, cols: colEnds.length });
    cluster = [];
    colEnds = [];
  };

  for (const it of sorted) {
    if (cluster.length && it.start >= clusterEnd) flush();
    let col = colEnds.findIndex((e) => e <= it.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(it.end);
    } else {
      colEnds[col] = it.end;
    }
    cluster.push({ id: it.id, col });
    clusterEnd = cluster.length === 1 ? it.end : Math.max(clusterEnd, it.end);
  }
  flush();
  return result;
}

/**
 * Stack horizontal spans (multi-day bars) into lanes.
 * spans: [{ id, startCol, endCol }] with inclusive columns. Returns { lanes: Map(id -> lane), count }.
 */
export function layoutLanes(spans) {
  const sorted = [...spans].sort((a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol));
  const laneEnds = [];
  const lanes = new Map();
  for (const s of sorted) {
    let lane = laneEnds.findIndex((e) => e < s.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(s.endCol);
    } else {
      laneEnds[lane] = s.endCol;
    }
    lanes.set(s.id, lane);
  }
  return { lanes, count: laneEnds.length };
}
