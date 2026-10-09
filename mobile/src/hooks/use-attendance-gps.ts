import { useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';

// Warm GPS only on the visible attendance screen, with permission already granted.
// No permission prompt, background task, upload or stateful tracking history.
export function useAttendanceGps() {
  const latest = useRef<Location.LocationObject | null>(null);
  useFocusEffect(useCallback(() => {
    let generation = 0;
    let subscription: Location.LocationSubscription | undefined;
    const stop = () => { generation++; subscription?.remove(); subscription = undefined; latest.current = null; };
    const start = async () => {
      stop();
      const current = generation;
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (current !== generation || !permission.granted || !(await Location.hasServicesEnabledAsync())) return;
        if (current !== generation) return;
        const watch = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 }, value => {
          if (current === generation) latest.current = value;
        });
        if (current !== generation) watch.remove(); else subscription = watch;
      } catch { /* The explicit attendance action reports GPS/permission errors. */ }
    };
    if (AppState.currentState === 'active') void start();
    const appState = AppState.addEventListener('change', state => { if (state === 'active') void start(); else stop(); });
    return () => { stop(); appState.remove(); };
  }, []));
  return latest;
}
