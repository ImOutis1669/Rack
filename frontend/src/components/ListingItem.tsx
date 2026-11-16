import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { prefetchForOpen, prefetchGallery, prefetchOnView } from "../lib/prefetch";
import type { Listing } from "../api/types";
import { BoughtSheet } from "./BoughtSheet";
import { ListingSheet } from "./ListingSheet";
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
  const startBuying = () => {
    setOpen(false);
    setBuying(true);
  };
  return (
    <>
      <ListingTile
        item={item}
        actions={actions}
        index={index}
        onOpen={() => setOpen(true)}
        onSeen={onSeen}
        onBought={showBought ? startBuying : undefined}
        onPrefetch={onPrefetch}
      />
      <ListingSheet item={item} open={open} onClose={() => setOpen(false)} actions={actions} onBought={startBuying} />
      <BoughtSheet item={item} open={buying} onClose={() => setBuying(false)} onDone={() => onHidden?.(item.id)} />
    </>
  );
}

export function ListingGrid({ children }: { children: React.ReactNode }) {
  return <div className="columns-2 gap-3 sm:columns-3 md:gap-5 lg:columns-4 xl:columns-5">{children}</div>;
}
