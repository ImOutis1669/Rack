import { useState } from "react";
import type { Listing } from "../api/types";
import { ListingSheet } from "./ListingSheet";
import { ListingTile } from "./ListingTile";
import { useListingActions } from "./useListingActions";

/** A listing in a grid: the tile plus its detail sheet, sharing optimistic state. */
export function ListingItem({
  item,
  index,
  onSeen,
  onHidden,
}: {
  item: Listing;
  index: number;
  onSeen?: (id: number) => void;
  onHidden?: (id: number) => void;
}) {
  const actions = useListingActions(item, onHidden);
  const [open, setOpen] = useState(false);
  return (
    <>
      <ListingTile item={item} actions={actions} index={index} onOpen={() => setOpen(true)} onSeen={onSeen} />
      <ListingSheet item={item} open={open} onClose={() => setOpen(false)} actions={actions} />
    </>
  );
}

export function ListingGrid({ children }: { children: React.ReactNode }) {
  return <div className="columns-2 gap-3 sm:columns-3 md:gap-5 lg:columns-4 xl:columns-5">{children}</div>;
}
