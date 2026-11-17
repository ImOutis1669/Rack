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
