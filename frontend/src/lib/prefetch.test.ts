import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { api } from "../api/client";
import { prefetchForOpen, prefetchOnView } from "./prefetch";

describe("prefetch", () => {
  it("never prefetches Vinted details just because a tile scrolled past", () => {
    expect(prefetchOnView("vinted")).toBe(false);
    for (const s of ["ebay", "grailed"]) expect(prefetchOnView(s)).toBe(true);
  });

  it("on touch, loads the details once and the full-size photo", async () => {
    const gallery = vi.spyOn(api, "gallery").mockResolvedValue({ images: [], description: null, photo_count: null, note: null } as never);
    const qc = new QueryClient();
    const preload = vi.fn();
    prefetchForOpen(qc, { id: 5, images: ["https://images1.vinted.net/full.jpg"] }, preload);
    prefetchForOpen(qc, { id: 5, images: ["https://images1.vinted.net/full.jpg"] }, preload);
    await vi.waitFor(() => expect(qc.getQueryData(["gallery", 5])).toBeDefined());
    expect(gallery).toHaveBeenCalledTimes(1); // the second touch reuses it
    expect(preload).toHaveBeenCalledWith("https://images1.vinted.net/full.jpg");
    gallery.mockRestore();
  });
});
