import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { CATEGORIES, type Category, type FreeSource, type Hunt, type HuntInput } from "../api/types";
import { ListingCard } from "../components/ListingCard";
import { PageShell } from "../components/Nav";
import { SOURCE_LABEL, timeAgo } from "../lib/format";
import { emptyHunt, huntSummary, INTERVALS } from "../lib/hunts";
import { splitList } from "../lib/units";

const INPUT = "w-full rounded bg-neutral-900 px-2.5 py-1.5 text-sm ring-1 ring-white/15";
const FREE: FreeSource[] = ["ebay", "vinted", "grailed"];

export function Hunts({ onLogout }: { onLogout: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const prefill = (location.state as { prefill?: HuntInput } | null)?.prefill;
  const [editing, setEditing] = useState<{ id: number | null; value: HuntInput } | null>(
    prefill ? { id: null, value: prefill } : null,
  );
  const qc = useQueryClient();
  const hunts = useQuery({
    queryKey: ["hunts"],
    queryFn: api.hunts,
    refetchInterval: (q) => (q.state.data?.some((h) => h.run_requested_at) ? 5000 : 60_000),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["hunts"] });

  const close = () => {
    setEditing(null);
    if (prefill) navigate(".", { replace: true, state: null });
  };

  return (
    <PageShell onLogout={onLogout}>
      <div className="mt-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Hunts</h2>
          <p className="text-xs text-neutral-400">
            Saved searches that run on their own schedule and alert you to new matches.
          </p>
        </div>
        {!editing && (
          <button
            className="rounded bg-white px-3 py-1.5 text-xs font-semibold text-black"
            onClick={() => setEditing({ id: null, value: emptyHunt() })}
          >
            New hunt
          </button>
        )}
      </div>

      {editing && (
        <HuntForm
          key={editing.id ?? "new"}
          id={editing.id}
          initial={editing.value}
          onDone={() => {
            close();
            refresh();
          }}
          onCancel={close}
        />
      )}

      {hunts.isSuccess && hunts.data.length === 0 && !editing && (
        <p className="mt-6 text-sm text-neutral-400">
          No hunts yet. Create one here, or use “Hunt for this” in a listing's ⋯ menu.
        </p>
      )}
      <div className="mt-4 space-y-3">
        {hunts.data?.map((h) => (
          <HuntRow key={h.id} hunt={h} onEdit={() => setEditing({ id: h.id, value: h })} onChange={refresh} />
        ))}
      </div>
    </PageShell>
  );
}

function HuntRow({ hunt, onEdit, onChange }: { hunt: Hunt; onEdit: () => void; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const matches = useQuery({
    queryKey: ["hunt-matches", hunt.id, hunt.match_count],
    queryFn: () => api.huntMatches(hunt.id),
    enabled: open,
  });
  const run = useMutation({ mutationFn: () => api.runHunt(hunt.id), onSuccess: onChange });
  const toggle = useMutation({
    mutationFn: (patch: Partial<Hunt>) => api.updateHunt(hunt.id, { ...hunt, ...patch }),
    onSuccess: onChange,
  });
  const del = useMutation({ mutationFn: () => api.deleteHunt(hunt.id), onSuccess: onChange });

  return (
    <div className="rounded-lg bg-neutral-900 p-3 ring-1 ring-white/10">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {hunt.name}
            {!hunt.enabled && <span className="ml-2 text-xs text-neutral-500">paused</span>}
          </p>
          <p className="text-xs text-neutral-400">{huntSummary(hunt)}</p>
          <p className="mt-1 text-xs text-neutral-500">
            {hunt.run_requested_at
              ? "Running soon…"
              : hunt.last_run_at
                ? `Last run ${timeAgo(hunt.last_run_at)}`
                : "Not run yet"}
            {" · "}
            {hunt.match_count} matches{hunt.new_count ? `, ${hunt.new_count} new since created` : ""}
            {!hunt.notify && " · alerts off"}
          </p>
          {hunt.last_error && <p className="mt-1 text-xs text-amber-300/90">{hunt.last_error}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <button className="rounded bg-neutral-800 px-2 py-1" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide matches" : "Matches"}
          </button>
          <button className="rounded bg-neutral-800 px-2 py-1" onClick={() => run.mutate()} disabled={run.isPending}>
            Run now
          </button>
          <button className="rounded bg-neutral-800 px-2 py-1" onClick={() => toggle.mutate({ enabled: !hunt.enabled })}>
            {hunt.enabled ? "Pause" : "Resume"}
          </button>
          <button className="rounded bg-neutral-800 px-2 py-1" onClick={() => toggle.mutate({ notify: !hunt.notify })}>
            {hunt.notify ? "Mute" : "Unmute"}
          </button>
          <button className="rounded bg-neutral-800 px-2 py-1" onClick={onEdit}>
            Edit
          </button>
          <button
            className="rounded bg-neutral-800 px-2 py-1 text-red-300"
            onClick={() => window.confirm(`Delete “${hunt.name}” and its matches?`) && del.mutate()}
          >
            Delete
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3">
          {matches.isSuccess && matches.data.length === 0 && (
            <p className="text-xs text-neutral-500">No matches yet.</p>
          )}
          <div className="columns-2 gap-3 sm:columns-3 lg:columns-4">
            {matches.data?.map((item) => <ListingCard key={item.id} item={item} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function HuntForm(props: {
  id: number | null;
  initial: HuntInput;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [h, setH] = useState<HuntInput>(props.initial);
  const [sizes, setSizes] = useState(props.initial.sizes.join(", "));
  const save = useMutation({
    mutationFn: () => {
      const body: HuntInput = { ...h, name: h.name.trim() || h.query.trim(), sizes: splitList(sizes) };
      return props.id == null ? api.createHunt(body) : api.updateHunt(props.id, body);
    },
    onSuccess: props.onDone,
  });
  const set = <K extends keyof HuntInput>(k: K, v: HuntInput[K]) => setH((x) => ({ ...x, [k]: v }));

  return (
    <div className="mt-3 space-y-3 rounded-lg bg-neutral-900/60 p-3 ring-1 ring-white/10">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-neutral-400">
          Search for
          <input className={INPUT} value={h.query} placeholder="e.g. rick owens geobasket" onChange={(e) => set("query", e.target.value)} />
        </label>
        <label className="text-xs text-neutral-400">
          Name (optional)
          <input className={INPUT} value={h.name} placeholder={h.query || "Geobaskets"} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className="text-xs text-neutral-400">
          Category
          <select className={`${INPUT} capitalize`} value={h.category} onChange={(e) => set("category", e.target.value as Category)}>
            <option value="any">Any</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-neutral-400">
          Max price (£)
          <input
            className={INPUT}
            type="number"
            min={0}
            value={h.max_price_gbp ?? ""}
            onChange={(e) => set("max_price_gbp", e.target.value ? Number(e.target.value) : null)}
          />
        </label>
        <label className="text-xs text-neutral-400">
          Sizes (comma separated; listings with no size still match)
          <input className={INPUT} value={sizes} placeholder="43, UK 9" onChange={(e) => setSizes(e.target.value)} />
        </label>
        <label className="text-xs text-neutral-400">
          Check
          <select className={INPUT} value={h.interval_minutes} onChange={(e) => set("interval_minutes", Number(e.target.value))}>
            {INTERVALS.map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-neutral-400">Sources:</span>
        {FREE.map((s) => (
          <label key={s} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={h.sources.includes(s)}
              onChange={(e) => set("sources", e.target.checked ? [...h.sources, s] : h.sources.filter((x) => x !== s))}
            />
            {SOURCE_LABEL[s]}
          </label>
        ))}
        <span className="text-neutral-500">(none ticked = all)</span>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={h.notify} onChange={(e) => set("notify", e.target.checked)} />
          Send alerts
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={h.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          Active
        </label>
        <label className="flex items-center gap-1.5 text-neutral-400">
          Min match %
          <input
            className="w-16 rounded bg-neutral-900 px-2 py-1 ring-1 ring-white/15"
            type="number"
            min={0}
            max={100}
            value={h.min_score == null ? "" : Math.round(h.min_score * 100)}
            onChange={(e) => set("min_score", e.target.value ? Number(e.target.value) / 100 : null)}
          />
        </label>
      </div>
      <p className="text-[11px] text-neutral-500">
        Every word of the search must appear in the listing. The first run only records what's already listed;
        you're alerted to anything new after that. Your hidden sellers, banned words and fit rules still apply.
      </p>
      <div className="flex items-center gap-2">
        <button
          className="rounded bg-white px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40"
          disabled={h.query.trim().length < 2 || save.isPending}
          onClick={() => save.mutate()}
        >
          {props.id == null ? "Create hunt" : "Save"}
        </button>
        <button className="text-xs text-neutral-400" onClick={props.onCancel}>
          Cancel
        </button>
        {save.error && <span className="text-xs text-red-400">{String((save.error as Error).message)}</span>}
      </div>
    </div>
  );
}
