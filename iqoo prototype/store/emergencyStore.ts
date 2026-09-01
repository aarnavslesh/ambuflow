/**
 * The one shared state layer every role screen subscribes to — the mock
 * stand-in for a backend API.
 *
 * Context + useReducer, no external state library. The reducer owns the
 * *derived* view of the world (signal colours, task statuses); the ticker in
 * utils/gpsSimulator owns progress `p`. Green-wave rules are never
 * reimplemented here — every signal colour comes from getSignalStates(), and
 * "which junctions have we passed" comes from deriveSignalTriggers(). This file
 * only decides *when* to ask.
 *
 * DEMO_SIGNALS and DEMO_ROUTE are passed explicitly into every simulator call
 * so the seed data a screen is looking at stays visible at the call site.
 *
 * No JSX: the file is .ts, so the provider builds its element with
 * createElement.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';

import {
  DEMO_EMERGENCY,
  DEMO_POLICE_TASKS,
  DEMO_ROUTE,
  DEMO_SIGNALS,
  type AmbulanceState,
  type Emergency,
  type PoliceTask,
  type SignalState,
} from '../data/mockData';
import {
  createGpsSimulator,
  deriveSignalTriggers,
  getEtaSeconds,
  getPointAtProgress,
  getSignalStates,
  type GpsSimulator,
} from '../utils/gpsSimulator';

/** Wall-clock length of one demo run, shared by the ticker and the initial ETA. */
export const JOURNEY_DURATION_SECONDS = 45;

/** `task-A` belongs to intersection `A`. */
const TASK_ID_PREFIX = 'task-';

// ---- Derived-once lookups ----

// Triggers are pure functions of the seed data, so they are computed once at
// module load rather than on every tick.
const ON_ROUTE_TRIGGERS = deriveSignalTriggers(DEMO_ROUTE, DEMO_SIGNALS);

const INTERSECTION_BY_SIGNAL_ID = new Map(
  DEMO_SIGNALS.map((signal) => [signal.id, signal.intersectionId]),
);

// ---- State ----

export interface EmergencyState {
  /** null until the citizen reports. */
  emergency: Emergency | null;
  ambulance: AmbulanceState;
  signals: Record<string, SignalState>;
  tasks: PoliceTask[];
}

/**
 * A factory rather than a frozen constant: reset() hands back genuinely fresh
 * objects, so no run of the demo can leave the next one holding mutated seed
 * data.
 *
 * Exported for scripts/verify.ts — pure, no React.
 */
export function createInitialState(): EmergencyState {
  return {
    emergency: null,
    ambulance: {
      position: getPointAtProgress(DEMO_ROUTE, 0),
      progress: 0,
      etaSeconds: getEtaSeconds(DEMO_ROUTE, 0, JOURNEY_DURATION_SECONDS),
      isMoving: false,
    },
    signals: getSignalStates(DEMO_SIGNALS, DEMO_ROUTE, 0, false),
    tasks: DEMO_POLICE_TASKS.map((task) => ({ ...task })),
  };
}

// ---- Actions ----

export type EmergencyAction =
  | { type: 'report-emergency'; reportedAt: number }
  | { type: 'start-journey' }
  | { type: 'ambulance-moved'; ambulance: AmbulanceState }
  | { type: 'acknowledge-task'; id: string }
  | { type: 'clear-task'; id: string }
  | { type: 'reset' };

// ---- Reducer helpers ----

/**
 * Intersections the ambulance has already driven through: an on-route signal
 * counts as passed once progress is beyond its derived trigger — the same
 * comparison getSignalStates uses internally.
 */
function getPassedIntersectionIds(progress: number): Set<string> {
  const passed = new Set<string>();
  for (const entry of ON_ROUTE_TRIGGERS) {
    if (entry.trigger >= progress) continue;
    const intersectionId = INTERSECTION_BY_SIGNAL_ID.get(entry.signalId);
    if (intersectionId !== undefined) passed.add(intersectionId);
  }
  return passed;
}

/** `task-A` -> `A`; ids without the prefix are returned untouched. */
function taskIntersectionId(taskId: string): string {
  return taskId.startsWith(TASK_ID_PREFIX) ? taskId.slice(TASK_ID_PREFIX.length) : taskId;
}

/**
 * Police tasks follow the ambulance: once its junction is behind the
 * ambulance, an acknowledged task is done. Written as an invariant — re-checked
 * on every tick and on every acknowledgement — instead of a one-shot edge, so
 * nothing depends on catching the exact tick a junction flips, and a late
 * acknowledgement still resolves after the ticker has stopped.
 *
 * 'pending' is deliberately left alone — an unacknowledged task staying open is
 * the signal that nobody responded.
 */
function clearPassedTasks(tasks: PoliceTask[], progress: number): PoliceTask[] {
  const passed = getPassedIntersectionIds(progress);
  let changed = false;

  const next = tasks.map((task) => {
    if (task.status !== 'acknowledged') return task;
    if (!passed.has(taskIntersectionId(task.id))) return task;
    changed = true;
    return { ...task, status: 'cleared' as const };
  });

  return changed ? next : tasks;
}

/**
 * Signals are recomputed 20x a second but rarely actually change. Handing back
 * the previous object when every colour matches keeps the reference stable for
 * memoized consumers.
 */
function preserveIfUnchanged(
  previous: Record<string, SignalState>,
  next: Record<string, SignalState>,
): Record<string, SignalState> {
  const previousIds = Object.keys(previous);
  if (previousIds.length !== Object.keys(next).length) return next;
  for (const id of previousIds) {
    if (previous[id] !== next[id]) return next;
  }
  return previous;
}

