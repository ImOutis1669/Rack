import type { QueryClient } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import { Session, type KeyStore } from './session';

const KEYCHAIN = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/** Keychain items readable only while this iPhone is unlocked, never synced or backed up elsewhere. */
const keychain: KeyStore = {
  getItemAsync: (k) => SecureStore.getItemAsync(k, KEYCHAIN),
  setItemAsync: (k, v) => SecureStore.setItemAsync(k, v, KEYCHAIN),
  deleteItemAsync: (k) => SecureStore.deleteItemAsync(k, KEYCHAIN),
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
  const [session] = useState(
    () =>
      new Session(keychain, {
        defaultServer: process.env.EXPO_PUBLIC_RACK_URL ?? null,
        clearCache: () => queryClient.clear(),
      }),
  );
  useEffect(() => {
    session.load().catch(() => void session.signOut());
  }, [session]);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** The session, re-rendering when its status or server changes. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession outside SessionProvider');
  useSyncExternalStore(
    (fn) => session.subscribe(fn),
    () => `${session.status}|${session.server}`,
  );
  return session;
}
