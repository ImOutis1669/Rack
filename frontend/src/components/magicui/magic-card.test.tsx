import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MagicCard } from "./magic-card";

describe("MagicCard", () => {
  it("gradient mode draws the hover spotlight and no orb", () => {
    const html = renderToStaticMarkup(<MagicCard>Hi</MagicCard>);
    expect(html).toContain("Hi");
    expect(html).toContain("group-hover:opacity-100");
    expect(html).not.toContain("magic-card-orb");
  });

  it("orb mode draws a hidden, theme-coloured orb instead of the spotlight", () => {
    const html = renderToStaticMarkup(<MagicCard mode="orb">Hi</MagicCard>);
    expect(html).toContain('data-testid="magic-card-orb"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("var(--glow-from)");
    expect(html).toContain("var(--glow-to)");
    expect(html).not.toContain("group-hover:opacity-100");
  });

  it("uses the surface and border tokens, never hard-coded colours", () => {
    const html = renderToStaticMarkup(<MagicCard mode="orb">Hi</MagicCard>);
    expect(html).toContain("bg-surface");
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
