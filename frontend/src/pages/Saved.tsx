import { useQuery } from "@tanstack/react-query";
import { ListingCard } from "../components/ListingCard";
import { PageShell } from "../components/Nav";
import { api } from "../api/client";

export function Saved({ onLogout }: { onLogout: () => void }) {
  const q = useQuery({ queryKey: ["saved"], queryFn: api.saved, staleTime: 0 });
  return (
    <PageShell onLogout={onLogout}>
      <h2 className="mt-3 text-sm font-semibold">Saved</h2>
      {q.isSuccess && q.data.length === 0 && (
        <p className="mt-6 text-sm text-neutral-400">Nothing saved yet. Tap ☆ on a listing to keep it here.</p>
      )}
      <div className="mt-2 columns-2 gap-3 sm:columns-3 lg:columns-4">
        {q.data?.map((item) => <ListingCard key={item.id} item={item} />)}
      </div>
    </PageShell>
  );
}
