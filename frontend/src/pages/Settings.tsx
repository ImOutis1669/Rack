import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import {
  CATEGORIES,
  type Category,
  type Designer,
  type DesignerWeight,
  type Measurements,
  type Profile,
  type Weights,
} from "../api/types";
import { PageShell } from "../components/Nav";
import { Notifications } from "../components/Notifications";
import { formatLength, parseLengthCm, splitList } from "../lib/units";

const INPUT = "w-full rounded bg-neutral-900 px-2.5 py-1.5 text-sm ring-1 ring-white/15";
const WEIGHTS: DesignerWeight[] = ["love", "like", "curious", "exclude"];
type LenKey = Exclude<keyof Measurements, "tolerance_cm">;
const LENGTHS: [LenKey, string][] = [
  ["inseam_min_cm", "Min inseam"],
  ["sleeve_min_cm", "Min sleeve"],
  ["p2p_min_cm", "Min pit-to-pit"],
  ["p2p_max_cm", "Max pit-to-pit"],
  ["length_min_cm", "Min top length"],
];

export function Settings({ onLogout }: { onLogout: () => void }) {
  const profile = useQuery({ queryKey: ["profile"], queryFn: api.profile });
  const designers = useQuery({ queryKey: ["designers"], queryFn: api.designers });
  const adjacent = useQuery({ queryKey: ["adjacent"], queryFn: api.adjacent });
  const ready = profile.data && designers.data && adjacent.data;
  return (
    <PageShell onLogout={onLogout}>
      {!ready ? (
        <p className="mt-6 text-sm text-neutral-400">Loading…</p>
      ) : (
        <SettingsForm
          profile={profile.data.profile}
          designers={designers.data}
          adjacent={adjacent.data}
        />
      )}
      <Notifications />
      <HiddenList />
      <Security />
    </PageShell>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="text-xs text-neutral-400">{hint}</p>}
      {children}
    </section>
  );
}

