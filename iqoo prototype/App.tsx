import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

import { DebugPanel } from './components/DebugPanel';
import { EmergencyProvider } from './store/emergencyStore';

export default function App() {
  return (
    <EmergencyProvider>
      <View style={styles.container}>
        <DebugPanel />
        <StatusBar style="auto" />
      </View>
    </EmergencyProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
