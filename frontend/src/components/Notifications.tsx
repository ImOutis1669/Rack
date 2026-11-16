import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { timeAgo } from "../lib/format";
import { disablePush, enablePush, PUSH_HELP, pushState, type PushState } from "../lib/push";

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
  const canToggle = state === "on" || state === "off";
  return (
    <div className="flex flex-wrap items-center gap-2 rounded bg-neutral-900 px-2.5 py-1.5 text-sm">
      <span>This device</span>
      <span className="text-xs text-neutral-400">{error ?? PUSH_HELP[state]}</span>
      {canToggle && (
        <button
          className="ml-auto rounded bg-neutral-700 px-2 py-1 text-xs"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate()}
        >
          {state === "on" ? "Turn off" : "Enable push here"}
        </button>
      )}
    </div>
  );
}

/** Settings section: which alert channels are set up, a test button, and recent alerts. */
export function Notifications() {
  const status = useQuery({ queryKey: ["notify-status"], queryFn: api.notifyStatus });
  const recent = useQuery({ queryKey: ["notify-recent"], queryFn: api.notifyRecent });
  const test = useMutation({ mutationFn: api.notifyTest });
  const anyOn = status.data?.some((c) => c.configured);

  return (
    <section className="mt-5 max-w-2xl space-y-2">
      <h2 className="text-sm font-semibold">Alerts</h2>
      <p className="text-xs text-neutral-400">
        Hunt matches and price drops on saved items are pushed here. Channels are set in <code>.env</code>.
      </p>
      <ul className="space-y-1 text-sm">
        {status.data?.map((c) => (
          <li key={c.name} className="flex items-start gap-2 rounded bg-neutral-900 px-2.5 py-1.5">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${c.configured ? "bg-emerald-500" : "bg-neutral-600"}`} />
            <span>
              <span className="capitalize">{c.name}</span>
              <span className="block break-all text-xs text-neutral-400">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <ThisDevice />
      <div className="flex items-center gap-3">
        <button
          className="rounded bg-white px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40"
          disabled={!anyOn || test.isPending}
          onClick={() => test.mutate()}
        >
          Send test alert
        </button>
        {test.data && (
          <span className="text-xs text-neutral-300">
            {Object.entries(test.data)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")}
          </span>
        )}
      </div>
      {!!recent.data?.length && (
        <details className="text-xs text-neutral-400">
          <summary className="cursor-pointer">Recent alerts ({recent.data.length})</summary>
          <ul className="mt-2 space-y-1">
            {recent.data.map((n, i) => (
              <li key={i}>
                <span className="text-neutral-500">{timeAgo(n.sent_at)}</span>{" "}
                {n.url ? (
                  <a href={n.url} target="_blank" rel="noopener noreferrer" className="underline">
                    {n.title}
                  </a>
                ) : (
                  n.title
                )}{" "}
                — {n.body}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
