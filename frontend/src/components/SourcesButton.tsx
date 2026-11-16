import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { useState } from "react";
import { api } from "../api/client";
import type { SourceHealth } from "../api/types";
import { SOURCE_LABEL, timeAgo } from "../lib/format";
import { cn } from "../lib/utils";
import { Group, IconButton, Row, Sheet } from "./ui";

const DOT: Record<SourceHealth["status"], string> = {
  ok: "bg-accent",
  degraded: "bg-warning",
  down: "bg-danger",
  blocked: "bg-danger",
  not_configured: "bg-subtle",
  never_run: "bg-subtle",
};

export const STATUS_LABEL: Record<SourceHealth["status"], string> = {
  ok: "Working",
  degraded: "Recent errors",
  down: "Failing",
  blocked: "Blocked by site",
  not_configured: "Not set up",
  never_run: "Waiting for first run",
};

/** Header button with a status dot; opens the per-source health sheet. */
export function SourcesButton() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 60_000 });
  const live = data?.filter((h) => h.status === "ok").length ?? 0;
  const problem = data?.some((h) => h.status === "down" || h.status === "degraded");
  return (
    <>
      <IconButton label="Sources" onClick={() => setOpen(true)} className="relative">
        <Radio size={19} strokeWidth={1.9} />
        {data && (
          <span className={cn("absolute top-2.5 right-2.5 size-2 rounded-full ring-2 ring-background", problem ? "bg-warning" : live ? "bg-accent" : "bg-subtle")} />
        )}
      </IconButton>
      <Sheet open={open} onClose={() => setOpen(false)} title="Sources">
        <div className="space-y-2 bg-surface p-4 dark:bg-transparent">
          <Group footer="Vinted and Grailed are read the same way their websites read them, so a change on their side can stop one. Rack keeps going with the others.">
            {data?.map((h) => (
              <Row
                key={h.source}
                label={SOURCE_LABEL[h.source]}
                detail={[
                  h.last_success_at && `Last checked ${timeAgo(h.last_success_at)}${h.last_result_count != null ? ` · ${h.last_result_count} results` : ""}`,
                  h.status !== "ok" && h.last_error,
                ]
                  .filter(Boolean)
                  .join(". ")}
              >
                <span className="flex shrink-0 items-center gap-1.5 text-footnote text-muted">
                  <span className={cn("size-2 rounded-full", DOT[h.status])} />
                  {STATUS_LABEL[h.status]}
                </span>
              </Row>
            ))}
          </Group>
        </div>
      </Sheet>
    </>
  );
}
