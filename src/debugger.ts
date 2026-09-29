import type { Artifact } from './core/types';

export type Marker = Artifact['markers'][number];
export type StopReason = { kind: 'line'; lines: number[] } | { kind: 'breakpoint'; line: number };
/** Inspects each committed state; a reason stops execution after that commit. */
export type StopCondition = (state: ArrayLike<number>) => StopReason | undefined;

/** Instructions whose program-counter gates are nonzero in the given state. */
export function activeMarkers(artifact: Artifact, state: ArrayLike<number>): Marker[] {
  return artifact.markers.filter(marker => state[marker.register] !== 0);
}

/** Source lines owning at least one compiled instruction: the valid breakpoint targets. */
export function markerLines(artifact: Artifact): Set<number> {
  return new Set(artifact.markers.map(marker => marker.line));
}

/**
 * Stops when a different, nonempty set of source lines (per execution context) becomes
 * active. Several instructions compiled from one line count as that line, and ticks with
 * no active marker (call and return routing, for example) are passed over, not reported.
 */
export function lineStepCondition(artifact: Artifact, state: ArrayLike<number>): StopCondition {
  const signature = (values: ArrayLike<number>) => [...new Set(activeMarkers(artifact, values).map(marker => `${marker.context}:${marker.line}`))].sort().join(',');
  const start = signature(state);
  return next => {
    const current = signature(next);
    if (!current || current === start) return undefined;
    return { kind: 'line', lines: [...new Set(activeMarkers(artifact, next).map(marker => marker.line))] };
  };
}

/**
 * Stops when an instruction on a breakpoint line becomes active. An instruction that is
 * already active does not trigger again until it has been left, so Run can resume past it.
 */
export function breakpointCondition(artifact: Artifact, lines: ReadonlySet<number>, state: ArrayLike<number>): StopCondition | undefined {
  const watched = artifact.markers.filter(marker => lines.has(marker.line));
  if (!watched.length) return undefined;
  const previous = watched.map(marker => state[marker.register] !== 0);
  return next => {
    let hit: number | undefined;
    watched.forEach((marker, index) => {
      const active = next[marker.register] !== 0;
      if (active && !previous[index] && hit === undefined) hit = marker.line;
      previous[index] = active;
    });
    return hit === undefined ? undefined : { kind: 'breakpoint', line: hit };
  };
}

/** Coordinates whose committed values differ, with both values, in coordinate order. */
export function stateChanges(before: ArrayLike<number>, after: ArrayLike<number>): { index: number; from: number; to: number }[] {
  const changes: { index: number; from: number; to: number }[] = [];
  for (let index = 0; index < after.length; index++) {
    if (before[index] !== after[index]) changes.push({ index, from: before[index]!, to: after[index]! });
  }
  return changes;
}

/** Parse the "Line N" location that compiler and parser diagnostics begin with. */
export function diagnosticLine(message: string): number | undefined {
  const match = /^Line (\d+)/.exec(message);
  return match ? Number(match[1]) : undefined;
}
