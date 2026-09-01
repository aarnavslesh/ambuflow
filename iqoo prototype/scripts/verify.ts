/**
 * Permanent dev verification for the geometry, green-wave and reducer logic.
 * KEEP THIS FILE. It is the only automated check the prototype has.
 *
 * ## Re-run this after ANY change to DEMO_ROUTE or DEMO_SIGNALS
 *
 * Signal trigger points are *derived* from route geometry (each on-route signal
 * is projected onto the polyline), never hardcoded. So nudging a single route
 * coordinate silently shifts when every signal turns green, and moving a task's
 * location silently decouples the task card from the junction its id names.
 * Neither failure shows up as a type error, and both look fine on screen until a
 * judge watches a card clear seconds before the ambulance arrives.
 *
 * Expected derived triggers for the current route (total arc length 178):
 *   A-thru = 50/178  ~ 0.2809
 *   B-thru = 100/178 ~ 0.5618
 *   C-thru = 143/178 ~ 0.8034
 * If a check below fails after an intentional route change, update the expected
 * numbers here — do not weaken the invariants (checks 4, 6, 19).
 *
 * ## How to run it
 *
 * `tsx` is deliberately not installed (the dependency list stays tiny), so
 * compile to a scratch dir and run the JS. The scratch dir must live under
 * node_modules/ so that `require('react')` from the compiled store still
 * resolves — and node_modules/ is already gitignored.
 *
 *   npx tsc scripts/verify.ts \
 *     --outDir node_modules/.cache/ambuflow-verify \
 *     --module commonjs --target es2020 --moduleResolution node \
 *     --esModuleInterop --strict --skipLibCheck
 *   node node_modules/.cache/ambuflow-verify/scripts/verify.js
 *
 * One line: (exits non-zero if any check fails)
 *
 *   npx tsc scripts/verify.ts --outDir node_modules/.cache/ambuflow-verify --module commonjs --target es2020 --moduleResolution node --esModuleInterop --strict --skipLibCheck && node node_modules/.cache/ambuflow-verify/scripts/verify.js
 *
 * Note: this script sets `process.exitCode` and never calls `process.exit()`.
 * That is load-bearing for check 9 — a leaked simulator interval would keep the
 * event loop alive and hang the run, which `process.exit()` would hide.
 */

import {
  DEMO_POLICE_TASKS,
  DEMO_ROUTE,
  DEMO_SIGNALS,
  type AmbulanceState,
  type PoliceTask,
} from '../data/mockData';
import {
  createInitialState,
  reducer,
  JOURNEY_DURATION_SECONDS,
  type EmergencyState,
} from '../store/emergencyStore';
import {
  createGpsSimulator,
  deriveSignalTriggers,
  getEtaSeconds,
  getPointAtProgress,
  getProgressAtPoint,
  getRouteLength,
  getSignalStates,
} from '../utils/gpsSimulator';

// ---- Tiny harness ----

