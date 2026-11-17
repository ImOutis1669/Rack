// "New for you" after a Refresh (v2.1): both apps show a strip of strong new finds at the top of
// the feed, and from the moment you refresh, things you've already seen stay hidden.
import type { RefreshStatus } from "./types";

function time(v: string | null | undefined): number {
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

/** The feed's hide_seen_before: the later of this visit's start and your latest Refresh. */
export function hideSeenSince(visitStart: string | null | undefined, refresh: RefreshStatus | undefined): string | null {
  const started = refresh?.started_at ?? null;
  if (time(started) > time(visitStart)) return started;
  return visitStart ?? null;
}

/** Your latest Refresh has finished searching (its new finds are being scored). */
export function refreshFinished(s: RefreshStatus | undefined): boolean {
  return !!s && !s.running && !s.queued && time(s.last_at) >= time(s.started_at) && s.started_at != null;
}

export function freshTitle(total: number): string {
  return total === 1 ? "1 new for you" : `${total} new for you`;
}
