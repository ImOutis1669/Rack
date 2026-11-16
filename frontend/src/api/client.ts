import type {
  Designer,
  FeedPage,
  FeedParams,
  GalleryInfo,
  Hidden,
  Listing,
  Profile,
  ProfileResponse,
  SourceHealth,
  TasteItem,
  TasteKind,
  Visit,
} from "./types";

export class UnauthorizedError extends Error {}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      "X-Requested-With": "rack",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) throw new UnauthorizedError("Not logged in");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? "");
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export function feedQueryString(params: FeedParams, cursor?: string | null): string {
  const q = new URLSearchParams({ sort: params.sort, limit: "30" });
  for (const s of params.sources) q.append("source", s);
  if (params.maxPrice != null) q.set("max_price", String(params.maxPrice));
  if (params.category) q.set("category", params.category);
  if (params.brand?.trim()) q.set("brand", params.brand.trim());
  if (params.newSince) q.set("new_since", params.newSince);
  if (params.hideSeenBefore) q.set("hide_seen_before", params.hideSeenBefore);
  if (cursor) q.set("cursor", cursor);
  return q.toString();
}

export const api = {
  login: (password: string) => request<void>("/api/auth/login", json("POST", { password })),
  logout: () => request<void>("/api/auth/logout", json("POST")),
  me: () => request<{ authenticated: boolean }>("/api/auth/me"),
  feed: (params: FeedParams, cursor?: string | null) =>
    request<FeedPage>(`/api/feed?${feedQueryString(params, cursor)}`),
  health: () => request<SourceHealth[]>("/api/sources/health"),

  profile: () => request<ProfileResponse>("/api/profile"),
  saveProfile: (p: Profile) => request<ProfileResponse>("/api/profile", json("PUT", p)),
  designers: () => request<Designer[]>("/api/designers"),
  saveDesigners: (d: Designer[]) => request<Designer[]>("/api/designers", json("PUT", d)),
  adjacent: () => request<Record<string, string[]>>("/api/adjacent"),
  saveAdjacent: (a: Record<string, string[]>) =>
    request<Record<string, string[]>>("/api/adjacent", json("PUT", a)),

  taste: (kind?: TasteKind) => request<TasteItem[]>(`/api/taste${kind ? `?kind=${kind}` : ""}`),
  uploadTaste: (kind: TasteKind, files: File[], note?: string) => {
    const form = new FormData();
    form.set("kind", kind);
    if (note) form.set("note", note);
    for (const f of files) form.append("files", f);
    return request<TasteItem[]>("/api/taste/upload", { method: "POST", body: form });
  },
  addTasteUrl: (kind: TasteKind, url: string, note?: string) =>
    request<TasteItem>("/api/taste/url", json("POST", { kind, url, note: note || null })),
  addTasteText: (kind: TasteKind, text: string) =>
    request<TasteItem>("/api/taste/text", json("POST", { kind, text })),
  patchTaste: (id: number, patch: { note?: string | null; text?: string | null }) =>
    request<TasteItem>(`/api/taste/${id}`, json("PATCH", patch)),
  deleteTaste: (id: number) => request<void>(`/api/taste/${id}`, json("DELETE")),

  feedback: (id: number, value: -1 | 0 | 1) =>
    request<void>(`/api/listings/${id}/feedback`, json("POST", { value })),
  save: (id: number) => request<void>(`/api/listings/${id}/saved`, json("PUT")),
  unsave: (id: number) => request<void>(`/api/listings/${id}/saved`, json("DELETE")),
  saved: () => request<Listing[]>("/api/saved"),
  gallery: (id: number) => request<GalleryInfo>(`/api/listings/${id}/gallery`),
  hidden: () => request<Hidden[]>("/api/hidden"),
  hide: (kind: Hidden["kind"], value: string) =>
    request<Hidden>("/api/hidden", json("POST", { kind, value })),
  unhide: (id: number) => request<void>(`/api/hidden/${id}`, json("DELETE")),
  seen: (ids: number[]) => request<void>("/api/seen", json("POST", { ids })),
  visit: () => request<Visit>("/api/visit", json("POST")),
};
