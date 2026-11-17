// @ts-expect-error: the app has no Node types; Vitest runs in Node (and blanks CSS imports)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css: string = readFileSync(new URL("../index.css", import.meta.url), "utf8");

// The top bar's glass must keep its title and buttons legible whatever photo scrolls under it
// (v1.2 bug: at 0.6 opacity, tiles showed as a coloured band behind "Rack" on the iPhone).
// Worst case: the blurred backdrop is pure black or pure white. Blur only averages colours, so
// any real photo lies between the two.

const DARK = "@media (prefers-color-scheme: dark) {";
const lightCss = css.slice(0, css.indexOf(DARK));
const darkCss = css.slice(css.indexOf(DARK), css.indexOf("@theme"));

type RGB = [number, number, number];

function token(block: string, name: string): { rgb: RGB; alpha: number } {
  const m = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`--${name} not found`);
  const v = m[1].trim();
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const rgb = v.match(/^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/);
  if (!rgb) throw new Error(`can't parse --${name}: ${v}`);
  return { rgb: [+rgb[1], +rgb[2], +rgb[3]], alpha: rgb[4] ? +rgb[4] : 1 };
}

const over = (top: { rgb: RGB; alpha: number }, back: RGB): RGB =>
  top.rgb.map((c, i) => c * top.alpha + back[i] * (1 - top.alpha)) as RGB;

function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("top bar glass", () => {
  for (const [scheme, block] of [
    ["light", lightCss],
    ["dark", darkCss],
  ] as const) {
    it(`keeps the title at >= 7:1 over any photo (${scheme})`, () => {
      const bar = token(block, "chrome-bar");
      const fg = token(block, "foreground").rgb;
      for (const backdrop of [
        [0, 0, 0],
        [255, 255, 255],
      ] as RGB[]) {
        expect(contrast(fg, over(bar, backdrop))).toBeGreaterThanOrEqual(7);
      }
    });
  }

  it("blurs on a layer behind the content, never on the bar itself (iOS smeared its text)", () => {
    const rule = css.slice(css.indexOf("@utility glass-bar"), css.indexOf("@media (prefers-reduced-transparency"));
    const own = rule.slice(0, rule.indexOf("&::before"));
    expect(own).not.toMatch(/backdrop-filter/);
    expect(own).not.toMatch(/background:/);
    const before = rule.slice(rule.indexOf("&::before"), rule.indexOf("&::after"));
    expect(before).toMatch(/z-index: -1/);
    expect(before).toMatch(/-webkit-backdrop-filter: blur/);
  });

  it("uses the opaque bar material, not the dock's, and a mild saturation", () => {
    const rule = css.slice(css.indexOf("@utility glass-bar"));
    expect(rule).toMatch(/background: var\(--chrome-bar\)/);
    const sat = Number(rule.match(/saturate\((\d+)%\)/)?.[1]);
    expect(sat).toBeLessThanOrEqual(130);
  });
});
