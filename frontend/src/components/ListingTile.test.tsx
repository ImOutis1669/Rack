import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Listing } from "../api/types";
import { ListingTile } from "./ListingTile";
import type { ListingActions } from "./useListingActions";

const item: Listing = {
  id: 1,
  source: "vinted",
  source_id: "1",
  url: "https://www.vinted.co.uk/items/1",
  title: "Rick Owens Geobasket",
  brand: "Rick Owens",
  price: "320",
  currency: "GBP",
  price_gbp: "320",
  shipping_cost_gbp: null,
  size: "UK 9",
  condition: null,
  images: ["https://images1.vinted.net/a.jpg"],
  seller: null,
  listed_at: null,
  first_seen_at: "2026-11-16T10:00:00Z",
  country: "GB",
  score: null,
  why: null,
  category: null,
  measurements: {},
  feedback: null,
  saved: true,
  price_gbp_at_save: "320",
  was_price_gbp: null,
  landed: null,
  buy_links: [],
};

const actions: ListingActions = {
  vote: null,
  saved: true,
  error: null,
  castVote: () => undefined,
  toggleSave: () => undefined,
  hide: () => undefined,
};

describe("ListingTile", () => {
  it("offers 'I bought it' on the Saved page", () => {
    const html = renderToStaticMarkup(
      <ListingTile item={item} actions={actions} index={20} onOpen={() => undefined} onBought={() => undefined} />,
    );
    expect(html).toMatch(/<button[^>]*h-11[^>]*>.*I bought it<\/button>/);
  });

  it("doesn't elsewhere", () => {
    const html = renderToStaticMarkup(<ListingTile item={item} actions={actions} index={20} onOpen={() => undefined} />);
    expect(html).not.toContain("I bought it");
  });
});
