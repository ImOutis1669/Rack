import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import type { SourceHealth } from "../api/types";
import { SOURCE_LABEL, timeAgo } from "../lib/format";

const DOT: Record<SourceHealth["status"], string> = {
  ok: "bg-emerald-500",
  degraded: "bg-amber-400",
  down: "bg-red-500",
  blocked: "bg-red-900 ring-1 ring-red-500",
  not_configured: "bg-neutral-600",
  never_run: "bg-neutral-600",
};

export const STATUS_LABEL: Record<SourceHealth["status"], string> = {
  ok: "Working",
  degraded: "Recent errors",
  down: "Failing",
  blocked: "Blocked by site",
  not_configured: "Not configured",
  never_run: "Waiting for first run",
};

export function HealthPill() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 60_000 });
  if (!data) return null;
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex gap-2 overflow-x-auto text-[11px] text-neutral-400"
        title="Source health"
      >
        {data.map((h) => (
          <span key={h.source} className="flex shrink-0 items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${DOT[h.status]}`} />
            {SOURCE_LABEL[h.source]}
          </span>
        ))}
        <span className="text-neutral-600">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ul className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
          {data.map((h) => (
            <li key={h.source} className="rounded-md bg-neutral-900 p-2.5 ring-1 ring-white/10">
              <div className="flex items-center justify-between">
                <span className="font-medium">{SOURCE_LABEL[h.source]}</span>
                <span className="flex items-center gap-1.5 text-neutral-300">
                  <span className={`h-1.5 w-1.5 rounded-full ${DOT[h.status]}`} />
                  {STATUS_LABEL[h.status]}
                </span>
              </div>
              <dl className="mt-1.5 space-y-0.5 text-neutral-400">
                {h.last_success_at && (
                  <div>
                    Last OK {timeAgo(h.last_success_at)}
                    {h.last_result_count != null && ` · ${h.last_result_count} results`}
                  </div>
                )}
                {h.last_check_at && <div>Last checked {timeAgo(h.last_check_at)}</div>}
                {h.consecutive_errors > 0 && (
                  <div>
                    {h.consecutive_errors} failed in a row ({h.error_count} total)
                  </div>
                )}
                {h.last_error && h.status !== "ok" && <div className="text-neutral-300">{h.last_error}</div>}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
