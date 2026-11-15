import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import type { TasteItem, TasteKind } from "../api/types";
import { PageShell } from "../components/Nav";

const INPUT = "w-full rounded bg-neutral-900 px-2.5 py-1.5 text-sm ring-1 ring-white/15";
const BTN = "rounded bg-white px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40";

export function Taste({ onLogout }: { onLogout: () => void }) {
  const [kind, setKind] = useState<TasteKind>("wardrobe");
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
    <PageShell onLogout={onLogout}>
      <div className="mt-3 flex gap-2 text-sm">
        {(["wardrobe", "wishlist"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-full px-3 py-1 capitalize ring-1 ${kind === k ? "bg-white text-black ring-white" : "ring-white/20"}`}
          >
            {k}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        {kind === "wardrobe"
          ? "Photos of clothes you own and love. Rack finds things that look like them."
          : "Things you want: photos, links to listings or images, or a short description like “black derby shoes with a chunky sole”."}
      </p>

      <AddForms kind={kind} onAdded={refresh} />

      {items.isError && <p className="mt-4 text-sm text-red-400">{String(items.error)}</p>}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {items.data?.map((it) => <TasteCard key={it.id} item={it} onChange={refresh} />)}
      </div>
      {items.isSuccess && items.data.length === 0 && (
        <p className="mt-6 text-sm text-neutral-500">Nothing here yet.</p>
      )}
    </PageShell>
  );
}

function AddForms({ kind, onAdded }: { kind: TasteKind; onAdded: () => void }) {
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [inputKey, setInputKey] = useState(0);

  const done = () => {
    setNote("");
    setUrl("");
    setText("");
    setFiles([]);
    setInputKey((k) => k + 1);
    onAdded();
  };
  const upload = useMutation({ mutationFn: () => api.uploadTaste(kind, files, note), onSuccess: done });
  const byUrl = useMutation({ mutationFn: () => api.addTasteUrl(kind, url, note), onSuccess: done });
  const byText = useMutation({ mutationFn: () => api.addTasteText(kind, text), onSuccess: done });
  const err = upload.error ?? byUrl.error ?? byText.error;

  return (
    <div className="mt-3 grid gap-3 rounded-lg bg-neutral-900/60 p-3 ring-1 ring-white/10 sm:grid-cols-3">
      <div className="space-y-2">
        <label className="block text-xs text-neutral-400">Upload photos</label>
        <input
          key={inputKey}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-neutral-700 file:px-2 file:py-1 file:text-white"
        />
        <input className={INPUT} placeholder="Label (optional), e.g. black Margiela derbies" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className={BTN} disabled={!files.length || upload.isPending} onClick={() => upload.mutate()}>
          {upload.isPending ? "Uploading…" : `Add ${files.length || ""} photo${files.length === 1 ? "" : "s"}`}
        </button>
      </div>
      <div className="space-y-2">
        <label className="block text-xs text-neutral-400">Image or listing link</label>
        <input className={INPUT} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className={BTN} disabled={!url.trim() || byUrl.isPending} onClick={() => byUrl.mutate()}>
          {byUrl.isPending ? "Fetching…" : "Add link"}
        </button>
      </div>
      <div className="space-y-2">
        <label className="block text-xs text-neutral-400">Describe it</label>
        <input className={INPUT} placeholder="e.g. long black wool overcoat" value={text} onChange={(e) => setText(e.target.value)} />
        <button className={BTN} disabled={!text.trim() || byText.isPending} onClick={() => byText.mutate()}>
          Add text
        </button>
      </div>
      {err && <p className="text-xs text-red-400 sm:col-span-3">{String((err as Error).message)}</p>}
    </div>
  );
}

function TasteCard({ item, onChange }: { item: TasteItem; onChange: () => void }) {
  const [label, setLabel] = useState(item.text ?? item.note ?? "");
  const save = useMutation({
    mutationFn: () => api.patchTaste(item.id, item.image ? { note: label } : { text: label }),
    onSuccess: onChange,
  });
  const del = useMutation({ mutationFn: () => api.deleteTaste(item.id), onSuccess: onChange });
  const dirty = label !== (item.text ?? item.note ?? "");

  return (
    <div className="overflow-hidden rounded-lg bg-neutral-900 ring-1 ring-white/5">
      {item.image ? (
        <img src={item.image} alt={label} loading="lazy" className="aspect-square w-full object-cover" />
      ) : (
        <div className="flex aspect-square items-center justify-center p-3 text-center text-sm text-neutral-300">
          “{item.text}”
        </div>
      )}
      <div className="space-y-1.5 p-2">
        <input
          className="w-full rounded bg-neutral-800 px-2 py-1 text-xs"
          placeholder="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => dirty && save.mutate()}
        />
        <div className="flex items-center justify-between text-[11px]">
          <span className={item.embed_error ? "text-red-400" : item.embedded ? "text-emerald-400" : "text-neutral-500"} title={item.embed_error ?? ""}>
            {item.embed_error ? "Failed" : item.embedded ? "Learned" : "Processing…"}
          </span>
          <button className="text-neutral-400 hover:text-red-400" onClick={() => del.mutate()} disabled={del.isPending}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
