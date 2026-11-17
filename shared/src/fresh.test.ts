import { describe, expect, it } from "vitest";
import { freshTitle, hideSeenSince, refreshFinished } from "./fresh";
import type { RefreshStatus } from "./types";

const status = (o: Partial<RefreshStatus>): RefreshStatus => ({
  running: false,
  queued: false,
  started_at: null,
  last_at: null,
  next_allowed_at: null,
  results: {},
  message: "",
  ...o,
});

describe("new for you", () => {
  it("hides what you've seen from the later of the visit and the refresh", () => {
    const visit = "2026-11-17T18:00:00+00:00";
    expect(hideSeenSince(visit, undefined)).toBe(visit);
    expect(hideSeenSince(visit, status({ started_at: "2026-11-17T19:02:18+00:00" }))).toBe("2026-11-17T19:02:18+00:00");
    expect(hideSeenSince(visit, status({ started_at: "2026-11-16T09:00:00+00:00" }))).toBe(visit); // yesterday's
    expect(hideSeenSince(null, status({ started_at: "2026-11-17T19:02:18+00:00" }))).toBe("2026-11-17T19:02:18+00:00");
    expect(hideSeenSince(undefined, undefined)).toBeNull();
  });

  it("knows when a refresh has finished", () => {
    const started_at = "2026-11-17T19:02:18+00:00";
    expect(refreshFinished(undefined)).toBe(false);
    expect(refreshFinished(status({}))).toBe(false); // never refreshed
    expect(refreshFinished(status({ started_at, running: true, last_at: "2026-11-17T18:50:00+00:00" }))).toBe(false);
    expect(refreshFinished(status({ started_at, last_at: "2026-11-17T19:03:18+00:00" }))).toBe(true);
    expect(refreshFinished(status({ started_at, last_at: "2026-11-17T19:03:18+00:00", queued: true }))).toBe(false);
  });

  it("titles the strip", () => {
    expect(freshTitle(1)).toBe("1 new for you");
    expect(freshTitle(12)).toBe("12 new for you");
  });
});
