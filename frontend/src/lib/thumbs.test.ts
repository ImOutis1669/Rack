import { describe, expect, it } from "vitest";

import { listingTileImage, thumbSet, TILE_SIZES } from "./thumbs";

describe("thumbnails", () => {
  it("offers 480 and 960 px versions", () => {
    expect(thumbSet("/api/img/12")).toEqual({
      src: "/api/img/12?w=480",
      srcSet: "/api/img/12?w=480 480w, /api/img/12?w=960 960w",
      sizes: TILE_SIZES,
    });
  });

  it("uses the thumbnail for listing tiles, the original only without an id", () => {
    expect(listingTileImage({ images: ["https://i.ebayimg.com/a.jpg"], image_ids: [7] })?.src).toBe("/api/img/7?w=480");
    expect(listingTileImage({ images: ["https://i.ebayimg.com/a.jpg"] })).toEqual({ src: "https://i.ebayimg.com/a.jpg" });
    expect(listingTileImage({ images: [], image_ids: [] })).toBeNull();
  });
});
