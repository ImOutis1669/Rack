import { describe, expect, it } from "vitest";

import type { TasteItem } from "./types";
import { detailRows, displayName, formatDate, itemName, sourceLink, tileValue } from "./tasteItem";

const base: TasteItem = {
  id: 1,
  kind: "wardrobe",
  text: null,
  note: null,
  image: "/api/taste/1/image",
  image_url: null,
  embedded: true,
  embed_error: null,
  created_at: "2026-11-16T10:00:00Z",
};

describe("tile", () => {
  it("shows your value, else the estimate, else what you paid, else nothing", () => {
    expect(tileValue({ ...base, custom_value_gbp: "300", estimate_gbp: "136.09", purchase_price_gbp: "270" })).toBe("£300");
    expect(tileValue({ ...base, estimate_gbp: "136.09", estimate_count: 15, purchase_price_gbp: "270" })).toBe("≈ £136");
    expect(tileValue({ ...base, purchase_price_gbp: "270" })).toBe("£270");
    expect(tileValue(base)).toBeNull();
    expect(tileValue({ ...base, kind: "wishlist", purchase_price_gbp: "270" })).toBeNull();
  });

  it("names the item from its name, else its description or label", () => {
    expect(displayName({ name: "Gucci GG belt", text: "belt", note: null })).toBe("Gucci GG belt");
    expect(displayName({ name: null, text: "black overcoat", note: null })).toBe("black overcoat");
    expect(itemName({ name: null, text: null, note: null })).toBeNull();
    expect(displayName({ name: null, text: null, note: null })).toBe("Wardrobe item");
  });
});

describe("sheet", () => {
  it("lists only the fields that have a value", () => {
    expect(detailRows(base)).toEqual([]);
    const full = detailRows({
      ...base,
      size: "L",
      effective_category: "outerwear",
      purchase_price_gbp: "184.00",
      custom_value_gbp: "220.00",
      purchase_date: "2026-11-16",
      source: "vinted",
    });
    expect(full.map((r) => `${r.label}: ${r.value}`)).toEqual([
      "Size: L",
      "Category: Outerwear",
      "Paid: £184",
      "Your value: £220",
      "Purchased: 16 Nov 2026",
      "Bought on: Vinted",
    ]);
    expect(detailRows({ ...base, effective_category: "any" })).toEqual([]); // unknown isn't shown
    expect(detailRows({ ...base, category: "shoes", effective_category: "shoes" })[0]).toEqual({ label: "Category", value: "Shoes" });
  });

  it("links to the original listing, or the pasted source", () => {
    expect(sourceLink({ listing_url: "https://www.vinted.co.uk/items/1", image_url: null })).toEqual({
      href: "https://www.vinted.co.uk/items/1",
      label: "View original listing",
    });
    expect(sourceLink({ listing_url: null, image_url: "https://x.test/a.jpg" })?.label).toBe("View source");
    expect(sourceLink({ listing_url: null, image_url: null })).toBeNull();
  });

  it("formats dates without timezone drift", () => {
    expect(formatDate("2026-11-16")).toBe("16 Nov 2026");
    expect(formatDate("2025-01-01")).toBe("1 Jan 2025");
  });
});

describe("edit draft (shared by web and iOS)", () => {
  it("builds the PATCH body: blanks clear, money only for wardrobe items", async () => {
    const { patchFrom } = await import("./tasteItem");
    const d = { name: " Belt ", brand: "", size: "", category: "" as const, paid: "270", worth: "", date: "", note: "" };
    expect(patchFrom(d, "wardrobe")).toEqual({
      name: "Belt",
      brand: null,
      size: null,
      category: null,
      note: null,
      purchase_price_gbp: "270.00",
      custom_value_gbp: null,
      purchase_date: null,
    });
    expect(patchFrom(d, "wishlist")).not.toHaveProperty("purchase_price_gbp");
  });
});
