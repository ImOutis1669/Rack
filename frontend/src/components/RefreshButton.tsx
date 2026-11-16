import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

/** Re-ranks the feed immediately and asks the worker to search the sources now (with cooldown). */
export function RefreshButton() {
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ["refresh"],
    queryFn: api.refreshStatus,
    refetchInterval: (q) => (q.state.data?.running || q.state.data?.queued ? 4000 : false),
  });
  const busy = Boolean(status.data?.running || status.data?.queued);

  const reloadFeed = () => {
    void qc.invalidateQueries({ queryKey: ["feed"] });
    void qc.invalidateQueries({ queryKey: ["health"] });
  };

  const request = useMutation({
    mutationFn: api.refresh,
    onMutate: reloadFeed,
    onSuccess: (s) => {
      qc.setQueryData(["refresh"], s);
      setMessage(s.message);
    },
    onError: (e) => setMessage(String((e as Error).message)),
  });

  // When a source search finishes, reload now and again once new items are scored (~1 min).
  const lastAt = useRef(status.data?.last_at);
  useEffect(() => {
    const now = status.data?.last_at;
    if (now && lastAt.current && now !== lastAt.current) {
      const total = Object.values(status.data?.results ?? {}).reduce((a, b) => a + b, 0);
      setMessage(`Done: ${total} listings checked. New ones appear as they're scored.`);
      reloadFeed();
      const t = setTimeout(reloadFeed, 60_000);
      lastAt.current = now;
      return () => clearTimeout(t);
    }
    lastAt.current = now;
  }, [status.data?.last_at]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!message || busy) return;
    const t = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(t);
  }, [message, busy]);

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        onClick={() => request.mutate()}
        disabled={request.isPending}
        aria-label="Refresh feed"
        title="Refresh: re-rank now and search the sources for new listings"
        className="flex items-center gap-1 rounded-full px-2.5 py-1 ring-1 ring-white/20 disabled:opacity-50"
      >
        <span className={busy ? "inline-block animate-spin" : "inline-block"}>↻</span>
        {busy ? "Searching…" : "Refresh"}
      </button>
      {message && <span className="max-w-[16rem] truncate text-[11px] text-neutral-400 sm:max-w-none">{message}</span>}
    </div>
  );
}
