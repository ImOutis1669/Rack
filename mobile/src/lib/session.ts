// The app's login session (iOS step 1 decided the design): a bearer token from
// POST /api/auth/token, kept in the iOS Keychain (expo-secure-store, this device only, never
// in the bundle or the repo). Logging out deletes it here; "log out everywhere" also revokes
// every token on the server. Any 401 signs the app out and clears what it cached.
import { createApi, type Api, UnauthorizedError } from '@rack/shared/client';

import { recordRequest } from './perfStore';

export const TOKEN_KEY = 'rack.token';
export const SERVER_KEY = 'rack.server';

/** The parts of expo-secure-store used here (injectable for tests). */
export interface KeyStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export type Status = 'loading' | 'signedOut' | 'signedIn';

/** "rack.example.ts.net" or "https://rack.example.ts.net/" -> "https://rack.example.ts.net". */
export function normalizeServer(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    // https only: the password and token must never cross the network in the clear
    if (u.protocol !== 'https:' || !u.hostname) return null;
    return `https://${u.host}`;
  } catch {
    return null;
  }
}

/** What to show under the password field. */
export function loginErrorMessage(err: unknown): string {
  if (err instanceof UnauthorizedError) return 'Wrong username or password';
  if (err instanceof TypeError) return "Can't reach Rack. Check that Tailscale is on.";
  const msg = err instanceof Error ? err.message : '';
  return msg || 'Something went wrong';
}

export class Session {
  status: Status = 'loading';
  server: string | null = null;
  private token: string | null = null;
  private listeners = new Set<() => void>();
  private apis = new Map<string, Api>();

  constructor(
    private store: KeyStore,
    private options: {
      /** Server from the build (EXPO_PUBLIC_RACK_URL), used until one is saved. */
      defaultServer?: string | null;
      fetch?: typeof fetch;
      /** Clear everything cached on the device (query cache, feed snapshot). */
      clearCache?: () => void | Promise<void>;
    } = {},
  ) {
    this.server = normalizeServer(options.defaultServer ?? '') ?? null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<Pick<Session, 'status' | 'server'>>) {
    Object.assign(this, patch);
    this.listeners.forEach((fn) => fn());
  }

  /** Reads the Keychain at start-up. */
  async load(): Promise<void> {
    const [token, server] = await Promise.all([
      this.store.getItemAsync(TOKEN_KEY),
      this.store.getItemAsync(SERVER_KEY),
    ]);
    this.token = token;
    const saved = server ? normalizeServer(server) : null;
    this.set({ server: saved ?? this.server, status: token && (saved ?? this.server) ? 'signedIn' : 'signedOut' });
  }

  /** Headers for requests the app makes itself (photos through expo-image). */
  imageHeaders(): Record<string, string> {
    // AVIF where the server has it (expo-image decodes it), like Safari
    return { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), Accept: 'image/avif,image/webp,*/*;q=0.5' };
  }

  /** The API for a server, sending this session's token. */
  api(server = this.server): Api {
    if (!server) throw new Error('No server set');
    let api = this.apis.get(server);
    if (!api) {
      const base = this.options.fetch ?? fetch;
      api = createApi({
        baseUrl: server,
        credentials: 'omit', // never a cookie: the token is the only credential
        fetch: async (input, init) => {
          const t0 = Date.now();
          const res = await base(input, init);
          recordRequest(String(input), Date.now() - t0, res.status); // only when the readout is on
          // a revoked or expired token: forget it (login attempts have no token, so they don't count)
          if (res.status === 401 && this.token) void this.signOut();
          return res;
        },
        authHeaders: (): Record<string, string> =>
          this.token ? { Authorization: `Bearer ${this.token}` } : {},
        onSignedOut: () => this.options.clearCache?.(),
      });
      this.apis.set(server, api);
    }
    return api;
  }

  async signIn(serverInput: string, username: string, password: string): Promise<void> {
    const server = normalizeServer(serverInput);
    if (!server) throw new Error('Enter the https address of your Rack server');
    this.token = null; // log in without an old token
    const { token } = await this.api(server).appToken(username, password);
    await this.store.setItemAsync(TOKEN_KEY, token);
    await this.store.setItemAsync(SERVER_KEY, server);
    this.token = token;
    this.set({ server, status: 'signedIn' });
  }

  /** Log out on this phone: forget the token and everything cached. */
  async signOut(): Promise<void> {
    this.token = null;
    await this.store.deleteItemAsync(TOKEN_KEY);
    await this.options.clearCache?.();
    this.set({ status: 'signedOut' });
  }

  /** End every session and token on every device, then log out here. */
  async logOutEverywhere(): Promise<void> {
    await this.api().logoutAll();
    await this.signOut();
  }
}
