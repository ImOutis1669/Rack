import { afterEach, describe, expect, it, vi } from "vitest";

import { api, UnauthorizedError } from "./client";

function memory() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("instant-start snapshots are cleared when signed out", () => {
  it("on any 'not signed in' response", async () => {
    const store = memory();
    store.setItem("rack.snap.feed", "x");
    store.setItem("rack.snap.saved", "y");
    vi.stubGlobal("window", { localStorage: store });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    await expect(api.saved()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(store.m.size).toBe(0);
  });

  it("on logout and log out everywhere", async () => {
    const store = memory();
    vi.stubGlobal("window", { localStorage: store });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    store.setItem("rack.snap.feed", "x");
    await api.logout();
    expect(store.m.size).toBe(0);
    store.setItem("rack.snap.saved", "y");
    await api.logoutAll();
    expect(store.m.size).toBe(0);
  });
});
