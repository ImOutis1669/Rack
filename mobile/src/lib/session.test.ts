import { UnauthorizedError } from '@rack/shared/client';

import { loginErrorMessage, normalizeServer, SERVER_KEY, Session, TOKEN_KEY, type KeyStore } from './session';

function memoryStore(init: Record<string, string> = {}): KeyStore & { m: Map<string, string> } {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItemAsync: async (k) => m.get(k) ?? null,
    setItemAsync: async (k, v) => void m.set(k, v),
    deleteItemAsync: async (k) => void m.delete(k),
  };
}

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('normalizeServer', () => {
  it.each([
    ['rack.tail.ts.net', 'https://rack.tail.ts.net'],
    ['https://rack.tail.ts.net/', 'https://rack.tail.ts.net'],
    ['  https://rack.tail.ts.net/feed ', 'https://rack.tail.ts.net'],
    ['https://rack.tail.ts.net:8443', 'https://rack.tail.ts.net:8443'],
  ])('%s -> %s', (input, out) => expect(normalizeServer(input)).toBe(out));

  it.each(['', 'http://rack.tail.ts.net', 'ftp://x', 'https://'])('refuses %p', (input) =>
    expect(normalizeServer(input)).toBeNull(),
  );
});

describe('loginErrorMessage', () => {
  it('maps errors to plain copy', () => {
    expect(loginErrorMessage(new UnauthorizedError('x'))).toBe('Wrong username or password');
    expect(loginErrorMessage(new TypeError('Network request failed'))).toMatch(/Tailscale/);
    expect(loginErrorMessage(new Error('Too many attempts, try later'))).toBe('Too many attempts, try later');
  });
});

describe('Session', () => {
  it('starts signed out without a token, signed in with one', async () => {
    const empty = new Session(memoryStore(), { defaultServer: 'rack.tail.ts.net' });
    await empty.load();
    expect(empty.status).toBe('signedOut');
    expect(empty.server).toBe('https://rack.tail.ts.net');

    const saved = new Session(memoryStore({ [TOKEN_KEY]: 't', [SERVER_KEY]: 'https://saved.ts.net' }));
    await saved.load();
    expect(saved.status).toBe('signedIn');
    expect(saved.server).toBe('https://saved.ts.net');
  });

  it('signs in with the password, keeps the token in the store and sends it as a bearer', async () => {
    const store = memoryStore();
    const fetch = jest.fn(async (url: string) =>
      url.endsWith('/api/auth/token') ? json(200, { token: 'tok', expires_in: 60 }) : json(200, []),
    );
    const s = new Session(store, { fetch: fetch as unknown as typeof globalThis.fetch });
    await s.load();
    await s.signIn('rack.tail.ts.net', 'sam', 'pw');
    expect(s.status).toBe('signedIn');
    expect(store.m.get(TOKEN_KEY)).toBe('tok');
    expect(store.m.get(SERVER_KEY)).toBe('https://rack.tail.ts.net');

    const login = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(login[0]).toBe('https://rack.tail.ts.net/api/auth/token');
    expect(login[1].headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(String(login[1].body))).toEqual({ username: 'sam', password: 'pw' });

    await s.api().saved();
    const call = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(call[1].headers).toMatchObject({ Authorization: 'Bearer tok' });
    expect(call[1].credentials).toBe('omit');
  });

  it('refuses a non-https server before sending the password', async () => {
    const fetch = jest.fn();
    const s = new Session(memoryStore(), { fetch });
    await expect(s.signIn('http://rack.local', 'sam', 'pw')).rejects.toThrow(/https/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a wrong password leaves the app signed out', async () => {
    const store = memoryStore();
    const s = new Session(store, { fetch: jest.fn(async () => json(401, { detail: 'Wrong password' })) });
    await s.load();
    await expect(s.signIn('rack.tail.ts.net', 'sam', 'nope')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(s.status).toBe('signedOut');
    expect(store.m.has(TOKEN_KEY)).toBe(false);
  });

  it('any 401 with a token signs out and clears the cache', async () => {
    const store = memoryStore({ [TOKEN_KEY]: 'old', [SERVER_KEY]: 'https://rack.tail.ts.net' });
    const clearCache = jest.fn();
    const s = new Session(store, { fetch: jest.fn(async () => json(401)), clearCache });
    await s.load();
    await expect(s.api().feed({ sort: 'best', sources: [], maxPrice: null })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(s.status).toBe('signedOut');
    expect(store.m.has(TOKEN_KEY)).toBe(false);
    expect(clearCache).toHaveBeenCalled();
  });

  it('log out everywhere revokes on the server, then forgets the token', async () => {
    const store = memoryStore({ [TOKEN_KEY]: 'tok', [SERVER_KEY]: 'https://rack.tail.ts.net' });
    const fetch = jest.fn(async () => json(204));
    const s = new Session(store, { fetch });
    await s.load();
    await s.logOutEverywhere();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://rack.tail.ts.net/api/auth/logout-all');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
    expect(s.status).toBe('signedOut');
    expect(store.m.has(TOKEN_KEY)).toBe(false);
    expect(store.m.get(SERVER_KEY)).toBe('https://rack.tail.ts.net'); // the address is kept
  });
});
