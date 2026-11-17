import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useState } from "react";
import { prefetchForOpen, prefetchGallery, prefetchOnView } from "../lib/prefetch";
import type { Listing } from "@rack/shared/types";

// The sheets load the first time any listing is opened, not with the feed.
const ListingSheet = lazy(() => import("./ListingSheet").then((m) => ({ default: m.ListingSheet })));
const BoughtSheet = lazy(() => import("./BoughtSheet").then((m) => ({ default: m.BoughtSheet })));
import { ListingTile } from "./ListingTile";
import { useListingActions } from "./useListingActions";

/** A listing in a grid: the tile plus its detail sheet, sharing optimistic state. */
export function ListingItem({
  item,
  index,
  onSeen,
  onHidden,
  showBought = false,
}: {
  item: Listing;
  index: number;
  onSeen?: (id: number) => void;
  onHidden?: (id: number) => void;
  /** Saved page: an "I bought it" button on the tile. */
  showBought?: boolean;
}) {
  const actions = useListingActions(item, onHidden);
  const qc = useQueryClient();
  const onPrefetch = useCallback(
    (why: "view" | "touch") => {
      if (why === "touch") prefetchForOpen(qc, item);
      else if (prefetchOnView(item.source)) prefetchGallery(qc, item.id);
    },
    [qc, item],
  );
  const [open, setOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  // mounted from the first open on, so the closing animation still plays
  const [sheetMounted, setSheetMounted] = useState(false);
  const [boughtMounted, setBoughtMounted] = useState(false);
  const startBuying = () => {
    setOpen(false);
    setBoughtMounted(true);
    setBuying(true);
  };
  const openSheet = () => {
    setSheetMounted(true);
    setOpen(true);
  };
  return (
    <>
      <ListingTile
        item={item}
        actions={actions}
        index={index}
        onOpen={openSheet}
        onSeen={onSeen}
        onBought={showBought ? startBuying : undefined}
        onPrefetch={onPrefetch}
      />
      {sheetMounted && (
        <Suspense fallback={null}>
          <ListingSheet item={item} open={open} onClose={() => setOpen(false)} actions={actions} onBought={startBuying} />
        </Suspense>
      )}
      {boughtMounted && (
        <Suspense fallback={null}>
          <BoughtSheet item={item} open={buying} onClose={() => setBuying(false)} onDone={() => onHidden?.(item.id)} />
        </Suspense>
      )}
    </>
  );
}

export function ListingGrid({ children }: { children: React.ReactNode }) {
  return <div className="columns-2 gap-3 sm:columns-3 md:gap-5 lg:columns-4 xl:columns-5">{children}</div>;
}