function setTaskStatus(
  tasks: PoliceTask[],
  id: string,
  from: PoliceTask['status'],
  to: PoliceTask['status'],
): PoliceTask[] {
  let changed = false;

  const next = tasks.map((task) => {
    if (task.id !== id || task.status !== from) return task;
    changed = true;
    return { ...task, status: to };
  });

  return changed ? next : tasks;
}

// ---- Reducer ----

/**
 * The whole state machine, pure and React-free — exported so
 * scripts/verify.ts can drive it directly without a renderer.
 */
export function reducer(state: EmergencyState, action: EmergencyAction): EmergencyState {
  switch (action.type) {
    case 'report-emergency':
      return {
        ...state,
        emergency: { ...DEMO_EMERGENCY, reportedAt: action.reportedAt },
      };

    case 'start-journey': {
      if (state.ambulance.isMoving) return state;
      // Flip isMoving here rather than waiting for the first emission, so the
      // green wave is on screen the instant the button is pressed; the tick
      // that lands one interval later confirms it.
      const ambulance = { ...state.ambulance, isMoving: true };
      return {
        ...state,
        ambulance,
        signals: preserveIfUnchanged(
          state.signals,
          getSignalStates(DEMO_SIGNALS, DEMO_ROUTE, ambulance.progress, true),
        ),
      };
    }

    case 'ambulance-moved': {
      const { ambulance } = action;
      return {
        ...state,
        ambulance,
        signals: preserveIfUnchanged(
          state.signals,
          getSignalStates(DEMO_SIGNALS, DEMO_ROUTE, ambulance.progress, ambulance.isMoving),
        ),
        tasks: clearPassedTasks(state.tasks, ambulance.progress),
      };
    }

    case 'acknowledge-task': {
      // Re-check the passed-junction invariant here too, not just on a tick:
      // after arrival the ticker stops emitting, so acknowledging a junction the
      // ambulance has already cleared would otherwise stay 'acknowledged'
      // forever.
      const acknowledged = setTaskStatus(state.tasks, action.id, 'pending', 'acknowledged');
      const tasks = clearPassedTasks(acknowledged, state.ambulance.progress);
      // Unknown id, or wrong status: hand back the identical state so useReducer
      // bails out instead of re-rendering all five screens for nothing.
      return tasks === state.tasks ? state : { ...state, tasks };
    }

    case 'clear-task': {
      const tasks = setTaskStatus(state.tasks, action.id, 'acknowledged', 'cleared');
      return tasks === state.tasks ? state : { ...state, tasks };
    }

    case 'reset':
      return createInitialState();
  }
}

// ---- Context ----

export interface EmergencyActions {
  /** Citizen taps report: the emergency appears for every other role. */
  reportEmergency(): void;
  /** Ambulance rolls: starts the ticker and opens the green wave. */
  startJourney(): void;
  acknowledgeTask(id: string): void;
  clearTask(id: string): void;
  /** Full rewind, so the demo can be run again without restarting the app. */
  reset(): void;
}

export type EmergencyContextValue = EmergencyState & EmergencyActions;

const EmergencyContext = createContext<EmergencyContextValue | null>(null);

export interface EmergencyProviderProps {
  children: ReactNode;
}

export function EmergencyProvider({ children }: EmergencyProviderProps): ReactElement {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);

  // One simulator for the provider's whole lifetime. Lazily created in a ref so
  // a re-render can never hand us a second ticker.
  const simulatorRef = useRef<GpsSimulator | null>(null);
  if (simulatorRef.current === null) {
    simulatorRef.current = createGpsSimulator({
      route: DEMO_ROUTE,
      durationSeconds: JOURNEY_DURATION_SECONDS,
    });
  }
  const simulator = simulatorRef.current;

  useEffect(() => {
    const unsubscribe = simulator.subscribe((ambulance) => {
      dispatch({ type: 'ambulance-moved', ambulance });
    });

    return () => {
      // Unsubscribe first, then reset: reset() clears the interval (a live
      // ticker with no listeners is exactly the leak we're avoiding) and its
      // emission lands with no listeners attached, so nothing dispatches into
      // an unmounted provider.
      unsubscribe();
      simulator.reset();
    };
  }, [simulator]);

  const reportEmergency = useCallback(() => {
    // Date.now() is read here, not in the reducer, to keep the reducer pure.
    dispatch({ type: 'report-emergency', reportedAt: Date.now() });
  }, []);

  const startJourney = useCallback(() => {
    dispatch({ type: 'start-journey' });
    simulator.start();
  }, [simulator]);

  const acknowledgeTask = useCallback((id: string) => {
    dispatch({ type: 'acknowledge-task', id });
  }, []);

  const clearTask = useCallback((id: string) => {
    dispatch({ type: 'clear-task', id });
  }, []);

  const reset = useCallback(() => {
    // Rewind the ticker first; its p=0 emission is then overwritten by the
    // reset action, which has the final word on state.
    simulator.reset();
    dispatch({ type: 'reset' });
  }, [simulator]);

  const value = useMemo<EmergencyContextValue>(
    () => ({
      ...state,
      reportEmergency,
      startJourney,
      acknowledgeTask,
      clearTask,
      reset,
    }),
    [state, reportEmergency, startJourney, acknowledgeTask, clearTask, reset],
  );

  return createElement(EmergencyContext.Provider, { value }, children);
}

export function useEmergency(): EmergencyContextValue {
  const value = useContext(EmergencyContext);
  if (value === null) {
    throw new Error('useEmergency must be called inside an <EmergencyProvider>');
  }
  return value;
}
