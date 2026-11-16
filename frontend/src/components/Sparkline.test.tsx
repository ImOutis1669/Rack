import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Sparkline } from "./Sparkline";

const p = (end: string, median: string | null, sales: number) => ({ end, median, sales });

describe("Sparkline", () => {
  it("draws monthly medians with the latest month highlighted and a table view", () => {
    const html = renderToStaticMarkup(
      <Sparkline points={[p("2026-09-17", "480.00", 4), p("2026-10-17", null, 1), p("2026-11-16", "520.00", 6)]} />,
    );
    expect(html).toContain('role="img"');
    expect(html.match(/<circle/g)).toHaveLength(2);
    expect(html).toContain("fill-accent");
    expect(html).toContain("£520 median · 30 days to 16 Nov · 6 sales"); // latest month by default
    expect(html).toContain("too few sales");
    expect(html.match(/tabindex="0"/g)).toHaveLength(2); // each month is focusable
  });

  it("renders nothing without data", () => {
    expect(renderToStaticMarkup(<Sparkline points={[p("2026-11-16", null, 0)]} />)).toBe("");
  });
});
