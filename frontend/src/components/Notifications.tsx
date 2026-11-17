import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { timeAgo } from "@rack/shared/format";
import { disablePush, enablePush, PUSH_HELP, pushState, type PushState } from "../lib/push";
import { cn } from "../lib/utils";
import { Button, Group, Row, Switch } from "./ui";

const NAMES: Record<string, string> = { ntfy: "ntfy", telegram: "Telegram", webpush: "Push to this app" };

function ThisDevice() {
  const qc = useQueryClient();
  const [state, setState] = useState<PushState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void pushState().then(setState);
  }, []);
  const toggle = useMutation({
    mutationFn: () => (state === "on" ? disablePush() : enablePush()),
    onSuccess: (s) => {
      setState(s);
      setError(null);
      void qc.invalidateQueries({ queryKey: ["notify-status"] });
    },
    onError: (e) => setError(String((e as Error).message)),
  });
  if (!state) return null;
  return (
    <Row label="Notifications on this device" detail={error ?? PUSH_HELP[state]}>
      {(state === "on" || state === "off") && (
        <Switch checked={state === "on"} onChange={() => toggle.mutate()} label="Notifications on this device" />
      )}
    </Row>
  );
}

/** Settings section: alert channels, this device's push, a test button and recent alerts. */
export function Notifications() {
  const status = useQuery({ queryKey: ["notify-status"], queryFn: api.notifyStatus });
  const recent = useQuery({ queryKey: ["notify-recent"], queryFn: api.notifyRecent });
  const test = useMutation({ mutationFn: api.notifyTest });
  const anyOn = status.data?.some((c) => c.configured);

  return (
    <>
      <Group
        title="Alerts"
        footer="Hunt matches and price drops on saved items are sent to every channel that's set up. ntfy and Telegram are set in .env."
      >
        <ThisDevice />
        {status.data?.map((c) => (
          <Row key={c.name} label={NAMES[c.name] ?? c.name} detail={c.detail}>
            <span className={cn("shrink-0 text-footnote", c.configured ? "text-accent" : "text-muted")}>
              {c.configured ? "On" : "Off"}
            </span>
          </Row>
        ))}
        <Row>
          <Button size="sm" disabled={!anyOn || test.isPending} onClick={() => test.mutate()}>
            Send test alert
          </Button>
          {test.data && (
            <span className="text-footnote text-muted">
              {Object.entries(test.data)
                .map(([k, v]) => `${NAMES[k] ?? k}: ${v}`)
                .join(" · ")}
            </span>
          )}
        </Row>
      </Group>
      {!!recent.data?.length && (
        <Group title="Recent alerts">
          {recent.data.slice(0, 8).map((n, i) => (
            <Row key={i} label={n.title} detail={`${n.body} · ${timeAgo(n.sent_at)}`} />
          ))}
        </Group>
      )}
    </>
  );
}
