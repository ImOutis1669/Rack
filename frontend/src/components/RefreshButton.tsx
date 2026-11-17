import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "../api/client";
import { cn } from "../lib/utils";
import { toast } from "./Toast";
import { IconButton } from "./ui";
import { Icon } from "./icons/Icon";

/** Reloads the feed now and asks the worker to search your own designers and wishlist on every
 *  source (per-person cooldown; see backend api/refresh.py). */
export function RefreshButton() {
  const qc = useQueryClient();
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
      toast(s.message);
    },
    onError: (e) => toast(String((e as Error).message)),
  });

  // When a search finishes, reload now and again once new items are scored (~1 min).
  const lastAt = useRef(status.data?.last_at);
  useEffect(() => {
    const now = status.data?.last_at;
    if (now && lastAt.current && now !== lastAt.current) {
      const total = Object.values(status.data?.results ?? {}).reduce((a, b) => a + b, 0);
      toast(`Checked ${total} listings. New ones appear as they're scored.`, 6000);
      reloadFeed();
      const t = setTimeout(reloadFeed, 60_000);
      lastAt.current = now;
      return () => clearTimeout(t);
    }
    lastAt.current = now;
  }, [status.data?.last_at]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <IconButton
      label={busy ? "Searching for you" : "Refresh"}
      onClick={() => request.mutate()}
      disabled={request.isPending}
    >
      <Icon name="refresh" size={22} className={cn(busy && "animate-spin")} />
    </IconButton>
  );
}
