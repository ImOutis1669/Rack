import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { timeAgo } from "../lib/format";

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
