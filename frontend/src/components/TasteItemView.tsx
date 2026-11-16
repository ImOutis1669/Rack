import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Category, TasteItem } from "../api/types";
import { defaultPrice, parsePrice } from "../lib/bought";
import { safeHref } from "../lib/safe";
import { CATEGORY_LABEL, detailRows, displayName, itemName, sourceLink, tileValue } from "../lib/tasteItem";
import { tileBadge } from "../lib/trend";
import { cn } from "../lib/utils";
import { confidence } from "../lib/wardrobeValue";
import { toast } from "./Toast";
import { Button, Field, Group, IconButton, Input, Row, Select, Sheet, Textarea } from "./ui";
import { EstimateSection, MoneyField } from "./WardrobeValue";

/** Status shown on the photo while the item is still being read, or if its photo is missing. */
function photoState(it: TasteItem): string | null {
  if (it.photo_missing) return "Photo couldn't be copied";
  if (it.embed_error) return "Couldn't read";
  return it.embedded ? null : "Learning";
}

/** Grid tile, like a feed tile: photo, brand, name, value. Tap to open the sheet. */
export function TasteTile({ item, onOpen }: { item: TasteItem; onOpen: () => void }) {
  const value = tileValue(item);
  const badge = item.kind === "wardrobe" ? tileBadge(item.trend) : null;
  const state = photoState(item);
  const rough = item.custom_value_gbp == null && item.estimate_gbp != null && confidence(item.estimate_count) === "low";
  return (
    <button type="button" onClick={onOpen} className="press block w-full text-left" aria-label={displayName(item)}>
      <div className="relative overflow-hidden rounded-photo bg-fill">
        {item.image ? (
          <img src={item.image} alt="" loading="lazy" className="aspect-[4/5] w-full object-cover" />
        ) : (
          <div className="flex aspect-[4/5] items-center justify-center p-3 text-center text-footnote font-medium">“{displayName(item)}”</div>
        )}
        {state && (
          <span className={cn("glass absolute bottom-1.5 left-1.5 rounded-full px-2 py-0.5 text-caption font-medium", item.embed_error ? "text-danger" : "text-muted")}>
            {state}
          </span>
        )}
      </div>
      <div className="pt-2">
        {item.brand && <p className="truncate text-caption font-semibold tracking-wide text-muted uppercase">{item.brand}</p>}
        {itemName(item) && <p className="truncate text-footnote">{itemName(item)}</p>}
        {value && (
          <p className="mt-0.5 flex items-baseline gap-1.5">
            <span className="tabular text-headline font-semibold">{value}</span>
            {rough && <span aria-label="rough estimate" title="Rough estimate: few similar listings" className="size-1.5 rounded-full bg-subtle" />}
            {badge && (
              <span
                title={badge.title}
                className={cn(
                  "tabular text-caption font-semibold",
                  badge.direction === "up" && "text-accent",
                  badge.direction === "down" && "text-danger",
                  badge.direction === "steady" && "text-muted",
                )}
              >
                {badge.text}
              </span>
            )}
          </p>
        )}
      </div>
    </button>
  );
}

const CATEGORIES: Exclude<Category, "any">[] = ["tops", "trousers", "shoes", "outerwear"];

interface Draft {
  name: string;
  brand: string;
  size: string;
  category: "" | Exclude<Category, "any">;
  paid: string;
  worth: string;
  date: string;
  note: string;
}

export function draftFrom(it: TasteItem): Draft {
  return {
    name: it.name ?? itemName(it) ?? "",
    brand: it.brand ?? "",
    size: it.size ?? "",
    category: it.category ?? "",
    paid: defaultPrice(it.purchase_price_gbp),
    worth: defaultPrice(it.custom_value_gbp),
    date: it.purchase_date ?? "",
    note: it.note ?? "",
  };
}

