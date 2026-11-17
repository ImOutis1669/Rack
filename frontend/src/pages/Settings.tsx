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
} from "@rack/shared/types";
import { PageShell } from "../components/AppShell";
import { Notifications } from "../components/Notifications";
import { toast } from "../components/Toast";
import { Button, Group, IconButton, Row, Segmented, Skeleton, Switch, Textarea } from "../components/ui";
import { formatLength, parseLengthCm, splitList } from "@rack/shared/units";
import { cn } from "../lib/utils";
import { Icon } from "../components/icons/Icon";

const WEIGHTS: [DesignerWeight, string][] = [
  ["love", "Love"],
  ["like", "Like"],
  ["curious", "Curious"],
  ["exclude", "Never"],
];
type LenKey = Exclude<keyof Measurements, "tolerance_cm">;
const LENGTHS: [LenKey, string][] = [
  ["inseam_min_cm", "Minimum inseam"],
  ["sleeve_min_cm", "Minimum sleeve"],
  ["length_min_cm", "Minimum top length"],
  ["length_max_cm", "Maximum top length"],
  ["p2p_min_cm", "Minimum pit to pit"],
  ["p2p_max_cm", "Maximum pit to pit"],
];
const CAT_LABEL: Record<Category, string> = { any: "All", tops: "Tops", trousers: "Trousers", shoes: "Shoes", outerwear: "Outerwear", accessories: "Accessories" };

/** Right-aligned value input for grouped rows (iOS settings style). */
function RowInput(props: React.InputHTMLAttributes<HTMLInputElement> & { suffix?: string; prefix?: string }) {
  const { suffix, prefix, className, ...rest } = props;
  return (
    <span className="flex shrink-0 items-center gap-1 text-muted">
      {prefix}
      <input
        {...rest}
        className={cn("w-24 bg-transparent text-right text-body text-foreground outline-none placeholder:text-subtle", className)}
      />
      {suffix && <span className="w-6 text-footnote">{suffix}</span>}
    </span>
  );
}

