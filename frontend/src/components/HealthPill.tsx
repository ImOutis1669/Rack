import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { SOURCE_LABEL, timeAgo } from "../lib/format";

const DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  degraded: "bg-amber-400",
  down: "bg-red-500",
  not_configured: "bg-neutral-600",
  never_run: "bg-neutral-600",
};

export function HealthPill() {
  const { data } = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 60_000 });
  if (!data) return null;
  return (
    <div className="flex gap-2 overflow-x-auto text-[11px] text-neutral-400">
      {data.map((h) => (
        <span
          key={h.source}
          className="flex shrink-0 items-center gap-1"
          title={
            h.status === "not_configured"
              ? "Not configured"
              : `${h.status}${h.last_success_at ? ` · last ok ${timeAgo(h.last_success_at)}` : ""}${
                  h.last_error ? ` · ${h.last_error}` : ""
                }`
          }
        >
          <span className={`h-1.5 w-1.5 rounded-full ${DOT[h.status]}`} />
          {SOURCE_LABEL[h.source]}
        </span>
      ))}
    </div>
  );
}
