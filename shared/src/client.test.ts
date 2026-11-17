import { describe, expect, it, vi } from "vitest";

import { createApi, UnauthorizedError } from "./client";

function ok(status = 200, body: unknown = []) {
  return vi.fn(async () => new Response(status === 204 ? null : JSON.stringify(body), { status }));
}

describe("createApi", () => {
  it("sends the app's auth headers and base URL (bearer, no cookie)", async () => {
    const fetch = ok();
    const api = createApi({
      baseUrl: "https://rack.example",
      fetch,
      credentials: "omit",
      authHeaders: async () => ({ Authorization: "Bearer t" }),
    });
    await api.saved();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://rack.example/api/saved");
    expect(init.credentials).toBe("omit");
    expect(init.headers).toMatchObject({ Authorization: "Bearer t", "Content-Type": "application/json" });
  });

  it("keeps the web's cookie + CSRF header", async () => {
    const fetch = ok(204);
    const api = createApi({ fetch, authHeaders: () => ({ "X-Requested-With": "rack" }) });
    await api.save(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/listings/1/saved");
    expect(init.credentials).toBe("same-origin");
    expect(init.method).toBe("PUT");
    expect(init.headers).toMatchObject({ "X-Requested-With": "rack" });
  });

  it("signs out on 401 and before logout / log out everywhere", async () => {
    const onSignedOut = vi.fn();
    const api = createApi({ fetch: ok(401), authHeaders: () => ({}), onSignedOut });
    await expect(api.me()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    const out = createApi({ fetch: ok(204), authHeaders: () => ({}), onSignedOut });
    await out.logout();
    await out.logoutAll();
    expect(onSignedOut).toHaveBeenCalledTimes(3);
  });

  it("asks for an app token with the password", async () => {
    const fetch = ok(200, { token: "t", expires_in: 60 });
    const api = createApi({ baseUrl: "https://rack.example", fetch, authHeaders: () => ({}) });
    expect(await api.appToken("pw")).toEqual({ token: "t", expires_in: 60 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://rack.example/api/auth/token");
    expect(JSON.parse(String(init.body))).toEqual({ password: "pw" });
  });

  it("surfaces the API's error detail", async () => {
    const api = createApi({ fetch: ok(400, { detail: "Bad hunt" }), authHeaders: () => ({}) });
    await expect(api.hunts()).rejects.toThrow("Bad hunt");
  });
});
