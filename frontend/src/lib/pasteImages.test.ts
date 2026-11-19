import { describe, expect, it } from "vitest";
import { fitForUpload, imagesFromClipboard, MAX_UPLOAD_BYTES } from "./pasteImages";

const item = (f: File | null, kind = "file") => ({ kind, type: f?.type ?? "text/plain", getAsFile: () => f });
const png = (name = "image.png") => new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });

describe("pasted images", () => {
  it("takes image files off the clipboard and names generic ones", () => {
    const files = imagesFromClipboard({ items: [item(png())] }, 1700000000000);
    expect(files.map((f) => [f.name, f.type])).toEqual([["pasted-1700000000000.png", "image/png"]]);
  });

  it("keeps real file names and numbers several pastes", () => {
    const shoe = new File(["x"], "tabi.jpeg", { type: "image/jpeg" });
    expect(imagesFromClipboard({ items: [item(shoe)] }).map((f) => f.name)).toEqual(["tabi.jpeg"]);
    const two = imagesFromClipboard({ items: [item(png()), item(new File(["y"], "image.jpeg", { type: "image/jpeg" }))] }, 5);
    expect(two.map((f) => f.name)).toEqual(["pasted-5-1.png", "pasted-5-2.jpg"]);
  });

  it("ignores text and non-image files", () => {
    const text = { kind: "string", type: "text/plain", getAsFile: () => null };
    const pdf = new File(["%PDF"], "a.pdf", { type: "application/pdf" });
    expect(imagesFromClipboard({ items: [text, item(pdf)] })).toEqual([]);
    expect(imagesFromClipboard(null)).toEqual([]);
  });

  it("falls back to clipboard files when items have none", () => {
    expect(imagesFromClipboard({ items: [], files: [png("shot.png")] }).map((f) => f.name)).toEqual(["shot.png"]);
  });

  it("leaves photos under the upload limit alone", async () => {
    const f = png("small.png");
    expect(f.size).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(await fitForUpload(f)).toBe(f);
  });
});
