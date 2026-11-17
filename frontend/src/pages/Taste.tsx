import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api } from "../api/client";
import type { TasteKind } from "@rack/shared/types";
import { PageShell } from "../components/AppShell";
import { TasteItemSheet, TasteTile } from "../components/TasteItemView";
import { Button, EmptyState, Field, IconButton, Input, Segmented, Sheet, Skeleton } from "../components/ui";
import { WardrobeSummary } from "../components/WardrobeValue";
import { Icon } from "../components/icons/Icon";

const COPY: Record<TasteKind, string> = {
  wardrobe: "Photos of clothes you own and love. Rack looks for things that look like them.",
  wishlist: "Things you want: photos, links to listings, or a short description like “black derby shoes with a chunky sole”.",
};

export function Taste() {
  const [kind, setKind] = useState<TasteKind>("wardrobe");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const qc = useQueryClient();
  const items = useQuery({
    queryKey: ["taste", kind],
    queryFn: () => api.taste(kind),
    refetchInterval: (q) => (q.state.data?.some((i) => !i.embedded && !i.embed_error) ? 5000 : false),
  });
  const openItem = items.data?.find((i) => i.id === openId);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["taste"] });
    void qc.invalidateQueries({ queryKey: ["profile"] });
  };

  return (
    <PageShell
      title="Wardrobe"
      actions={
        <IconButton label={`Add to ${kind}`} onClick={() => setAdding(true)}>
          <Icon name="plus" size={21} />
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
      {kind === "wardrobe" && items.isSuccess && items.data.length > 0 && <WardrobeSummary items={items.data} />}

      {items.isPending && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/5]" />
          ))}
        </div>
      )}
      {items.isError && <p className="text-footnote text-danger">{String((items.error as Error).message)}</p>}
      {items.isSuccess && items.data.length === 0 && (
        <EmptyState
          icon={<Icon name="wardrobe" size={24} />}
          title={kind === "wardrobe" ? "Your wardrobe is empty" : "Your wishlist is empty"}
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Icon name="plus" size={17} /> Add {kind === "wardrobe" ? "photos" : "something"}
            </Button>
          }
        >
          The more you add, the better the feed gets.
        </EmptyState>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:gap-x-5 lg:grid-cols-5">
        {items.data?.map((it) => <TasteTile key={it.id} item={it} onOpen={() => setOpenId(it.id)} />)}
      </div>
      {openItem && <TasteItemSheet item={openItem} open={openId != null} onClose={() => setOpenId(null)} />}

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
            <Icon name="add-photo" size={26} className="text-muted" />
            <span className="text-body font-medium">{files.length ? `${files.length} photo${files.length === 1 ? "" : "s"} chosen` : "Choose photos"}</span>
            <span className="text-caption text-muted">From your camera roll or files. Up to 20 at once.</span>
          </button>
          <Input placeholder="Name (optional), e.g. black Margiela derbies" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="primary" className="w-full" disabled={!files.length || upload.isPending} onClick={() => upload.mutate()}>
            {upload.isPending ? "Uploading" : "Add photos"}
          </Button>
        </section>

        <div className="flex items-center gap-3 text-caption text-muted">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <Field label={<span className="inline-flex items-center gap-1.5"><Icon name="link" size={14} /> Image or listing link</span>}>
          {(id) => (
            <div className="flex gap-2">
              <Input id={id} type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
              <Button disabled={!url.trim() || byUrl.isPending} onClick={() => byUrl.mutate()}>
                {byUrl.isPending ? "Adding" : "Add"}
              </Button>
            </div>
          )}
        </Field>

        <Field label={<span className="inline-flex items-center gap-1.5"><Icon name="text" size={14} /> Describe it</span>}>
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
