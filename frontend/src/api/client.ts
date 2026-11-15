import type { FeedPage, FeedParams, SourceHealth } from "./types";

export class UnauthorizedError extends Error {}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "rack",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) throw new UnauthorizedError("Not logged in");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `HTTP ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export function feedQueryString(params: FeedParams, cursor?: string | null): string {
  const q = new URLSearchParams({ sort: params.sort, limit: "30" });
  for (const s of params.sources) q.append("source", s);
  if (params.maxPrice != null) q.set("max_price", String(params.maxPrice));
  if (cursor) q.set("cursor", cursor);
  return q.toString();
}

export const api = {
  login: (password: string) =>
    request<void>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ authenticated: boolean }>("/api/auth/me"),
  feed: (params: FeedParams, cursor?: string | null) =>
    request<FeedPage>(`/api/feed?${feedQueryString(params, cursor)}`),
  health: () => request<SourceHealth[]>("/api/sources/health"),
};
