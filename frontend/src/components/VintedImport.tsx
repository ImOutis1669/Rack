import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { vintedImportSummary } from "@rack/shared/account";
import { api } from "../api/client";
import { readZipEntry } from "../lib/zipEntry";
import { Icon } from "./icons/Icon";
import { Button, Group } from "./ui";

/** Settings > Import from Vinted: upload Vinted's data export and your liked items become
 *  likes in Rack. Only the liked-items page is read; the worker fetches each item at Vinted's
 *  usual pace (about one every 10 s), so this shows progress while it runs. */
export function VintedImport() {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const status = useQuery({
    queryKey: ["vinted-import"],
    queryFn: api.vintedImport,
    refetchInterval: (q) => (q.state.data?.running ? 5000 : false),
  });
  const upload = useMutation({
    mutationFn: async (f: File) => {
      // send just the likes page: the rest of the export never leaves this device
      const page = f.name.toLowerCase().endsWith(".zip") ? await readZipEntry(f, "favourite_items/index.html").catch(() => null) : null;
      return api.importVinted(page ? new File([page], "index.html", { type: "text/html" }) : f);
    },
    onSuccess: (s) => {
      qc.setQueryData(["vinted-import"], s);
      void qc.invalidateQueries({ queryKey: ["feed"] });
    },
  });
  const s = status.data;
  const started = !!s?.started_at;
  const minutesLeft = s?.running ? Math.max(1, Math.round((s.queued * 10) / 60)) : 0;

  return (
    <Group
      title="Import from Vinted"
      footer="Ask Vinted for a copy of your account data (in its privacy settings); it emails you a zip. Upload it here: only your liked items are read, and the messages, invoices and addresses in it are never opened or kept."
    >
      <div className="space-y-3 px-4 py-3">
        <p className="text-body">
          Your Vinted likes become likes in Rack, so the feed learns from everything you've ever saved there.
        </p>
        {s && started && (
          <div className="space-y-1">
            <p className="text-footnote" aria-live="polite">
              {vintedImportSummary(s)}
            </p>
            {s.running && (
              <>
                <div className="h-1.5 overflow-hidden rounded-full bg-fill" aria-hidden>
                  <div
                    className="h-full rounded-full bg-foreground transition-[width]"
                    style={{ width: `${Math.round(((s.added + s.missing) / Math.max(1, s.added + s.missing + s.queued)) * 100)}%` }}
                  />
                </div>
                <p className="text-caption text-muted">
                  {s.error ?? `About ${minutesLeft} min left. You can close this page; it carries on.`}
                </p>
              </>
            )}
          </div>
        )}
        <input
          ref={file}
          type="file"
          accept=".zip,.html,.htm,application/zip,text/html"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) upload.mutate(f);
          }}
        />
        <Button disabled={upload.isPending || !!s?.running} onClick={() => file.current?.click()}>
          <Icon name="add-photo" size={17} />
          {upload.isPending ? "Reading your export" : s?.running ? "Importing" : started ? "Import again" : "Upload Vinted export"}
        </Button>
        {upload.isError && <p className="text-footnote text-danger">{String((upload.error as Error).message)}</p>}
        {started && !s?.running && <p className="text-caption text-muted">Importing again only adds likes that are new since last time.</p>}
      </div>
    </Group>
  );
}
