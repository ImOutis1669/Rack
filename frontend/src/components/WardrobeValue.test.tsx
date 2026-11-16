import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TasteItem } from "../api/types";
import { WardrobeSummary } from "./WardrobeValue";

const item = (paid: string | null, value: string | null): TasteItem => ({
  id: Math.random(),
  kind: "wardrobe",
  text: null,
  note: null,
  image: null,
  image_url: null,
  embedded: true,
  embed_error: null,
  created_at: "2026-11-16T10:00:00Z",
  purchase_price_gbp: paid,
  custom_value_gbp: value,
});

describe("WardrobeSummary", () => {
  it("asks for prices when there are none", () => {
    const html = renderToStaticMarkup(<WardrobeSummary items={[item(null, null)]} />);
    expect(html).toContain("Add what you paid");
    expect(html).not.toContain("Worth now");
  });

  it("shows paid, worth now, a green change and the coverage", () => {
    const html = renderToStaticMarkup(<WardrobeSummary items={[item("500", "600"), item("440", null), item(null, null)]} />);
    expect(html).toContain("Paid");
    expect(html).toContain("Worth now");
    expect(html).toMatch(/text-accent[^>]*>\+£100 \(\+11%\)/);
    expect(html).toContain("1 valued by you · 1 counted at what you paid · 1 without a price");
  });

  it("shows a fall in red", () => {
    const html = renderToStaticMarkup(<WardrobeSummary items={[item("100", "70")]} />);
    expect(html).toMatch(/text-danger[^>]*>−£30 \(−30%\)/);
  });
});
