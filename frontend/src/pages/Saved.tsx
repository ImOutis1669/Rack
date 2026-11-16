import { useQuery } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { api } from "../api/client";
import { PageShell } from "../components/AppShell";
import { ListingGrid, ListingItem } from "../components/ListingItem";
import { EmptyState, Skeleton } from "../components/ui";

export function Saved() {
  const q = useQuery({ queryKey: ["saved"], queryFn: api.saved, staleTime: 0 });
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
        <EmptyState icon={<Bookmark size={24} />} title="Nothing saved yet">
          Tap the bookmark on a listing to keep it here. You'll get an alert if its price drops.
        </EmptyState>
      )}
      <ListingGrid>
        {q.data?.map((item, i) => <ListingItem key={item.id} item={item} index={i} showBought />)}
      </ListingGrid>
    </PageShell>
  );
}
