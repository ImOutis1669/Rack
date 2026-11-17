import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../api/client";
import type { Listing } from "../api/types";
import { loadSnapshot, saveSnapshot } from "../lib/snapshot";
import { PageShell } from "../components/AppShell";
import { VirtualGrid } from "../components/VirtualGrid";
import { ListingGrid, ListingItem } from "../components/ListingItem";
import { EmptyState, Skeleton } from "../components/ui";
import { Icon } from "../components/icons/Icon";

export function Saved() {
  const q = useQuery({
    queryKey: ["saved"],
    queryFn: api.saved,
    staleTime: 0,
    placeholderData: () => loadSnapshot<Listing[]>("saved"), // instant start
  });
  useEffect(() => {
    if (q.data && !q.isPlaceholderData) saveSnapshot("saved", q.data);
  }, [q.data, q.isPlaceholderData]);
  return (
    <PageShell title="Saved">
      {q.isPending && (
        <ListingGrid>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="mb-5 aspect-[4/5] break-inside-avoid" />
          ))}
        </ListingGrid>
      )}
      {q.isSuccess && q.data.length === 0 && (
        <EmptyState icon={<Icon name="bookmark" size={24} />} title="Nothing saved yet">
          Tap the bookmark on a listing to keep it here. You'll get an alert if its price drops.
        </EmptyState>
      )}
      <VirtualGrid
        items={q.data ?? []}
        getKey={(item) => item.id}
        memoryKey="saved"
        renderItem={(item, i) => <ListingItem item={item} index={i} showBought />}
      />
    </PageShell>
  );
}
