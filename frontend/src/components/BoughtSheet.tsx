import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Listing } from "@rack/shared/types";
import { defaultPrice, parsePrice } from "@rack/shared/bought";
import { toast } from "./Toast";
import { Button, Field, Input, Sheet } from "./ui";

/** "I bought it": confirm the price paid, then move the listing from Saved into the wardrobe. */
export function BoughtSheet({
  item,
  open,
  onClose,
  onDone,
}: {
  item: Listing;
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [price, setPrice] = useState(() => defaultPrice(item.price_gbp));
  useEffect(() => {
    if (open) setPrice(defaultPrice(item.price_gbp));
  }, [open, item.price_gbp]);
  const parsed = parsePrice(price);

  const refresh = () => {
    for (const key of ["saved", "taste", "feed"]) void qc.invalidateQueries({ queryKey: [key] });
  };
  const undo = useMutation({
    mutationFn: (tasteId: number) => api.undoBought(tasteId),
    onSuccess: (r) => {
      refresh();
      toast(r.restored_to_saved ? "Back in Saved" : "Removed from your wardrobe. The listing is gone, so it couldn't go back to Saved.");
    },
    onError: (e) => toast(String((e as Error).message)),
  });
  const buy = useMutation({
    mutationFn: () => api.bought(item.id, parsed!),
    onSuccess: (added) => {
      onClose();
      onDone?.();
      refresh();
      toast("Added to your wardrobe", { action: { label: "Undo", onClick: () => undo.mutate(added.id) } });
    },
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="I bought it"
      footer={
        <Button variant="primary" size="lg" className="w-full" disabled={!parsed || buy.isPending} onClick={() => buy.mutate()}>
          Add to wardrobe
        </Button>
      }
    >
      <form
        className="space-y-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed) buy.mutate();
        }}
      >
        <p className="text-footnote text-muted">
          {item.title}. Adds it to your wardrobe so it shapes your feed, and stops price alerts.
        </p>
        <Field label="Price paid" hint={parsed || price === "" ? undefined : "Enter a price in pounds, like 180 or 180.50"}>
          {(id) => (
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-body text-muted">£</span>
              <Input
                id={id}
                inputMode="decimal"
                autoComplete="off"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="pl-7 tabular"
                aria-invalid={!parsed}
              />
            </div>
          )}
        </Field>
        {buy.isError && <p className="text-footnote text-danger">{String((buy.error as Error).message)}</p>}
      </form>
    </Sheet>
  );
}
