// Face ID lock (iOS step 8). The token stays in the Keychain (this device, while unlocked);
// this gate asks for Face ID (or the passcode) before showing anything: on every cold start
// with a saved login, and after a minute in the background. While the app is in the app
// switcher a cover hides the screen, so the snapshot iOS takes shows nothing private.
// Not after a fresh login (the password just did that job). Settings can turn it off.
import { Image } from 'expo-image';
import * as LocalAuthentication from 'expo-local-authentication';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useSession } from '@/lib/auth';
import { LOCK_KEY, lockEnabled, shouldRelock } from '@/lib/lockPolicy';
import { kv } from '@/lib/storage';
import { useTheme } from '@/theme/ThemeProvider';

interface LockApi {
  /** The iPhone has Face ID / Touch ID or a passcode. */
  available: boolean;
  enabled: boolean;
  biometryName: string;
  /** Turning it off asks for Face ID first. */
  setEnabled: (on: boolean) => Promise<void>;
}
const Ctx = createContext<LockApi>({ available: false, enabled: false, biometryName: 'Face ID', setEnabled: async () => undefined });
export const useAppLock = () => useContext(Ctx);

async function authenticate(prompt: string): Promise<boolean> {
  const r = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, fallbackLabel: 'Use passcode' });
  return r.success;
}

export function AppLock({ children }: { children: ReactNode }) {
  const session = useSession();
  const { text } = useTheme();
  const [available, setAvailable] = useState(false);
  const [checked, setChecked] = useState(false);
  const [biometryName, setBiometryName] = useState('Face ID');
  const [stored, setStored] = useState<string | null>(() => kv.getItem(LOCK_KEY));
  const enabled = lockEnabled(stored, available);
  const [locked, setLocked] = useState(true);
  const [covered, setCovered] = useState(false);
  const backgroundedAt = useRef<number | null>(null);
  const prevStatus = useRef(session.status);
  const prompting = useRef(false);

  useEffect(() => {
    void (async () => {
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      setAvailable(level !== LocalAuthentication.SecurityLevel.NONE);
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      if (!types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        setBiometryName(types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT) ? 'Touch ID' : 'passcode');
      }
      setChecked(true);
    })();
  }, []);

  // a fresh login doesn't need unlocking; a saved one at start-up does
  useEffect(() => {
    if (prevStatus.current === 'signedOut' && session.status === 'signedIn') setLocked(false);
    prevStatus.current = session.status;
  }, [session.status]);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      if (await authenticate('Unlock Rack')) setLocked(false);
    } finally {
      prompting.current = false;
    }
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') backgroundedAt.current = Date.now();
      // the Face ID sheet itself makes the app "inactive": only cover when not prompting
      if (s !== 'active' && !prompting.current) setCovered(true);
      if (s === 'active') {
        setCovered(false);
        if (shouldRelock(backgroundedAt.current, Date.now())) setLocked(true);
        backgroundedAt.current = null;
      }
    });
    return () => sub.remove();
  }, []);

  const signedIn = session.status === 'signedIn';
  const showLock = checked && enabled && signedIn && locked;
  // ask straight away when the lock shows (start-up, coming back)
  useEffect(() => {
    if (showLock && AppState.currentState === 'active') void unlock();
  }, [showLock, unlock]);

  const setEnabled = async (on: boolean) => {
    if (!on && !(await authenticate(`Turn off ${biometryName}`))) return;
    kv.setItem(LOCK_KEY, on ? 'on' : 'off');
    setStored(on ? 'on' : 'off');
  };

  const showCover = signedIn && enabled && (covered || showLock || !checked);
  return (
    <Ctx.Provider value={{ available, enabled, biometryName, setEnabled }}>
      {children}
      <Modal visible={showCover} animationType="none" presentationStyle="fullScreen" statusBarTranslucent>
        <View style={[styles.cover, { backgroundColor: '#0A0A0A' }]}>
          <Image source={require('../../../assets/images/icon.png')} style={styles.icon} accessibilityIgnoresInvertColors accessible={false} />
          {showLock && !covered ? (
            <View style={styles.lockText}>
              <Text accessibilityRole="header" style={[text('title'), { color: '#F5F5F5' }]}>
                Rack is locked
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void unlock()}
                style={({ pressed }) => [styles.button, { backgroundColor: '#F5F5F5', transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
                <Text style={[text('headline'), { fontSize: 17, color: '#0A0A0A' }]}>
                  {biometryName === 'passcode' ? 'Unlock' : `Unlock with ${biometryName}`}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Modal>
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  cover: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 32 },
  icon: { width: 120, height: 120, borderRadius: 27 },
  lockText: { alignItems: 'center', gap: 20 },
  button: { minHeight: 50, borderRadius: 25, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' },
});