const EPSILON = 1e-9;

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail === undefined ? '' : ` -- ${detail}`}`);
  }
}

function checkClose(label: string, actual: number, expected: number): void {
  check(
    label,
    Math.abs(actual - expected) < EPSILON,
    `expected ${expected}, got ${actual} (delta ${actual - expected})`,
  );
}

function section(title: string): void {
  console.log(`\n--- ${title} ---`);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

// ---- Shared fixtures ----

const TRIGGERS = deriveSignalTriggers(DEMO_ROUTE, DEMO_SIGNALS);

function triggerOf(signalId: string): number {
  const entry = TRIGGERS.find((candidate) => candidate.signalId === signalId);
  if (entry === undefined) throw new Error(`no derived trigger for ${signalId}`);
  return entry.trigger;
}

const FINAL_TRIGGER = Math.max(...TRIGGERS.map((entry) => entry.trigger));

/** An AmbulanceState as the simulator would emit it at progress p. */
function movedTo(p: number, isMoving = true): AmbulanceState {
  return {
    position: getPointAtProgress(DEMO_ROUTE, p),
    progress: p,
    etaSeconds: getEtaSeconds(DEMO_ROUTE, p, JOURNEY_DURATION_SECONDS),
    isMoving,
  };
}

/** Junctions whose cross-traffic signal is being held red at progress p. */
function junctionsHoldingCrossTraffic(p: number): string[] {
  const states = getSignalStates(DEMO_SIGNALS, DEMO_ROUTE, p, true);
  return DEMO_SIGNALS.filter(
    (signal) => !signal.onAmbulanceRoute && states[signal.id] === 'red',
  ).map((signal) => signal.intersectionId);
}

/** The junction directly ahead at p: smallest on-route trigger >= p, if any. */
function junctionAhead(p: number): string | undefined {
  const active = TRIGGERS.find((entry) => entry.trigger >= p);
  if (active === undefined) return undefined;
  return DEMO_SIGNALS.find((signal) => signal.id === active.signalId)?.intersectionId;
}

function taskById(tasks: PoliceTask[], id: string): PoliceTask {
  const task = tasks.find((candidate) => candidate.id === id);
  if (task === undefined) throw new Error(`no task ${id}`);
  return task;
}

function apply(state: EmergencyState, ...actions: Parameters<typeof reducer>[1][]): EmergencyState {
  return actions.reduce((current, action) => reducer(current, action), state);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// ---- 1-4: geometry ----

function checkGeometry(): void {
  section('Geometry');

  checkClose('1. getRouteLength(DEMO_ROUTE) === 178', getRouteLength(DEMO_ROUTE), 178);

  checkClose('2a. A-thru trigger === 50/178', triggerOf('A-thru'), 50 / 178);
  checkClose('2b. B-thru trigger === 100/178', triggerOf('B-thru'), 100 / 178);
  checkClose('2c. C-thru trigger === 143/178', triggerOf('C-thru'), 143 / 178);

  // 3. progress -> point -> back to the signal's own waypoint.
  for (const entry of TRIGGERS) {
    const signal = DEMO_SIGNALS.find((candidate) => candidate.id === entry.signalId);
    if (signal === undefined) throw new Error(`unknown signal ${entry.signalId}`);
    const point = getPointAtProgress(DEMO_ROUTE, entry.trigger);
    const offset = Math.hypot(point.x - signal.position.x, point.y - signal.position.y);
    check(
      `3. round-trip ${entry.signalId}: point at trigger is its waypoint`,
      offset < EPSILON,
      `offset ${offset} (got ${point.x},${point.y}; want ${signal.position.x},${signal.position.y})`,
    );
  }

  // 4. INVARIANT: a task's id suffix names the junction its location sits on.
  // Guards the coupling that makes auto-clearing honest -- if these drift, a
  // task card clears at a different moment than the ambulance passing the spot
  // the card points at.
  for (const task of DEMO_POLICE_TASKS) {
    const intersectionId = task.id.replace(/^task-/, '');
    const expected = triggerOf(`${intersectionId}-thru`);
    const actual = getProgressAtPoint(DEMO_ROUTE, task.location);
    check(
      `4. INVARIANT ${task.id} location sits on junction ${intersectionId}`,
      Math.abs(actual - expected) < EPSILON,
      `location at p=${actual.toFixed(4)}, junction clears at p=${expected.toFixed(4)} ` +
        `(${((actual - expected) * JOURNEY_DURATION_SECONDS).toFixed(1)}s apart)`,
    );
  }
}

// ---- 5-7: the green wave ----

function printGreenWaveTable(): void {
  section('Green wave (isMoving: true)');

  const ids = DEMO_SIGNALS.map((signal) => signal.id);
  const width = 8;
  const pad = (text: string): string => text.padEnd(width);

  console.log(`${pad('p')}${ids.map(pad).join('')}holding`);

  for (const p of [0.1, 0.4, 0.7, 0.95]) {
    const states = getSignalStates(DEMO_SIGNALS, DEMO_ROUTE, p, true);
    const holding = junctionsHoldingCrossTraffic(p);
    const row = ids.map((id) => pad(states[id])).join('');
    console.log(
      `${pad(p.toFixed(2))}${row}${holding.length === 0 ? 'none (past final junction)' : holding.join(',')}`,
    );
  }
  console.log('');
}

function checkGreenWaveInvariant(): void {
  // 6. At most one junction holds cross-traffic red, and it is always the one
  // directly ahead. Past the final junction the right answer is ZERO -- so this
  // asserts "matches the junction ahead", never "exactly one".
  const samples: number[] = [];
  for (let p = 0; p <= 1.0001; p += 0.005) samples.push(Math.min(p, 1));
  // Trigger boundaries are where off-by-one errors hide.
  for (const entry of TRIGGERS) {
    samples.push(entry.trigger, entry.trigger - 1e-6, entry.trigger + 1e-6);
  }

  let worstCount = 0;
  let mismatch: string | undefined;

  for (const p of samples) {
    const holding = junctionsHoldingCrossTraffic(p);
    worstCount = Math.max(worstCount, holding.length);

    const ahead = junctionAhead(p);
    const expected = ahead === undefined ? [] : [ahead];
    if (!deepEqual(holding, expected) && mismatch === undefined) {
      mismatch = `at p=${p.toFixed(6)} holding [${holding.join(',')}], junction ahead is ${ahead ?? 'none'}`;
    }
  }

  check(
    `6a. at most one junction ever holds cross-traffic red (max seen: ${worstCount})`,
    worstCount <= 1,
  );
  check('6b. the holding junction is always the one directly ahead', mismatch === undefined, mismatch);

  const pastFinal = [FINAL_TRIGGER + 1e-6, 0.85, 0.95, 1];
  const stillHolding = pastFinal.filter((p) => junctionsHoldingCrossTraffic(p).length > 0);
  check(
    '6c. past the final junction ZERO junctions hold cross-traffic red',
    stillHolding.length === 0,
    `still holding at p=${stillHolding.join(', ')}`,
  );

  // 7. At rest, every signal shows its seed colour.
  const atRest = getSignalStates(DEMO_SIGNALS, DEMO_ROUTE, 0, false);
  const drifted = DEMO_SIGNALS.filter((signal) => atRest[signal.id] !== signal.state);
  check(
    '7. at rest (isMoving: false) output matches seed `state` values',
    drifted.length === 0,
    drifted.map((signal) => `${signal.id}: seed ${signal.state}, got ${atRest[signal.id]}`).join('; '),
  );
}

// ---- 8: ETA ----

function checkEta(): void {
  section('ETA');

  check('8a. p=0 gives the full duration', getEtaSeconds(DEMO_ROUTE, 0, 45) === 45);
  check('8b. p=1 gives 0', getEtaSeconds(DEMO_ROUTE, 1, 45) === 0);
  check('8c. clamps p < 0 to the full duration', getEtaSeconds(DEMO_ROUTE, -5, 45) === 45);
  check('8d. clamps p > 1 to 0', getEtaSeconds(DEMO_ROUTE, 7, 45) === 0);

  const nonInteger: number[] = [];
  for (let p = 0; p <= 1.0001; p += 0.013) {
    const eta = getEtaSeconds(DEMO_ROUTE, p, 45);
    if (!Number.isInteger(eta)) nonInteger.push(p);
  }
  check(
    '8e. always a whole number of seconds',
    nonInteger.length === 0,
    `fractional at p=${nonInteger.join(', ')}`,
  );

  let monotonic = true;
  let previous = getEtaSeconds(DEMO_ROUTE, 0, 45);
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const eta = getEtaSeconds(DEMO_ROUTE, p, 45);
    if (eta > previous) monotonic = false;
    previous = eta;
  }
  check('8f. never counts upward as the ambulance advances', monotonic);
}

// ---- 9: the ticker ----

async function checkTicker(): Promise<void> {
  section('Ticker');

  const simulator = createGpsSimulator({
    route: DEMO_ROUTE,
    durationSeconds: 0.2,
    tickMs: 10,
  });

  const seen: AmbulanceState[] = [];
  const unsubscribe = simulator.subscribe((state) => {
    seen.push(state);
  });

  check('9a. subscribe() emits the current state immediately', seen.length === 1);

  simulator.start();
  // 0.2s at 10ms ticks = ~20 ticks; 600ms is generous headroom.
  const deadline = 600;
  const startedAt = Date.now();
  while (Date.now() - startedAt < deadline) {
    await sleep(20);
    const latest = seen[seen.length - 1];
    if (latest !== undefined && latest.progress >= 1) break;
  }

  const arrival = seen[seen.length - 1];
  check('9b. lands on exactly progress === 1', arrival !== undefined && arrival.progress === 1);
  check('9c. no progress sample ever exceeds 1', seen.every((state) => state.progress <= 1));
  check('9d. isMoving is false on arrival', arrival !== undefined && !arrival.isMoving);
  check('9e. ETA reaches 0 on arrival', arrival !== undefined && arrival.etaSeconds === 0);

  // Auto-cleared its own interval: no further emissions after arrival.
  const countAtArrival = seen.length;
  await sleep(120);
  check(
    '9f. auto-clears its interval on arrival (no emissions after)',
    seen.length === countAtArrival,
    `${seen.length - countAtArrival} late emissions`,
  );
  unsubscribe();

  // unsubscribe() detaches. This uses a deliberately LONG-running simulator so
  // the leak check below has teeth: if the final reset() is ever dropped, the
  // live interval keeps Node's event loop alive and the run hangs for an hour
  // instead of quietly finishing ~200ms late.
  const leakProbe = createGpsSimulator({ route: DEMO_ROUTE, durationSeconds: 3600, tickMs: 10 });
  let probeEmissions = 0;
  const detach = leakProbe.subscribe(() => {
    probeEmissions++;
  });
  leakProbe.start();
  await sleep(60);
  check('9g. a running simulator emits to its listener', probeEmissions > 1);

  detach();
  const countAfterUnsubscribe = probeEmissions;
  await sleep(60);
  check(
    '9h. unsubscribe() detaches the listener (no emissions after)',
    probeEmissions === countAfterUnsubscribe,
    `${probeEmissions - countAfterUnsubscribe} emissions after unsubscribe`,
  );

  // The interval outlives unsubscribe by design -- listeners and the ticker are
  // separate concerns -- which is exactly why EmergencyProvider's cleanup calls
  // reset() as well as unsubscribing. Do the same here.
  leakProbe.reset();
  console.log(
    'PASS  9i. no leaked timer (this run exits on its own; a hang here IS the failure)',
  );
  passed++;
}

// ---- 10-19: the reducer ----

function checkReducer(): void {
  section('Reducer');

  const initial = createInitialState();

  // 10. Initial state.
  check('10a. emergency is null until reported', initial.emergency === null);
  check('10b. progress starts at 0', initial.ambulance.progress === 0);
  check('10c. isMoving starts false', !initial.ambulance.isMoving);
  check('10d. every task starts pending', initial.tasks.every((task) => task.status === 'pending'));
  check(
    '10e. signals start at their at-rest values',
    deepEqual(initial.signals, getSignalStates(DEMO_SIGNALS, DEMO_ROUTE, 0, false)),
  );

  // 11. report-emergency.
  const reportedAt = 1_700_000_000_000;
  const reported = reducer(initial, { type: 'report-emergency', reportedAt });
  check('11a. report-emergency populates emergency', reported.emergency !== null);
  check('11b. uses the supplied reportedAt', reported.emergency?.reportedAt === reportedAt);
  check(
    '11c. changes nothing else',
    deepEqual({ ...reported, emergency: null }, { ...initial, emergency: null }),
  );

  // 12. start-journey opens the wave before any tick arrives.
  const started = reducer(reported, { type: 'start-journey' });
  check('12a. start-journey sets isMoving true', started.ambulance.isMoving);
  check('12b. progress has not moved yet', started.ambulance.progress === 0);
  check('12c. A-thru is green before any tick', started.signals['A-thru'] === 'green');
  check('12d. A-cross is red before any tick', started.signals['A-cross'] === 'red');
  check(
    '12e. junctions further ahead stay red',
    started.signals['B-thru'] === 'red' && started.signals['C-thru'] === 'red',
  );

  // 13. Idempotent start.
  const startedTwice = reducer(started, { type: 'start-journey' });
  check('13. start-journey twice is a no-op (same state reference)', startedTwice === started);

  // 14. Mid-journey handoff A -> B.
  const atFourty = reducer(started, { type: 'ambulance-moved', ambulance: movedTo(0.4) });
  check('14a. A-thru released to normal green', atFourty.signals['A-thru'] === 'green');
  check('14b. A-cross released to normal green', atFourty.signals['A-cross'] === 'green');
  check('14c. B-thru green (junction directly ahead)', atFourty.signals['B-thru'] === 'green');
  check('14d. B-cross holding red', atFourty.signals['B-cross'] === 'red');
  check('14e. C-thru still red (not its turn)', atFourty.signals['C-thru'] === 'red');
  check(
    '14f. exactly one junction holding at p=0.4',
    junctionsHoldingCrossTraffic(0.4).length === 1,
  );

  // 15. Acknowledge, then drive past the junction.
  const acknowledgedA = reducer(started, { type: 'acknowledge-task', id: 'task-A' });
  check(
    '15a. acknowledge moves task-A pending -> acknowledged',
    taskById(acknowledgedA.tasks, 'task-A').status === 'acknowledged',
  );
  const pastA = reducer(acknowledgedA, {
    type: 'ambulance-moved',
    ambulance: movedTo(triggerOf('A-thru') + 0.01),
  });
  check(
    '15b. passing junction A clears the acknowledged task-A',
    taskById(pastA.tasks, 'task-A').status === 'cleared',
  );
  check(
    '15c. unacknowledged tasks are left alone (pending is the "nobody responded" signal)',
    taskById(pastA.tasks, 'task-B').status === 'pending',
  );

  // 16. THE REGRESSION: arrive first, acknowledge afterwards. The ticker has
  // stopped emitting by then, so this must resolve inside acknowledge-task
  // itself -- no further tick will ever come.
  const arrived = reducer(started, { type: 'ambulance-moved', ambulance: movedTo(1, false) });
  const acknowledgedAfterArrival = reducer(arrived, { type: 'acknowledge-task', id: 'task-A' });
  check(
    '16. REGRESSION: acknowledging after arrival clears immediately, with no further tick',
    taskById(acknowledgedAfterArrival.tasks, 'task-A').status === 'cleared',
    `got ${taskById(acknowledgedAfterArrival.tasks, 'task-A').status}`,
  );
  check(
    '16b. all three junctions are behind us at p=1, so all acknowledged tasks clear',
    (['task-A', 'task-B', 'task-C'] as const).every(
      (id) => taskById(apply(arrived, { type: 'acknowledge-task', id }).tasks, id).status === 'cleared',
    ),
  );

  // 17. Junction still ahead -> stays acknowledged.
  const earlyAck = apply(
    started,
    { type: 'ambulance-moved', ambulance: movedTo(0.1) },
    { type: 'acknowledge-task', id: 'task-C' },
  );
  check(
    '17. acknowledging a junction still ahead stays acknowledged, not cleared',
    taskById(earlyAck.tasks, 'task-C').status === 'acknowledged',
    `got ${taskById(earlyAck.tasks, 'task-C').status}`,
  );

  // 18. clear-task only advances from acknowledged.
  const clearedFromPending = reducer(started, { type: 'clear-task', id: 'task-B' });
  check(
    '18a. clear-task does not touch a pending task',
    taskById(clearedFromPending.tasks, 'task-B').status === 'pending',
  );
  check('18b. and returns the same state reference (no wasted render)', clearedFromPending === started);
  const clearedFromAck = reducer(earlyAck, { type: 'clear-task', id: 'task-C' });
  check(
    '18c. clear-task advances acknowledged -> cleared',
    taskById(clearedFromAck.tasks, 'task-C').status === 'cleared',
  );
  check(
    '18d. an unknown task id is a no-op (same state reference)',
    reducer(started, { type: 'clear-task', id: 'task-nope' }) === started &&
      reducer(started, { type: 'acknowledge-task', id: 'task-nope' }) === started,
  );
  check(
    '18e. re-acknowledging an acknowledged task is a no-op (same state reference)',
    reducer(acknowledgedA, { type: 'acknowledge-task', id: 'task-A' }) === acknowledgedA,
  );

  // 19. reset is a true rewind. Both runs replay the SAME action sequence, so
  // any difference is the store failing to rewind rather than a different demo.
  const demoSequence: Parameters<typeof reducer>[1][] = [
    { type: 'report-emergency', reportedAt },
    { type: 'start-journey' },
    { type: 'acknowledge-task', id: 'task-A' },
    { type: 'ambulance-moved', ambulance: movedTo(0.7) },
  ];

  const firstRun = apply(initial, ...demoSequence);
  const afterReset = reducer(firstRun, { type: 'reset' });
  check('19a. reset is deep-equal to a fresh initial state', deepEqual(afterReset, createInitialState()));
  check('19b. reset drops the emergency', afterReset.emergency === null);
  check('19c. reset rewinds every task to pending', afterReset.tasks.every((t) => t.status === 'pending'));
  check(
    '19d. reset tasks are fresh objects, not the DEMO_POLICE_TASKS seed objects',
    afterReset.tasks.every((task, index) => task !== DEMO_POLICE_TASKS[index]),
  );
  check(
    '19e. the seed data itself was never mutated',
    DEMO_POLICE_TASKS.every((task) => task.status === 'pending'),
  );

  // Re-running the demo must look identical the second time.
  const secondRun = apply(afterReset, ...demoSequence);
  check(
    '19f. replaying the same sequence after reset reaches an identical state (demo is repeatable)',
    deepEqual(secondRun, firstRun),
  );
  check(
    '19g. reset from a fresh state is also clean',
    deepEqual(reducer(createInitialState(), { type: 'reset' }), createInitialState()),
  );
}

// ---- Runner ----

async function main(): Promise<void> {
  console.log('ambuflow verification\n=====================');

  checkGeometry();
  printGreenWaveTable();
  checkGreenWaveInvariant();
  checkEta();
  checkReducer();
  await checkTicker();

  console.log(`\n=====================\n${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\nIf DEMO_ROUTE or DEMO_SIGNALS changed on purpose, update the expected');
    console.log('triggers in this file\'s header comment -- do not weaken the invariants.');
    // exitCode, not exit(): see the header note on check 9h.
    process.exitCode = 1;
  }
}

void main();