function SettingsForm(props: { profile: Profile; designers: Designer[]; adjacent: Record<string, string[]> }) {
  const qc = useQueryClient();
  const [p, setP] = useState<Profile>(props.profile);
  const [ds, setDs] = useState<Designer[]>(props.designers);
  const [adj, setAdj] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(props.adjacent).map(([k, v]) => [k, v.join(", ")])),
  );
  const [unit, setUnit] = useState<"cm" | "in">("cm");
  const [lens, setLens] = useState<Record<LenKey, string>>(
    () => Object.fromEntries(LENGTHS.map(([k]) => [k, formatLength(props.profile.measurements[k], "cm")])) as Record<LenKey, string>,
  );
  const [sizes, setSizes] = useState<Record<string, string>>(
    Object.fromEntries(CATEGORIES.map((c) => [c, (props.profile.sizes[c] ?? []).join(", ")])),
  );
  const [banned, setBanned] = useState(props.profile.banned_keywords.join(", "));
  const [saved, setSaved] = useState(false);
  // Exact stored cm values; a field is only re-parsed if you edit it (no unit round-trip drift).
  const [edited, setEdited] = useState<Set<LenKey>>(new Set());

  const cmFor = (k: LenKey): number | null =>
    edited.has(k) ? parseLengthCm(lens[k], unit) : props.profile.measurements[k];

  const switchUnit = (u: "cm" | "in") => {
    setLens(Object.fromEntries(LENGTHS.map(([k]) => [k, formatLength(cmFor(k), u)])) as Record<LenKey, string>);
    setUnit(u);
  };

  const save = useMutation({
    mutationFn: async () => {
      const measurements: Measurements = { ...p.measurements };
      for (const [k] of LENGTHS) measurements[k] = cmFor(k);
      const body: Profile = {
        ...p,
        measurements,
        banned_keywords: splitList(banned),
        sizes: Object.fromEntries(
          CATEGORIES.map((c) => [c, splitList(sizes[c] ?? "")]).filter(([, v]) => v.length),
        ),
      };
      const cleanDs = ds.filter((d) => d.name.trim());
      await api.saveDesigners(cleanDs);
      const newAdj = await api.adjacent(); // includes freshly seeded suggestions
      const merged: Record<string, string[]> = { ...newAdj };
      for (const [k, v] of Object.entries(adj)) if (cleanDs.some((d) => d.name === k)) merged[k] = splitList(v);
      await api.saveAdjacent(merged);
      await api.saveProfile(body);
    },
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      void qc.invalidateQueries({ queryKey: ["profile"] });
      void qc.invalidateQueries({ queryKey: ["designers"] });
      void qc.invalidateQueries({ queryKey: ["adjacent"] });
      void qc.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  const setWeight = (k: keyof Weights, v: number) => setP((x) => ({ ...x, weights: { ...x.weights, [k]: v } }));
  const setBudgetCat = (c: Category, v: string) =>
    setP((x) => {
      const per = { ...x.budget.per_category };
      if (v === "") delete per[c];
      else per[c] = Number(v);
      return { ...x, budget: { ...x.budget, per_category: per } };
    });

  return (
    <div className="max-w-2xl pb-6">
      <Section title="Your style" hint="A few words about what you like. Used to match listing text and photos.">
        <textarea
          className={`${INPUT} h-20`}
          placeholder="e.g. dark, draped, minimal; long silhouettes; heavy cotton and wool; no logos"
          value={p.context}
          onChange={(e) => setP({ ...p, context: e.target.value })}
        />
      </Section>

      <Section
        title="Designers"
        hint="Love/like/curious only ever boost a listing; unknown or unbranded items are never pushed down for it. Exclude hides a designer completely."
      >
        {ds.map((d, i) => (
          <div key={i} className="space-y-1">
            <div className="flex gap-2">
              <input
                className={INPUT}
                value={d.name}
                placeholder="Designer name"
                onChange={(e) => setDs(ds.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <select
                className="rounded bg-neutral-900 px-2 text-sm ring-1 ring-white/15"
                value={d.weight}
                onChange={(e) =>
                  setDs(ds.map((x, j) => (j === i ? { ...x, weight: e.target.value as DesignerWeight } : x)))
                }
              >
                {WEIGHTS.map((w) => (
                  <option key={w}>{w}</option>
                ))}
              </select>
              <button className="px-2 text-neutral-400" aria-label="Remove" onClick={() => setDs(ds.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
            {(d.weight === "love" || d.weight === "like") && adj[d.name] !== undefined && (
              <input
                className={`${INPUT} text-xs`}
                value={adj[d.name]}
                onChange={(e) => setAdj({ ...adj, [d.name]: e.target.value })}
                title="Similar designers Rack also searches"
                placeholder="Similar designers (comma separated)"
              />
            )}
          </div>
        ))}
        <button className="text-xs text-neutral-300 underline" onClick={() => setDs([...ds, { name: "", weight: "love" }])}>
          + Add designer
        </button>
        <p className="text-[11px] text-neutral-500">
          New loved/liked designers get suggested similar designers after you save; edit them here.
        </p>
      </Section>

      <Section
        title="Fit"
        hint="Listings whose stated measurements fall short by more than the tolerance are hidden. Listings without measurements are never hidden for it."
      >
        <div className="flex gap-2 text-xs">
          {(["cm", "in"] as const).map((u) => (
            <button
              key={u}
              onClick={() => switchUnit(u)}
              className={`rounded-full px-2.5 py-1 ring-1 ${unit === u ? "bg-white text-black ring-white" : "ring-white/20"}`}
            >
              {u}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {LENGTHS.map(([k, label]) => (
            <label key={k} className="text-xs text-neutral-400">
              {label} ({unit})
              <input className={INPUT} inputMode="decimal" value={lens[k]} onChange={(e) => {
                  setLens({ ...lens, [k]: e.target.value });
                  setEdited((s) => new Set(s).add(k));
                }} />
            </label>
          ))}
          <label className="text-xs text-neutral-400">
            Tolerance (cm)
            <input
              className={INPUT}
              type="number"
              min={0}
              step={0.5}
              value={p.measurements.tolerance_cm}
              onChange={(e) => setP({ ...p, measurements: { ...p.measurements, tolerance_cm: Number(e.target.value) } })}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {CATEGORIES.map((c) => (
            <label key={c} className="text-xs capitalize text-neutral-400">
              {c} sizes
              <input
                className={INPUT}
                placeholder={c === "trousers" ? "32, 33" : c === "shoes" ? "UK 11, 46" : "L, XL"}
                value={sizes[c]}
                onChange={(e) => setSizes({ ...sizes, [c]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-neutral-300">
          <input type="checkbox" checked={p.strict_size} onChange={(e) => setP({ ...p, strict_size: e.target.checked })} />
          Hide listings in other sizes (otherwise they just rank lower)
        </label>
      </Section>

      <Section title="Budget" hint="Maximum price in £. Category limits override the default.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <label className="text-xs text-neutral-400">
            Default
            <input
              className={INPUT}
              type="number"
              value={p.budget.default_max_gbp ?? ""}
              onChange={(e) =>
                setP({ ...p, budget: { ...p.budget, default_max_gbp: e.target.value ? Number(e.target.value) : null } })
              }
            />
          </label>
          {CATEGORIES.map((c) => (
            <label key={c} className="text-xs capitalize text-neutral-400">
              {c}
              <input className={INPUT} type="number" value={p.budget.per_category[c] ?? ""} onChange={(e) => setBudgetCat(c, e.target.value)} />
            </label>
          ))}
        </div>
      </Section>

      <Section title="Feed">
        <div className="flex flex-wrap gap-3 text-xs">
          {CATEGORIES.map((c) => (
            <label key={c} className="flex items-center gap-1.5 capitalize">
              <input
                type="checkbox"
                checked={p.categories.includes(c)}
                onChange={(e) =>
                  setP({ ...p, categories: e.target.checked ? [...p.categories, c] : p.categories.filter((x) => x !== c) })
                }
              />
              {c}
            </label>
          ))}
        </div>
        <label className="block text-xs text-neutral-400">
          Exploration: {Math.round(p.exploration * 100)}% of the feed is wildcards from outside your top matches
          <input
            type="range"
            min={0}
            max={0.3}
            step={0.05}
            value={p.exploration}
            onChange={(e) => setP({ ...p, exploration: Number(e.target.value) })}
            className="w-full"
          />
        </label>
        <label className="block text-xs text-neutral-400">
          Banned words (comma separated, whole words)
          <input className={INPUT} value={banned} onChange={(e) => setBanned(e.target.value)} />
        </label>
        <details className="text-xs text-neutral-400">
          <summary className="cursor-pointer">Advanced: score weights</summary>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(p.weights) as (keyof Weights)[]).map((k) => (
              <label key={k}>
                {k.replace("_", " ")}
                <input className={INPUT} type="number" step={0.05} min={0} value={p.weights[k]} onChange={(e) => setWeight(k, Number(e.target.value))} />
              </label>
            ))}
          </div>
        </details>
      </Section>

      <div className="sticky bottom-0 mt-6 flex items-center gap-3 bg-neutral-950/90 py-3 backdrop-blur">
        <button
          className="rounded bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-xs text-emerald-400">Saved. The feed re-ranks within a minute.</span>}
        {save.error && <span className="text-xs text-red-400">{String((save.error as Error).message)}</span>}
      </div>
    </div>
  );
}

function Security() {
  const qc = useQueryClient();
  const logoutAll = useMutation({
    mutationFn: api.logoutAll,
    onSuccess: () => {
      qc.clear();
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  return (
    <Section
      title="Security"
      hint="Ends every session on every device, including this one. Use it if a phone or computer you were logged in on is lost or shared. Changing your password does the same automatically."
    >
      <button
        className="rounded bg-neutral-800 px-3 py-1.5 text-xs text-red-300 disabled:opacity-40"
        disabled={logoutAll.isPending}
        onClick={() => window.confirm("Log out on every device?") && logoutAll.mutate()}
      >
        Log out all devices
      </button>
    </Section>
  );
}

function HiddenList() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["hidden"], queryFn: api.hidden });
  const unhide = useMutation({
    mutationFn: api.unhide,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["hidden"] }),
  });
  if (!q.data?.length) return null;
  return (
    <Section title="Hidden sellers & brands">
      <ul className="space-y-1 text-sm">
        {q.data.map((h) => (
          <li key={h.id} className="flex items-center justify-between rounded bg-neutral-900 px-2.5 py-1.5">
            <span>
              <span className="text-neutral-500">{h.kind}:</span> {h.value}
            </span>
            <button className="text-xs text-neutral-400" onClick={() => unhide.mutate(h.id)}>
              Unhide
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