/** The edit form's problems, by field ("" = fine). */
export function draftErrors(d: Draft, today = new Date().toISOString().slice(0, 10)): Partial<Record<keyof Draft, string>> {
  const out: Partial<Record<keyof Draft, string>> = {};
  if (d.paid && parsePrice(d.paid) == null) out.paid = "Enter pounds, like 180 or 180.50";
  if (d.worth && parsePrice(d.worth) == null) out.worth = "Enter pounds, like 180 or 180.50";
  if (d.date && (d.date < "1950-01-01" || d.date > today)) out.date = "Pick a date up to today";
  return out;
}

function patchFrom(d: Draft, kind: TasteItem["kind"]) {
  const blank = (s: string) => s.trim() || null;
  return {
    name: blank(d.name),
    brand: blank(d.brand),
    size: blank(d.size),
    category: d.category || null,
    note: blank(d.note),
    ...(kind === "wardrobe"
      ? {
          purchase_price_gbp: d.paid ? parsePrice(d.paid) : null,
          custom_value_gbp: d.worth ? parsePrice(d.worth) : null,
          purchase_date: d.date || null,
        }
      : {}),
  };
}

/** Item detail, in the listing sheet's style. The pencil switches to an edit form. */
export function TasteItemSheet({ item, open, onClose }: { item: TasteItem; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(item));
  useEffect(() => {
    if (!open) {
      setEditing(false);
      setConfirming(false);
    }
  }, [open]);
  const startEdit = () => {
    setDraft(draftFrom(item));
    setEditing(true);
  };
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["taste"] });
    void qc.invalidateQueries({ queryKey: ["saved"] });
  };
  const save = useMutation({
    mutationFn: () => api.patchTaste(item.id, patchFrom(draft, item.kind)),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteTaste(item.id),
    onSuccess: () => {
      onClose();
      refresh();
      toast("Deleted");
    },
  });
  const backToSaved = useMutation({
    mutationFn: () => api.undoBought(item.id),
    onSuccess: (r) => {
      onClose();
      refresh();
      toast(r.restored_to_saved ? "Back in Saved" : "Removed. The listing is gone, so it couldn't go back to Saved.");
    },
  });
  const errors = draftErrors(draft);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const link = sourceLink(item);
  const rows = detailRows(item);
  const value = tileValue(item);
  const wardrobe = item.kind === "wardrobe";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="full"
      title={editing ? "Edit" : (item.brand ?? (wardrobe ? "Wardrobe" : "Wishlist"))}
      actions={
        !editing && (
          <IconButton label="Edit" onClick={startEdit} className="size-9 bg-fill">
            <Pencil size={16} strokeWidth={2} />
          </IconButton>
        )
      }
      footer={
        editing && (
          <div className="flex gap-2">
            <Button size="lg" className="flex-1" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="lg"
              className="flex-1"
              disabled={Object.keys(errors).length > 0 || save.isPending}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
          </div>
        )
      }
    >
      {!editing ? (
        <div className="md:grid md:h-full md:grid-cols-[1fr_1fr]">
          {item.image ? (
            <img src={item.image} alt={displayName(item)} className="aspect-[4/5] w-full bg-fill object-cover md:h-full md:aspect-auto" />
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center bg-fill p-6 text-center text-title font-semibold">“{displayName(item)}”</div>
          )}
          <div className="space-y-5 p-4 md:overflow-y-auto md:p-6">
            <div className="space-y-1">
              {item.brand && <p className="text-caption font-semibold tracking-wide text-muted uppercase">{item.brand}</p>}
              <h2 className="font-display text-title font-semibold">
                {itemName(item) ?? <span className="text-muted">No name yet</span>}
              </h2>
              {value && <p className="tabular font-display text-[26px] font-bold">{value}</p>}
              {photoState(item) && <p className="text-footnote text-muted">{photoState(item)}</p>}
            </div>
            {rows.length > 0 && (
              <Group>
                {rows.map((r) => (
                  <Row key={r.label} label={r.label}>
                    <span className="tabular text-body text-muted">{r.value}</span>
                  </Row>
                ))}
              </Group>
            )}
            {link && safeHref(link.href) && (
              <Button size="lg" className="w-full" onClick={() => window.open(safeHref(link.href), "_blank", "noopener,noreferrer")}>
                <ExternalLink size={17} /> {link.label}
              </Button>
            )}
            {item.note && (
              <section className="space-y-1">
                <h3 className="px-1 text-footnote font-semibold text-muted">Note</h3>
                <p className="px-1 text-body whitespace-pre-line">{item.note}</p>
              </section>
            )}
            <EstimateSection item={item} open={open} />
          </div>
        </div>
      ) : (
        <form
          className="space-y-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!Object.keys(errors).length) save.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Brand" className="col-span-2">
              {(id) => <Input id={id} value={draft.brand} onChange={(e) => set("brand", e.target.value)} placeholder={item.estimate_brand ?? "e.g. Rick Owens"} autoComplete="off" />}
            </Field>
            <Field label="Name" className="col-span-2">
              {(id) => <Input id={id} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. black leather jacket" autoComplete="off" />}
            </Field>
            <Field label="Size">
              {(id) => <Input id={id} value={draft.size} onChange={(e) => set("size", e.target.value)} placeholder="e.g. M, UK 9" autoComplete="off" />}
            </Field>
            <Field label="Category">
              {(id) => (
                <Select id={id} value={draft.category} onChange={(e) => set("category", e.target.value as Draft["category"])}>
                  <option value="">{item.effective_category && item.effective_category !== "any" ? `Auto (${CATEGORY_LABEL[item.effective_category]})` : "Not set"}</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {wardrobe && (
              <>
                <div className="col-span-2">
                  <MoneyField label="Price paid" value={draft.paid} onChange={(v) => set("paid", v)} />
                </div>
                <div className="col-span-2">
                  <MoneyField
                    label="Your value"
                    value={draft.worth}
                    onChange={(v) => set("worth", v)}
                    hint={item.estimate_gbp != null ? "Leave empty to use the estimate." : "Leave empty to count it at what you paid."}
                  />
                </div>
                <Field label="Date of purchase" hint={errors.date} className="col-span-2">
                  {(id) => <Input id={id} type="date" value={draft.date} onChange={(e) => set("date", e.target.value)} max={new Date().toISOString().slice(0, 10)} />}
                </Field>
              </>
            )}
            <Field label="Note" className="col-span-2">
              {(id) => <Textarea id={id} value={draft.note} onChange={(e) => set("note", e.target.value)} />}
            </Field>
          </div>
          {save.isError && <p className="text-footnote text-danger">{String((save.error as Error).message)}</p>}

          <div className="pt-4">
            {!confirming ? (
              <Button type="button" variant="danger" size="lg" className="w-full" onClick={() => setConfirming(true)}>
                Delete item
              </Button>
            ) : (
              <div role="alertdialog" aria-label="Delete this item?" className="space-y-3 rounded-group bg-surface p-4 dark:bg-elevated">
                <p className="text-body font-semibold">Delete this item?</p>
                <p className="text-footnote text-muted">
                  {item.purchased_at
                    ? "It leaves your wardrobe. You can also put it back in Saved instead."
                    : "It leaves your wardrobe and stops shaping your feed. This can't be undone."}
                </p>
                <div className="flex flex-col gap-2">
                  <Button type="button" variant="danger" size="lg" disabled={remove.isPending} onClick={() => remove.mutate()}>
                    Delete
                  </Button>
                  {item.purchased_at && (
                    <Button type="button" size="lg" disabled={backToSaved.isPending} onClick={() => backToSaved.mutate()}>
                      Move back to Saved
                    </Button>
                  )}
                  <Button type="button" variant="plain" size="lg" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </form>
      )}
    </Sheet>
  );
}