export function Settings() {
  const profile = useQuery({ queryKey: ["profile"], queryFn: api.profile });
  const designers = useQuery({ queryKey: ["designers"], queryFn: api.designers });
  const adjacent = useQuery({ queryKey: ["adjacent"], queryFn: api.adjacent });
  const ready = profile.data && designers.data && adjacent.data;
  return (
    <PageShell title="Settings" wide={false} grouped>
      <div className="space-y-7">
        {!ready ? (
          <div className="space-y-3">
            <Skeleton className="h-24 rounded-group" />
            <Skeleton className="h-48 rounded-group" />
          </div>
        ) : (
          <SettingsForm profile={profile.data.profile} designers={designers.data} adjacent={adjacent.data} />
        )}
        <Notifications />
        <HiddenList />
      </div>
    </PageShell>
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
  // Exact stored cm values; a field is only re-parsed if you edit it (no unit round-trip drift).
  const [edited, setEdited] = useState<Set<LenKey>>(new Set());
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);

  const cmFor = (k: LenKey): number | null => (edited.has(k) ? parseLengthCm(lens[k], unit) : props.profile.measurements[k]);
  const switchUnit = (u: "cm" | "in") => {
    setLens(Object.fromEntries(LENGTHS.map(([k]) => [k, formatLength(cmFor(k), u)])) as Record<LenKey, string>);
    setUnit(u);
  };
  const update = (next: Profile) => {
    setP(next);
    touch();
  };

  const save = useMutation({
    mutationFn: async () => {
      const measurements: Measurements = { ...p.measurements };
      for (const [k] of LENGTHS) measurements[k] = cmFor(k);
      const body: Profile = {
        ...p,
        measurements,
        banned_keywords: splitList(banned),
        sizes: Object.fromEntries(CATEGORIES.map((c) => [c, splitList(sizes[c] ?? "")]).filter(([, v]) => v.length)),
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
      setDirty(false);
      toast("Saved. The feed re-ranks within a minute.");
      void qc.invalidateQueries({ queryKey: ["profile"] });
      void qc.invalidateQueries({ queryKey: ["designers"] });
      void qc.invalidateQueries({ queryKey: ["adjacent"] });
      void qc.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  const setWeight = (k: keyof Weights, v: number) => update({ ...p, weights: { ...p.weights, [k]: v } });
  const setBudgetCat = (c: Category, v: string) => {
    const per = { ...p.budget.per_category };
    if (v === "") delete per[c];
    else per[c] = Number(v);
    update({ ...p, budget: { ...p.budget, per_category: per } });
  };

  return (
    <div className="space-y-7">
      <Group title="Your style" footer="A few words about what you like. Rack matches them against listing text and photos.">
        <div className="p-3">
          <Textarea
            aria-label="Your style"
            className="bg-transparent px-1"
            placeholder="Dark, draped, minimal. Long silhouettes, heavy cotton and wool, no logos."
            value={p.context}
            onChange={(e) => update({ ...p, context: e.target.value })}
          />
        </div>
      </Group>

      <Group
        title="Designers"
        footer="Love, like and curious only ever lift a listing; unbranded pieces are never pushed down. Never hides a designer completely. Loved and liked designers get suggested similar ones after you save."
      >
        {ds.map((d, i) => (
          <div key={i} className="px-4 py-2.5">
            <div className="flex items-center gap-2">
              <input
                aria-label="Designer"
                className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-subtle"
                value={d.name}
                placeholder="Designer name"
                onChange={(e) => {
                  setDs(ds.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)));
                  touch();
                }}
              />
              <select
                aria-label="How much you like them"
                className={cn(
                  "h-8 appearance-none rounded-full px-3 text-footnote font-semibold outline-none",
                  d.weight === "exclude" ? "bg-fill text-danger" : d.weight === "love" ? "bg-foreground text-background" : "bg-fill",
                )}
                value={d.weight}
                onChange={(e) => {
                  setDs(ds.map((x, j) => (j === i ? { ...x, weight: e.target.value as DesignerWeight } : x)));
                  touch();
                }}
              >
                {WEIGHTS.map(([w, label]) => (
                  <option key={w} value={w}>
                    {label}
                  </option>
                ))}
              </select>
              <IconButton
                label="Remove designer"
                className="-mr-2 size-9 text-muted"
                onClick={() => {
                  setDs(ds.filter((_, j) => j !== i));
                  touch();
                }}
              >
                <Icon name="close" size={16} />
              </IconButton>
            </div>
            {(d.weight === "love" || d.weight === "like") && adj[d.name] !== undefined && (
              <input
                aria-label={`Designers similar to ${d.name}`}
                className="mt-1 w-full bg-transparent text-footnote text-muted outline-none placeholder:text-subtle"
                value={adj[d.name]}
                onChange={(e) => {
                  setAdj({ ...adj, [d.name]: e.target.value });
                  touch();
                }}
                placeholder="Also search: similar designers, comma separated"
              />
            )}
          </div>
        ))}
        <button
          className="press flex min-h-11 w-full items-center gap-2 px-4 text-body font-medium text-accent"
          onClick={() => {
            setDs([...ds, { name: "", weight: "love" }]);
            touch();
          }}
        >
          <Icon name="plus" size={18} /> Add designer
        </button>
      </Group>

      <Group
        title={
          <span className="flex items-center justify-between">
            Fit
            <Segmented
              value={unit}
              onChange={switchUnit}
              className="-my-1 normal-case"
              options={[
                ["cm", "cm"],
                ["in", "in"],
              ]}
            />
          </span>
        }
        footer="Listings whose measurements fall short by more than the tolerance are hidden. Listings without measurements are never hidden for it."
      >
        {LENGTHS.map(([k, label]) => (
          <Row key={k} label={label}>
            <RowInput
              inputMode="decimal"
              placeholder="Any"
              suffix={unit}
              aria-label={label}
              value={lens[k]}
              onChange={(e) => {
                setLens({ ...lens, [k]: e.target.value });
                setEdited((s) => new Set(s).add(k));
                touch();
              }}
            />
          </Row>
        ))}
        <Row label="Tolerance">
          <RowInput
            type="number"
            min={0}
            step={0.5}
            suffix="cm"
            aria-label="Tolerance"
            value={p.measurements.tolerance_cm}
            onChange={(e) => update({ ...p, measurements: { ...p.measurements, tolerance_cm: Number(e.target.value) } })}
          />
        </Row>
      </Group>

      <Group title="Sizes" footer="Other sizes rank lower, or are hidden if you turn on the switch.">
        {CATEGORIES.map((c) => (
          <Row key={c} label={CAT_LABEL[c]}>
            <RowInput
              className="w-36"
              aria-label={`${CAT_LABEL[c]} sizes`}
              placeholder={c === "trousers" ? "32, 33" : c === "shoes" ? "UK 11, 46" : "L, XL"}
              value={sizes[c]}
              onChange={(e) => {
                setSizes({ ...sizes, [c]: e.target.value });
                touch();
              }}
            />
          </Row>
        ))}
        <Row label="Hide other sizes">
          <Switch checked={p.strict_size} onChange={(v) => update({ ...p, strict_size: v })} label="Hide other sizes" />
        </Row>
      </Group>

      <Group title="Budget" footer="Maximum price. Category limits override the default.">
        <Row label="Default">
          <RowInput
            type="number"
            inputMode="numeric"
            prefix="£"
            placeholder="None"
            aria-label="Default budget"
            value={p.budget.default_max_gbp ?? ""}
            onChange={(e) => update({ ...p, budget: { ...p.budget, default_max_gbp: e.target.value ? Number(e.target.value) : null } })}
          />
        </Row>
        {CATEGORIES.map((c) => (
          <Row key={c} label={CAT_LABEL[c]}>
            <RowInput
              type="number"
              inputMode="numeric"
              prefix="£"
              placeholder="Default"
              aria-label={`${CAT_LABEL[c]} budget`}
              value={p.budget.per_category[c] ?? ""}
              onChange={(e) => setBudgetCat(c, e.target.value)}
            />
          </Row>
        ))}
      </Group>

      <Group title="Feed">
        {CATEGORIES.map((c) => (
          <Row key={c} label={`Show ${CAT_LABEL[c].toLowerCase()}`}>
            <Switch
              checked={p.categories.includes(c)}
              onChange={(v) => update({ ...p, categories: v ? [...p.categories, c] : p.categories.filter((x) => x !== c) })}
              label={`Show ${CAT_LABEL[c]}`}
            />
          </Row>
        ))}
        <Row label="Exploration" detail="Wildcards from outside your top matches">
          <input
            type="range"
            min={0}
            max={0.3}
            step={0.05}
            aria-label="Exploration"
            value={p.exploration}
            onChange={(e) => update({ ...p, exploration: Number(e.target.value) })}
            className="w-28 accent-[var(--accent)]"
          />
          <span className="tabular w-9 text-right text-footnote text-muted">{Math.round(p.exploration * 100)}%</span>
        </Row>
        <div className="px-4 py-2.5">
          <p className="text-body">Banned words</p>
          <input
            aria-label="Banned words"
            className="mt-0.5 w-full bg-transparent text-footnote text-muted outline-none"
            value={banned}
            onChange={(e) => {
              setBanned(e.target.value);
              touch();
            }}
          />
        </div>
        <details className="group px-4 py-2.5">
          <summary className="cursor-pointer list-none text-body text-muted">Advanced: score weights</summary>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {(Object.keys(p.weights) as (keyof Weights)[]).map((k) => (
              <label key={k} className="flex items-center justify-between gap-2 text-footnote">
                <span className="capitalize text-muted">{k.replace("_", " ")}</span>
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  value={p.weights[k]}
                  onChange={(e) => setWeight(k, Number(e.target.value))}
                  className="w-14 rounded-md bg-fill px-1.5 py-1 text-right outline-none"
                />
              </label>
            ))}
          </div>
        </details>
      </Group>

      {(dirty || save.isPending || save.isError) && (
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+92px)] z-20 flex justify-center md:bottom-6">
        <div className="glass flex items-center gap-3 rounded-full p-1.5 pl-4 shadow-lg ring-1 ring-border">
          <span className="text-footnote text-muted">
            {save.error ? <span className="text-danger">{String((save.error as Error).message)}</span> : dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <Button variant="primary" size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving" : dirty ? "Save" : <Icon name="check" size={16} />}
          </Button>
        </div>
      </div>
      )}
    </div>
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
    <Group title="Hidden" footer="Sellers and brands you hid from the feed.">
      {q.data.map((h) => (
        <Row key={h.id} label={h.value} detail={h.kind === "seller" ? "Seller" : "Brand"}>
          <Button size="sm" variant="plain" onClick={() => unhide.mutate(h.id)}>
            Unhide
          </Button>
        </Row>
      ))}
    </Group>
  );
}
