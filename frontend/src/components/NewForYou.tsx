import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { freshTitle } from "@rack/shared/fresh";
import { timeAgo } from "@rack/shared/format";
import type { FreshPage } from "@rack/shared/types";
import { api } from "../api/client";
import { ListingGrid, ListingItem } from "./ListingItem";
import { Icon } from "./icons/Icon";
import { Button, IconButton, Sheet } from "./ui";

const DISMISSED_KEY = "rack.freshDismissed";

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/** The strip's data for the feed page, which also leaves its listings out of the grid below.
 *  Under the "feed" query key, so the Refresh button's reloads update it too. Closing it hides
 *  it until your next refresh. */
export function useNewForYou(enabled: boolean) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const fresh = useQuery({ queryKey: ["feed", "fresh"], queryFn: () => api.fresh(12), staleTime: 30_000, enabled });
  const page = fresh.data;
  const shown = enabled && !!page?.total && !!page.since && dismissed !== page.since ? page : null;
  const dismiss = () => {
    if (!page?.since) return;
    setDismissed(page.since);
    try {
      localStorage.setItem(DISMISSED_KEY, page.since);
    } catch {
      // private window: hidden until reload
    }
  };
  return { page: shown, ids: new Set(shown?.items.map((i) => i.id) ?? []), dismiss };
}

/** "New for you" at the top of the feed: the strong new finds of your latest Refresh (those
 *  scoring as well as your top few hundred), best first. */
export function NewForYou({
  page,
  onDismiss,
  onSeen,
  onHidden,
}: {
  page: FreshPage & { since: string };
  onDismiss: () => void;
  onSeen: (id: number) => void;
  onHidden: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const all = useQuery({ queryKey: ["feed", "fresh", "all"], queryFn: () => api.fresh(60), enabled: open });
  const since = page.since;
  const dismiss = onDismiss;

  return (
    <section aria-label="New for you" className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-headline font-semibold">{freshTitle(page.total)}</h2>
          <p className="text-footnote text-muted">From your refresh {timeAgo(since)}, best matches first</p>
        </div>
        {page.total > page.items.length && (
          <Button variant="plain" size="sm" onClick={() => setOpen(true)}>
            Show all
          </Button>
        )}
        <IconButton label="Hide new for you" onClick={dismiss} className="size-9">
          <Icon name="close" size={16} />
        </IconButton>
      </div>
      <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 md:mx-0 md:gap-5 md:px-0">
        {page.items.map((item, i) => (
          <div key={item.id} className="w-36 shrink-0 snap-start sm:w-44">
            <ListingItem item={item} index={i} onSeen={onSeen} onHidden={onHidden} />
          </div>
        ))}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={freshTitle(page.total)} size="full">
        <div className="p-4">
          {all.isPending ? (
            <p className="py-8 text-center text-footnote text-muted">Loading</p>
          ) : (
            <ListingGrid>
              {(all.data?.items ?? []).map((item, i) => (
                <ListingItem key={item.id} item={item} index={i} onSeen={onSeen} onHidden={onHidden} />
              ))}
            </ListingGrid>
          )}
        </div>
      </Sheet>
    </section>
  );
}
