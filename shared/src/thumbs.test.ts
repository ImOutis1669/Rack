import { describe, expect, it } from "vitest";

import { listingTileImage, shortHash, THUMB_VERSION, thumbSet, TILE_SIZES } from "./thumbs";

describe("thumbnails", () => {
  it("offers 480, 640 and 960 px versions, versioned for the browser cache", () => {
    const v = `v=${THUMB_VERSION}`;
    expect(thumbSet("/api/img/12")).toEqual({
      src: `/api/img/12?w=480&${v}`,
      srcSet: `/api/img/12?w=480&${v} 480w, /api/img/12?w=640&${v} 640w, /api/img/12?w=960&${v} 960w`,
      sizes: TILE_SIZES,
    });
  });

  it("uses the thumbnail for listing tiles, the original only without an id", () => {
    expect(listingTileImage({ images: ["https://i.ebayimg.com/a.jpg"], image_ids: [7] })?.src).toMatch(/^\/api\/img\/7\?w=480&v=/);
    expect(listingTileImage({ images: ["https://i.ebayimg.com/a.jpg"] })).toEqual({ src: "https://i.ebayimg.com/a.jpg" });
    expect(listingTileImage({ images: [], image_ids: [] })).toBeNull();
  });

  it("changes the tile URL when the photo behind the same id changes (eBay s-l225 -> s-l1600)", () => {
    const before = listingTileImage({ images: ["https://i.ebayimg.com/images/g/a/s-l225.jpg"], image_ids: [7] });
    const after = listingTileImage({ images: ["https://i.ebayimg.com/images/g/a/s-l1600.jpg"], image_ids: [7] });
    expect(before?.src).not.toBe(after?.src);
    expect(shortHash("x")).toBe(shortHash("x"));
  });
});

describe("single thumbnails (iOS app)", () => {
  it("builds the same URL as the web's srcset", async () => {
    const { listingThumb, thumbUrl } = await import("./thumbs");
    const set = thumbSet("/api/img/7", "https://i.ebayimg.com/x/s-l1600.jpg");
    expect(set.srcSet).toContain(`${thumbUrl("/api/img/7", 640, "https://i.ebayimg.com/x/s-l1600.jpg")} 640w`);
    expect(listingThumb({ images: ["https://a/1.jpg"], image_ids: [7] }, 960)).toBe(thumbUrl("/api/img/7", 960, "https://a/1.jpg"));
    expect(listingThumb({ images: ["https://a/1.jpg"] }, 480)).toBe("https://a/1.jpg");
    expect(listingThumb({ images: [] }, 480)).toBeNull();
  });

  it("picks the smallest width that covers the tile", async () => {
    const { thumbWidthFor } = await import("./thumbs");
    expect(thumbWidthFor(400)).toBe(480);
    expect(thumbWidthFor(549)).toBe(640); // 183 pt x 3
    expect(thumbWidthFor(700)).toBe(960);
    expect(thumbWidthFor(2000)).toBe(960);
  });
});
