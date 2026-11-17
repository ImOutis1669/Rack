import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { CATEGORIES, type Category, type FreeSource, type Hunt, type HuntInput } from "../api/types";
import { PageShell } from "../components/AppShell";
import { ListingGrid, ListingItem } from "../components/ListingItem";
import { NumberTicker } from "../components/magicui/number-ticker";
import { Button, Chip, EmptyState, Field, IconButton, Input, Menu, Select, Sheet, Switch } from "../components/ui";
import { SOURCE_LABEL, timeAgo } from "../lib/format";
import { emptyHunt, huntSummary, INTERVALS, sizesHint } from "../lib/hunts";
import { splitList } from "../lib/units";
import { cn } from "../lib/utils";
import { Icon } from "../components/icons/Icon";

const FREE: FreeSource[] = ["ebay", "vinted", "grailed"];

export function Hunts() {
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
    <PageShell
      title="Hunts"
      wide={false}
      actions={
        <IconButton label="New hunt" onClick={() => setEditing({ id: null, value: emptyHunt() })}>
          <Icon name="plus" size={21} />
        </IconButton>
      }
    >
      <p className="-mt-1 mb-5 text-footnote text-muted">
        Saved searches that run on their own schedule. You get an alert when something new matches.
      </p>

      {hunts.isSuccess && hunts.data.length === 0 && (
        <EmptyState
          icon={<Icon name="hunts" size={24} />}
          title="No hunts yet"
          action={
            <Button variant="primary" onClick={() => setEditing({ id: null, value: emptyHunt() })}>
              <Icon name="plus" size={17} /> New hunt
            </Button>
          }
        >
          Hunt for a specific piece, like Rick Owens Geobaskets under £400, or use “Hunt for this” on any listing.
        </EmptyState>
      )}

      <div className="space-y-3">
        {hunts.data?.map((h) => (
          <HuntCard key={h.id} hunt={h} onEdit={() => setEditing({ id: h.id, value: h })} onChange={refresh} />
        ))}
      </div>

      <HuntForm
        key={editing ? `${editing.id ?? "new"}-${editing.value.query}` : "closed"}
        open={editing !== null}
        id={editing?.id ?? null}
        initial={editing?.value ?? emptyHunt()}
        onDone={() => {
          close();
          refresh();
        }}
        onCancel={close}
      />
    </PageShell>
  );
}

