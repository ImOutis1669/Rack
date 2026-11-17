// TanStack Query on iOS: refetch when the app comes back to the foreground, and pause /
// resume with the network (the web gets both from the browser).
import { focusManager, onlineManager } from '@tanstack/react-query';
import { addNetworkStateListener } from 'expo-network';
import { AppState } from 'react-native';

let wired = false;

export function wireQueryToDevice(): void {
  if (wired) return;
  wired = true;
  onlineManager.setEventListener((setOnline) => {
    const sub = addNetworkStateListener((s) => setOnline(s.isConnected !== false));
    return () => sub.remove();
  });
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener('change', (s) => setFocused(s === 'active'));
    return () => sub.remove();
  });
}
