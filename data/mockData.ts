/**
 * Single source of truth for the app's mock data and types — there is no backend.
 *
 * All positions use a normalized 0-100 coordinate space on both axes
 * (0,0 = map top-left, 100,100 = bottom-right); the UI scales to pixels later.
 */

// ---- Types (the contract) ----

export interface Point {
  x: number;
  y: number;
}

export type Role = 'citizen' | 'ambulance' | 'police' | 'hospital' | 'traffic';

export type SignalState = 'red' | 'green';

export interface Signal {
  id: string;
  position: Point;
  /** At-rest seed value. */
  state: SignalState;
  /** Signals sharing this id are the same junction. */
  intersectionId: string;
  /** True = the direction the ambulance travels through. */
  onAmbulanceRoute: boolean;
  /**
   * Manual override only; normally derived by the simulator.
   * Leave unset in seed data.
   */
  triggerAtProgress?: number;
}

export type TaskStatus = 'pending' | 'acknowledged' | 'cleared';

export interface PoliceTask {
  id: string;
  title: string;
  location: Point;
  status: TaskStatus;
}

export interface Emergency {
  id: string;
  /** Pickup = route start. */
  location: Point;
  /** Epoch ms. */
  reportedAt: number;
  patientName?: string;
  notes?: string;
}

export interface Landmark {
  id: string;
  label: string;
  position: Point;
}

/** Runtime output of the simulator/store, not seed data. */
export interface AmbulanceState {
  position: Point;
  progress: number;
  etaSeconds: number;
  isMoving: boolean;
}

// ---- Seed data ----

export const DEMO_LANDMARKS: Landmark[] = [
  { id: 'station', label: 'Ambulance Station', position: { x: 14, y: 90 } },
  { id: 'hospital', label: 'City Hospital', position: { x: 88, y: 25 } },
];

export const DEMO_EMERGENCY: Emergency = {
  id: 'emg-1',
  location: { x: 20, y: 85 },
  reportedAt: Date.now(),
  notes: 'Caller reports an unresponsive adult',
};

// Single leg: pickup -> hospital. Waypoints 2, 4 and 6 are junctions A, B, C.
export const DEMO_ROUTE: Point[] = [
  { x: 20, y: 85 }, // 0  start / pickup
  { x: 20, y: 60 }, // 1
  { x: 45, y: 60 }, // 2  Junction A
  { x: 45, y: 35 }, // 3
  { x: 70, y: 35 }, // 4  Junction B
  { x: 70, y: 60 }, // 5
  { x: 88, y: 60 }, // 6  Junction C
  { x: 88, y: 25 }, // 7  hospital / end
];

// Each junction: one on-route signal sitting exactly on its route waypoint,
// plus one cross-traffic signal offset nearby for display.
export const DEMO_SIGNALS: Signal[] = [
  { id: 'A-thru', intersectionId: 'A', onAmbulanceRoute: true, position: { x: 45, y: 60 }, state: 'red' },
  { id: 'A-cross', intersectionId: 'A', onAmbulanceRoute: false, position: { x: 49, y: 57 }, state: 'green' },
  { id: 'B-thru', intersectionId: 'B', onAmbulanceRoute: true, position: { x: 70, y: 35 }, state: 'red' },
  { id: 'B-cross', intersectionId: 'B', onAmbulanceRoute: false, position: { x: 66, y: 38 }, state: 'green' },
  { id: 'C-thru', intersectionId: 'C', onAmbulanceRoute: true, position: { x: 88, y: 60 }, state: 'red' },
  { id: 'C-cross', intersectionId: 'C', onAmbulanceRoute: false, position: { x: 84, y: 63 }, state: 'green' },
];

export const DEMO_POLICE_TASKS: PoliceTask[] = [
  { id: 'task-A', title: 'Clear Junction A for ambulance', location: { x: 45, y: 60 }, status: 'pending' },
  { id: 'task-B', title: 'Hold cross-traffic at Junction B', location: { x: 70, y: 35 }, status: 'pending' },
  { id: 'task-C', title: 'Escort at hospital approach', location: { x: 88, y: 40 }, status: 'pending' },
];
