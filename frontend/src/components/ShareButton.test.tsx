import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BuyLink } from "../api/types";
import { ShareButton, shareTargets } from "./ShareButton";

const link = (source: BuyLink["source"], url: string): BuyLink =>
  ({ source, url, price_gbp: "10", size: null });

describe("ShareButton", () => {
  it("gives each marketplace link of a grouped listing its own share action", () => {
    const targets = shareTargets([
      link("vinted", "https://www.vinted.co.uk/items/1"),
      link("ebay", "https://www.ebay.co.uk/itm/2"),
    ]);
    expect(targets).toEqual([
      { label: "Share Vinted link", url: "https://www.vinted.co.uk/items/1" },
      { label: "Share eBay link", url: "https://www.ebay.co.uk/itm/2" },
    ]);
  });

  it("is a single labelled button for one link", () => {
    const html = renderToStaticMarkup(<ShareButton links={[link("grailed", "https://www.grailed.com/listings/3")]} title="t" />);
    expect(html).toContain('aria-label="Share Grailed link"');
    expect(html).not.toContain("aria-expanded");
  });

  it("opens a menu when there are several links", () => {
    const html = renderToStaticMarkup(
      <ShareButton links={[link("vinted", "https://a.test/1"), link("ebay", "https://b.test/2")]} title="t" />,
    );
    expect(html).toContain('aria-label="Share"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("renders nothing without links", () => {
    expect(renderToStaticMarkup(<ShareButton links={[]} title="t" />)).toBe("");
  });
});