function HuntCard({ hunt, onEdit, onChange }: { hunt: Hunt; onEdit: () => void; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const matches = useQuery({
    queryKey: ["hunt-matches", hunt.id, hunt.match_count],
    queryFn: () => api.huntMatches(hunt.id),
    enabled: open,
  });
  const run = useMutation({ mutationFn: () => api.runHunt(hunt.id), onSuccess: onChange });
  const update = useMutation({
    mutationFn: (patch: Partial<Hunt>) => api.updateHunt(hunt.id, { ...hunt, ...patch }),
    onSuccess: onChange,
  });
  const del = useMutation({ mutationFn: () => api.deleteHunt(hunt.id), onSuccess: onChange });

  const status = hunt.run_requested_at
    ? "Running now"
    : hunt.last_run_at
      ? `Checked ${timeAgo(hunt.last_run_at)}`
      : "Not run yet";

  return (
    <div className={cn("rounded-group bg-surface", !hunt.enabled && "opacity-70")}>
      <div className="flex items-start gap-3 p-4">
        <button onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <p className="flex items-center gap-2 text-headline font-semibold">
            <span className="truncate">{hunt.name}</span>
            {!hunt.enabled && <span className="rounded-full bg-fill px-2 py-0.5 text-caption font-medium text-muted">Paused</span>}
            {!hunt.notify && <Icon name="mute" size={14} className="text-muted" label="Alerts off" />}
          </p>
          <p className="mt-0.5 text-footnote text-muted">{huntSummary(hunt)}</p>
          <p className="mt-1.5 flex items-center gap-1 text-caption text-muted">
            {status}
            <Icon name="chevron-down" size={14} className={cn("transition-transform", open && "rotate-180")} />
          </p>
          {hunt.last_error && <p className="mt-1 text-caption text-warning">{hunt.last_error}</p>}
        </button>
        <div className="flex shrink-0 items-start gap-1">
          <div className="pt-1 text-right">
            <NumberTicker value={hunt.match_count} className="font-display text-title font-bold" />
            <p className="text-caption text-muted">{hunt.new_count ? `${hunt.new_count} new` : "matches"}</p>
          </div>
          <Menu
            trigger={(p) => (
              <IconButton label="Hunt actions" {...p}>
                <Icon name="more" size={22} />
              </IconButton>
            )}
            items={[
              { label: "Run now", icon: <Icon name="refresh" size={16} />, onSelect: () => run.mutate(), disabled: run.isPending },
              hunt.enabled
                ? { label: "Pause", icon: <Icon name="pause" size={16} />, onSelect: () => update.mutate({ enabled: false }) }
                : { label: "Resume", icon: <Icon name="play" size={16} />, onSelect: () => update.mutate({ enabled: true }) },
              hunt.notify
                ? { label: "Mute alerts", icon: <Icon name="mute" size={16} />, onSelect: () => update.mutate({ notify: false }) }
                : { label: "Turn alerts on", icon: <Icon name="alerts-on" size={16} />, onSelect: () => update.mutate({ notify: true }) },
              { label: "Edit", icon: <Icon name="edit" size={16} />, onSelect: onEdit },
              {
                label: "Delete",
                icon: <Icon name="delete" size={16} />,
                danger: true,
                onSelect: () => window.confirm(`Delete “${hunt.name}” and its matches?`) && del.mutate(),
              },
            ]}
          />
        </div>
      </div>
      {open && (
        <div className="border-t border-border p-4">
          {matches.isSuccess && matches.data.length === 0 && <p className="text-footnote text-muted">No matches yet.</p>}
          <ListingGrid>
            {matches.data?.map((item, i) => <ListingItem key={item.id} item={item} index={i} />)}
          </ListingGrid>
        </div>
      )}
    </div>
  );
}

function HuntForm(props: { open: boolean; id: number | null; initial: HuntInput; onDone: () => void; onCancel: () => void }) {
  const [h, setH] = useState<HuntInput>(props.initial);
  const [sizes, setSizes] = useState(props.initial.sizes.join(", "));
  const save = useMutation({
    mutationFn: () => {
      const list = splitList(sizes);
      const body: HuntInput = { ...h, name: h.name.trim() || h.query.trim(), sizes: list, strict_size: h.strict_size && list.length > 0 };
      return props.id == null ? api.createHunt(body) : api.updateHunt(props.id, body);
    },
    onSuccess: props.onDone,
  });
  const set = <K extends keyof HuntInput>(k: K, v: HuntInput[K]) => setH((x) => ({ ...x, [k]: v }));
  const hasSizes = splitList(sizes).length > 0;

  return (
    <Sheet
      open={props.open}
      onClose={props.onCancel}
      title={props.id == null ? "New hunt" : "Edit hunt"}
      footer={
        <div className="space-y-2">
          {save.error && <p className="text-footnote text-danger">{String((save.error as Error).message)}</p>}
          <Button variant="primary" size="lg" className="w-full" disabled={h.query.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>
            {props.id == null ? "Create hunt" : "Save changes"}
          </Button>
        </div>
      }
    >
      <div className="space-y-5 p-4">
        <Field label="Search for" hint="Every word must appear in the listing.">
          {(id) => <Input id={id} value={h.query} placeholder="rick owens geobasket" onChange={(e) => set("query", e.target.value)} />}
        </Field>
        <Field label="Name">
          {(id) => <Input id={id} value={h.name} placeholder={h.query || "Optional"} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            {(id) => (
              <Select id={id} value={h.category} onChange={(e) => set("category", e.target.value as Category)}>
                <option value="any">Any</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c[0].toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Max price (£)">
            {(id) => (
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                placeholder="Any"
                value={h.max_price_gbp ?? ""}
                onChange={(e) => set("max_price_gbp", e.target.value ? Number(e.target.value) : null)}
              />
            )}
          </Field>
          <Field label="Sizes" hint={sizesHint(h.strict_size && hasSizes, hasSizes)}>
            {(id) => <Input id={id} value={sizes} placeholder="43, UK 9" onChange={(e) => setSizes(e.target.value)} />}
          </Field>
          <Field label="Check">
            {(id) => (
              <Select id={id} value={h.interval_minutes} onChange={(e) => set("interval_minutes", Number(e.target.value))}>
                {INTERVALS.map(([m, label]) => (
                  <option key={m} value={m}>
                    {label[0].toUpperCase() + label.slice(1)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className={cn("col-span-2 flex min-h-11 items-center justify-between gap-3", !hasSizes && "opacity-40")}>
            <span className="text-body">
              Size must match
            </span>
            <Switch
              checked={h.strict_size && hasSizes}
              onChange={(v) => hasSizes && set("strict_size", v)}
              label="Size must match"
            />
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-footnote font-medium text-muted">Sources</p>
          <div className="flex flex-wrap gap-2">
            {FREE.map((s) => (
              <Chip
                key={s}
                selected={h.sources.includes(s)}
                onClick={() => set("sources", h.sources.includes(s) ? h.sources.filter((x) => x !== s) : [...h.sources, s])}
              >
                {SOURCE_LABEL[s]}
              </Chip>
            ))}
          </div>
          <p className="text-caption text-muted">None selected searches all free sources.</p>
        </div>
        <div className="divide-y divide-border rounded-group bg-surface dark:bg-elevated">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-body">Send alerts</span>
            <Switch checked={h.notify} onChange={(v) => set("notify", v)} label="Send alerts" />
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-body">Active</span>
            <Switch checked={h.enabled} onChange={(v) => set("enabled", v)} label="Active" />
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-body">Minimum match</span>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={0}
                max={100}
                aria-label="Minimum match percent"
                placeholder="Off"
                className="h-9 w-20 text-right"
                value={h.min_score == null ? "" : Math.round(h.min_score * 100)}
                onChange={(e) => set("min_score", e.target.value ? Number(e.target.value) / 100 : null)}
              />
              <span className="text-footnote text-muted">%</span>
            </div>
          </div>
        </div>
        <p className="text-caption text-muted">
          The first run only records what's already listed; you're alerted to new matches after that. Hidden sellers, banned words and fit rules still apply.
        </p>
      </div>
    </Sheet>
  );
}
