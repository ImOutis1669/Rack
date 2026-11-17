import { describe, expect, it } from "vitest";
import { fontFaceCss, validPack } from "./ownerAssets";

describe("owner assets (v2.1)", () => {
  it("points every face at the owner-only endpoint, never /fonts", () => {
    const css = fontFaceCss();
    expect(css.match(/@font-face/g)).toHaveLength(6); // 3 weights x (text + tabular)
    expect(css).toContain('url("/api/owner-assets/fonts/neuemontreal-bold.otf")');
    expect(css).not.toMatch(/url\("\/fonts\//);
    expect(css).toContain('font-family:"Rack Tabular"');
  });

  it("only accepts plain path markup for icons", () => {
    const ok = { bookmark: { outline: '<path d="M1 1L2 2" fill="currentColor"/>', solid: '<path d="M3 3" fill-rule="evenodd" clip-rule="evenodd" fill="currentColor"/>' } };
    expect(validPack(ok)).toEqual(ok);
    expect(validPack({ x: { outline: '<path d="M1" onload="alert(1)"/>', solid: "" } })).toBeNull();
    expect(validPack({ x: { outline: '<script>alert(1)</script>', solid: "" } })).toBeNull();
    expect(validPack({ x: { outline: '<path d="M1"/>text', solid: "" } })).toBeNull();
    expect(validPack({ x: { outline: '<image href="x"/>', solid: "" } })).toBeNull();
    expect(validPack([])).toBeNull();
    expect(validPack(null)).toBeNull();
  });

  it("the public stylesheet has no Neue Montreal files in it", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/neuemontreal-.*\.otf/);
  });
});
