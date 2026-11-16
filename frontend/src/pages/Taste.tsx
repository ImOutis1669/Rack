import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Link2, Plus, Shirt, Trash2, Type } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../api/client";
import type { TasteItem, TasteKind } from "../api/types";
import { PageShell } from "../components/AppShell";
import { Button, EmptyState, Field, IconButton, Input, Segmented, Sheet, Skeleton } from "../components/ui";
import { boughtLabel } from "../lib/bought";
import { safeHref } from "../lib/safe";
import { cn } from "../lib/utils";

const COPY: Record<TasteKind, string> = {
  wardrobe: "Photos of clothes you own and love. Rack looks for things that look like them.",
  wishlist: "Things you want: photos, links to listings, or a short description like “black derby shoes with a chunky sole”.",
};

export function Taste() {
  const [kind, setKind] = useState<TasteKind>("wardrobe");
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const items = useQuery({
    queryKey: ["taste", kind],
    queryFn: () => api.taste(kind),
    refetchInterval: (q) => (q.state.data?.some((i) => !i.embedded && !i.embed_error) ? 5000 : false),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["taste"] });
    void qc.invalidateQueries({ queryKey: ["profile"] });
  };

  return (
    <PageShell
      title="Wardrobe"
      actions={
        <IconButton label={`Add to ${kind}`} onClick={() => setAdding(true)}>
          <Plus size={21} strokeWidth={1.9} />
        </IconButton>
      }
      below={
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            ["wardrobe", "Wardrobe"],
            ["wishlist", "Wishlist"],
          ]}
        />
      }
    >
      <p className="-mt-1 mb-5 max-w-xl text-footnote text-muted">{COPY[kind]}</p>

      {items.isPending && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      )}
      {items.isError && <p className="text-footnote text-danger">{String((items.error as Error).message)}</p>}
      {items.isSuccess && items.data.length === 0 && (
        <EmptyState
          icon={<Shirt size={24} />}
          title={kind === "wardrobe" ? "Your wardrobe is empty" : "Your wishlist is empty"}
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus size={17} /> Add {kind === "wardrobe" ? "photos" : "something"}
            </Button>
          }
        >
          The more you add, the better the feed gets.
        </EmptyState>
      )}

      <div className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 lg:grid-cols-6">
        {items.data?.map((it) => <TasteTile key={it.id} item={it} onChange={refresh} />)}
      </div>

      <AddSheet
        open={adding}
        kind={kind}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          refresh();
        }}
      />
    </PageShell>
  );
}

function TasteTile({ item, onChange }: { item: TasteItem; onChange: () => void }) {
  const [label, setLabel] = useState(item.text ?? item.note ?? "");
  const save = useMutation({
    mutationFn: () => api.patchTaste(item.id, item.image ? { note: label } : { text: label }),
    onSuccess: onChange,
  });
  const del = useMutation({ mutationFn: () => api.deleteTaste(item.id), onSuccess: onChange });
  const dirty = label !== (item.text ?? item.note ?? "");
  const state = item.photo_missing
    ? "Photo couldn't be copied"
    : item.embed_error
      ? "Couldn't read"
      : item.embedded
        ? null
        : "Learning";
  const bought = boughtLabel(item);
  const listingHref = item.listing_id != null ? safeHref(item.listing_url) : undefined;

  return (
    <div className="group">
      <div className="relative overflow-hidden rounded-photo bg-fill">
        {item.image ? (
          <img src={item.image} alt={label} loading="lazy" className="aspect-square w-full object-cover" />
        ) : (
          <div className="flex aspect-square items-center justify-center p-3 text-center text-footnote font-medium">“{item.text}”</div>
        )}
        <IconButton
          label="Remove"
          glass
          onClick={() => window.confirm("Remove this?") && del.mutate()}
          className="absolute top-1 right-1 size-8 opacity-100 md:opacity-0 md:group-hover:opacity-100"
        >
          <Trash2 size={14} />
        </IconButton>
        {state && (
          <span
            title={item.embed_error ?? ""}
            className={cn(
              "glass absolute bottom-1.5 left-1.5 rounded-full px-2 py-0.5 text-caption font-medium",
              item.embed_error ? "text-danger" : "text-muted",
            )}
          >
            {state}
          </span>
        )}
      </div>
      <input
        aria-label="Label"
        className="mt-1.5 w-full truncate rounded-md bg-transparent px-1 py-0.5 text-footnote outline-none placeholder:text-subtle focus:bg-fill"
        placeholder="Add a label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => dirty && save.mutate()}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {bought && (
        <p className="line-clamp-2 px-1 text-caption text-muted">
          {listingHref ? (
            <a href={listingHref} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
              {bought}
            </a>
          ) : (
            bought
          )}
        </p>
      )}
    </div>
  );
}

function AddSheet({ open, kind, onClose, onAdded }: { open: boolean; kind: TasteKind; onClose: () => void; onAdded: () => void }) {
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const picker = useRef<HTMLInputElement>(null);

  const done = () => {
    setNote("");
    setUrl("");
    setText("");
    setFiles([]);
    if (picker.current) picker.current.value = "";
    onAdded();
  };
  const upload = useMutation({ mutationFn: () => api.uploadTaste(kind, files, note), onSuccess: done });
  const byUrl = useMutation({ mutationFn: () => api.addTasteUrl(kind, url, note), onSuccess: done });
  const byText = useMutation({ mutationFn: () => api.addTasteText(kind, text), onSuccess: done });
  const err = upload.error ?? byUrl.error ?? byText.error;

  return (
    <Sheet open={open} onClose={onClose} title={kind === "wardrobe" ? "Add to wardrobe" : "Add to wishlist"}>
      <div className="space-y-6 p-4">
        <section className="space-y-3">
          <input
            ref={picker}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <button
            onClick={() => picker.current?.click()}
            className="press flex w-full flex-col items-center gap-2 rounded-group border border-dashed border-border bg-surface px-4 py-7 text-center dark:bg-elevated"
          >
            <ImagePlus size={26} strokeWidth={1.6} className="text-muted" />
            <span className="text-body font-medium">{files.length ? `${files.length} photo${files.length === 1 ? "" : "s"} chosen` : "Choose photos"}</span>
            <span className="text-caption text-muted">From your camera roll or files. Up to 20 at once.</span>
          </button>
          <Input placeholder="Label (optional), e.g. black Margiela derbies" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="primary" className="w-full" disabled={!files.length || upload.isPending} onClick={() => upload.mutate()}>
            {upload.isPending ? "Uploading" : "Add photos"}
          </Button>
        </section>

        <div className="flex items-center gap-3 text-caption text-muted">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <Field label={<span className="inline-flex items-center gap-1.5"><Link2 size={14} /> Image or listing link</span>}>
          {(id) => (
            <div className="flex gap-2">
              <Input id={id} type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
              <Button disabled={!url.trim() || byUrl.isPending} onClick={() => byUrl.mutate()}>
                {byUrl.isPending ? "Adding" : "Add"}
              </Button>
            </div>
          )}
        </Field>

        <Field label={<span className="inline-flex items-center gap-1.5"><Type size={14} /> Describe it</span>}>
          {(id) => (
            <div className="flex gap-2">
              <Input id={id} placeholder="Long black wool overcoat" value={text} onChange={(e) => setText(e.target.value)} />
              <Button disabled={!text.trim() || byText.isPending} onClick={() => byText.mutate()}>
                Add
              </Button>
            </div>
          )}
        </Field>

        {err && <p className="text-footnote text-danger">{String((err as Error).message)}</p>}
      </div>
    </Sheet>
  );
}
