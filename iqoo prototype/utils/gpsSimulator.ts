/**
 * Deterministic GPS + green-wave simulator.
 *
 * The only mutable state is `progress` (p): a number in [0,1] measuring
 * arc-length distance travelled along the route. Position, ETA and every
 * signal colour are pure functions of p, exported separately from the ticker so
 * they stay unit-testable. Signal state is never stored — always recomputed.
 */

import {
  DEMO_ROUTE,
  type AmbulanceState,
  type Point,
  type Signal,
  type SignalState,
} from '../data/mockData';

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

// ---- Route geometry (pure) ----

/** Total arc length of the polyline. */
export function getRouteLength(route: Point[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    total += distance(route[i - 1], route[i]);
  }
  return total;
}

/**
 * Point at progress p, by walking segments until the target arc length falls
 * inside one, then interpolating linearly within it.
 */
export function getPointAtProgress(route: Point[], p: number): Point {
  if (route.length === 0) {
    throw new Error('getPointAtProgress: route must contain at least one point');
  }

  const target = getRouteLength(route) * clamp01(p);
  let travelled = 0;

  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const segmentLength = distance(a, b);
    if (segmentLength === 0) continue;

    if (travelled + segmentLength >= target) {
      const t = (target - travelled) / segmentLength;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    travelled += segmentLength;
  }

  // p === 1, or a zero-length route.
  return route[route.length - 1];
}

/**
 * Progress of `point` projected onto the polyline: the closest point on each
 * segment (clamped scalar projection), globally nearest one wins.
 */
export function getProgressAtPoint(route: Point[], point: Point): number {
  const total = getRouteLength(route);
  if (route.length < 2 || total === 0) return 0;

  let bestDistanceSq = Infinity;
  let bestTravelled = 0;
  let travelled = 0;

  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segmentLengthSq = dx * dx + dy * dy;
    if (segmentLengthSq === 0) continue;

    const raw = ((point.x - a.x) * dx + (point.y - a.y) * dy) / segmentLengthSq;
    const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;

    const offsetX = point.x - (a.x + dx * t);
    const offsetY = point.y - (a.y + dy * t);
    const distanceSq = offsetX * offsetX + offsetY * offsetY;

    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestTravelled = travelled + Math.sqrt(segmentLengthSq) * t;
    }
    travelled += Math.sqrt(segmentLengthSq);
  }

  return clamp01(bestTravelled / total);
}

// ---- Trigger derivation (pure) ----

export interface SignalTrigger {
  signalId: string;
  trigger: number;
}

/**
 * Where along the route each on-route signal fires, ascending. Derived from
 * geometry unless a signal pins it with `triggerAtProgress`.
 */
export function deriveSignalTriggers(route: Point[], signals: Signal[]): SignalTrigger[] {
  return signals
    .filter((signal) => signal.onAmbulanceRoute)
    .map((signal) => ({
      signalId: signal.id,
      trigger: signal.triggerAtProgress ?? getProgressAtPoint(route, signal.position),
    }))
    .sort((a, b) => a.trigger - b.trigger);
}

// ---- The green-wave rule (pure) ----

/**
 * Every signal's colour as a function of p.
 *
 * The active signal is the on-route signal with the smallest trigger >= p — the
 * junction directly ahead. Only that junction holds its cross-traffic red;
 * greening a junction two ahead would pull cross traffic into the corridor in
 * front of the ambulance.
 */
export function getSignalStates(
  signals: Signal[],
  route: Point[],
  p: number,
  isMoving: boolean,
): Record<string, SignalState> {
  const states: Record<string, SignalState> = {};

  // Journey not started: hold the whole route, cross traffic runs as normal.
  if (!isMoving) {
    for (const signal of signals) {
      states[signal.id] = signal.onAmbulanceRoute ? 'red' : 'green';
    }
    return states;
  }

  const progress = clamp01(p);
  const triggers = deriveSignalTriggers(route, signals);
  const active = triggers.find((entry) => entry.trigger >= progress);
  const triggerById = new Map(triggers.map((entry) => [entry.signalId, entry.trigger]));

  const activeIntersectionId = active
    ? signals.find((signal) => signal.id === active.signalId)?.intersectionId
    : undefined;

  for (const signal of signals) {
    if (!signal.onAmbulanceRoute) {
      states[signal.id] = signal.intersectionId === activeIntersectionId ? 'red' : 'green';
      continue;
    }

    if (active === undefined || signal.id === active.signalId) {
      // Past every junction, or this is the junction directly ahead.
      states[signal.id] = 'green';
      continue;
    }

    const trigger = triggerById.get(signal.id);
    const alreadyPassed = trigger !== undefined && trigger < progress;
    states[signal.id] = alreadyPassed ? 'green' : 'red';
  }

  return states;
}

// ---- ETA (pure) ----

export function getEtaSeconds(route: Point[], p: number, durationSeconds: number): number {
  return Math.round((1 - clamp01(p)) * durationSeconds);
}

// ---- The ticker ----

export interface GpsSimulatorOptions {
  route?: Point[];
  durationSeconds?: number;
  tickMs?: number;
}

export interface GpsSimulator {
  start(): void;
  pause(): void;
  reset(): void;
  subscribe(listener: (state: AmbulanceState) => void): () => void;
}

/**
 * Advances p on an interval and pushes AmbulanceState to subscribers.
 *
 * Pacing is a total duration rather than a speed, so the demo run length is
 * directly tunable regardless of route length.
 */
export function createGpsSimulator(opts?: GpsSimulatorOptions): GpsSimulator {
  const route = opts?.route ?? DEMO_ROUTE;
  const durationSeconds = opts?.durationSeconds ?? 45;
  const tickMs = opts?.tickMs ?? 50;
  const increment = tickMs / (durationSeconds * 1000);

  let progress = 0;
  let isMoving = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<(state: AmbulanceState) => void>();

  const snapshot = (): AmbulanceState => ({
    position: getPointAtProgress(route, progress),
    progress,
    etaSeconds: getEtaSeconds(route, progress, durationSeconds),
    isMoving,
  });

  const emit = (): void => {
    const state = snapshot();
    for (const listener of listeners) {
      listener(state);
    }
  };

  const clearTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const tick = (): void => {
    progress = clamp01(progress + increment);
    if (progress >= 1) {
      isMoving = false;
      clearTimer();
    }
    emit();
  };

  return {
    start() {
      if (timer !== null || progress >= 1) return;
      isMoving = true;
      timer = setInterval(tick, tickMs);
    },

    pause() {
      clearTimer();
      isMoving = false;
      emit();
    },

    reset() {
      clearTimer();
      progress = 0;
      isMoving = false;
      emit();
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
