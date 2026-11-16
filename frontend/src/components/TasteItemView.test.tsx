import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TasteItem } from "../api/types";
import { draftErrors, draftFrom, TasteTile } from "./TasteItemView";

const belt: TasteItem = {
  id: 6,
  kind: "wardrobe",
  text: null,
  note: null,
  name: "Gucci GG Stone Encrusted Belt",
  brand: "Gucci",
  image: "/api/taste/6/image",
  image_url: null,
  embedded: true,
  embed_error: null,
  created_at: "2026-11-16T10:00:00Z",
  purchase_price_gbp: "270.00",
  estimate_gbp: "136.09",
  estimate_count: 15,
  trend: { "30": null, "90": { pct: -10, direction: "down", recent_median: "130", prior_median: "145", recent_sales: 15, prior_sales: 9 }, points: [], sales: 22 },
};

describe("TasteTile", () => {
  it("shows only photo, brand, name and value (plus the trend), with no inputs or buttons inside", () => {
    const html = renderToStaticMarkup(<TasteTile item={belt} onOpen={() => undefined} />);
    expect(html).toContain('src="/api/taste/6/image"');
    expect(html).toContain(">Gucci<");
    expect(html).toContain("Gucci GG Stone Encrusted Belt");
    expect(html).toContain("≈ £136");
    expect(html).toContain("↓ 10%");
    expect(html).not.toMatch(/<input|<textarea|Bought on|Remove/);
    expect(html.match(/<button/g)).toHaveLength(1); // the whole tile is the one button
  });

  it("wishlist tiles have no value", () => {
    const html = renderToStaticMarkup(<TasteTile item={{ ...belt, kind: "wishlist", trend: null }} onOpen={() => undefined} />);
    expect(html).not.toContain("£");
  });
});

describe("edit form", () => {
  it("starts from the item", () => {
    expect(draftFrom(belt)).toMatchObject({ name: "Gucci GG Stone Encrusted Belt", brand: "Gucci", paid: "270", worth: "", date: "" });
    expect(draftFrom({ ...belt, name: null, text: null, note: null }).name).toBe("");
  });

  it("checks prices and the purchase date", () => {
    const ok = draftFrom(belt);
    expect(draftErrors(ok)).toEqual({});
    expect(Object.keys(draftErrors({ ...ok, paid: "abc", worth: "-1" }))).toEqual(["paid", "worth"]);
    expect(draftErrors({ ...ok, date: "2030-01-01" }, "2026-11-16").date).toBe("Pick a date up to today");
    expect(draftErrors({ ...ok, date: "1940-01-01" }, "2026-11-16").date).toBeDefined();
    expect(draftErrors({ ...ok, date: "2026-11-16" }, "2026-11-16")).toEqual({});
  });
});

describe("unnamed items", () => {
  it("show just the photo on the tile", () => {
    const html = renderToStaticMarkup(<TasteTile item={{ ...belt, name: null, brand: null, purchase_price_gbp: null, estimate_gbp: null, trend: null }} onOpen={() => undefined} />);
    expect(html).not.toContain("Untitled");
    expect(html).not.toMatch(/<p/);
  });
});
