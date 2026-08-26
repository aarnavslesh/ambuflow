/**
 * THROWAWAY SCAFFOLDING — delete once the real role screens exist.
 *
 * An on-device smoke test for the three layers underneath it: data/mockData
 * (seed data), utils/gpsSimulator (the ticker + green wave) and
 * store/emergencyStore (the shared state). It renders raw state as text and
 * nothing else, so anything wrong shows up as a wrong number rather than as a
 * layout bug.
 *
 * Everything on screen comes from useEmergency(). No local state, no derived
 * geometry, no imports from mockData — if a value is wrong here, it is wrong in
 * the store.
 *
 * What to watch on device:
 *   - Report Emergency  -> emergency flips from "none" to emg-1 + a timestamp
 *   - Start Journey     -> isMoving yes, progress climbs, A-thru green /
 *                          A-cross red immediately, then the red cross-traffic
 *                          walks A -> B -> C and finally none
 *   - Acknowledge a task, then wait for the ambulance to pass that junction
 *                       -> its status jumps acknowledged -> cleared on its own
 *   - Reset             -> everything back to the first state, repeatably
 */

import { type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useEmergency } from '../store/emergencyStore';

interface DebugButtonProps {
  label: string;
  onPress: () => void;
}

function DebugButton({ label, onPress }: DebugButtonProps): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

export function DebugPanel(): ReactElement {
  const {
    emergency,
    ambulance,
    signals,
    tasks,
    reportEmergency,
    startJourney,
    acknowledgeTask,
    reset,
  } = useEmergency();

  return (
    // Scrollable so no row or button can end up off-screen on a small phone —
    // the whole point of this screen is being able to read every value.
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>ambuflow debug panel</Text>
      <Text style={styles.note}>temporary scaffolding — not a real screen</Text>

      <Text style={styles.section}>emergency</Text>
      {emergency === null ? (
        <Text style={styles.row}>none</Text>
      ) : (
        <>
          <Text style={styles.row}>id: {emergency.id}</Text>
          <Text style={styles.row}>reportedAt: {emergency.reportedAt}</Text>
          <Text style={styles.row}>
            reportedAt (local): {new Date(emergency.reportedAt).toLocaleTimeString()}
          </Text>
        </>
      )}

      <Text style={styles.section}>ambulance</Text>
      <Text style={styles.row}>progress: {(ambulance.progress * 100).toFixed(1)}%</Text>
      <Text style={styles.row}>
        position: {ambulance.position.x.toFixed(1)}, {ambulance.position.y.toFixed(1)}
      </Text>
      <Text style={styles.row}>etaSeconds: {ambulance.etaSeconds}</Text>
      <Text style={styles.row}>isMoving: {ambulance.isMoving ? 'yes' : 'no'}</Text>

      <Text style={styles.section}>signals</Text>
      {Object.entries(signals).map(([id, colour]) => (
        <Text key={id} style={styles.row}>
          {id}: {colour}
        </Text>
      ))}

      <Text style={styles.section}>tasks</Text>
      {tasks.map((task) => (
        <Text key={task.id} style={styles.row}>
          {task.id}: {task.status} — {task.title}
        </Text>
      ))}

      <Text style={styles.section}>actions</Text>
      <DebugButton label="Report Emergency" onPress={reportEmergency} />
      <DebugButton label="Start Journey" onPress={startJourney} />
      <DebugButton label="Reset" onPress={reset} />

      {tasks.map((task) => (
        <DebugButton
          key={task.id}
          label={`Acknowledge ${task.id}`}
          onPress={() => {
            acknowledgeTask(task.id);
          }}
        />
      ))}

      <View style={styles.tailSpace} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    // Keeps the heading clear of the Android status bar in Expo Go.
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  heading: {
    fontSize: 18,
    fontWeight: '600',
  },
  note: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  section: {
    marginTop: 14,
    marginBottom: 4,
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  row: {
    fontSize: 14,
    lineHeight: 20,
    // Monospace keeps the numbers from jittering as they tick.
    fontFamily: 'monospace',
  },
  button: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#888',
    borderRadius: 4,
  },
  buttonPressed: {
    backgroundColor: '#eee',
  },
  buttonLabel: {
    fontSize: 15,
    textAlign: 'center',
  },
  tailSpace: {
    height: 24,
  },
});
