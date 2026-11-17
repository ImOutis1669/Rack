import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import map from "./basil-map.json";
import { type BasilPack, ICON_NAMES, IconView } from "./Icon";

const PACK: BasilPack = {
  bookmark: { outline: '<path d="M1 1L2 2" fill="currentColor"/>', solid: '<path d="M3 3L4 4" fill="currentColor"/>' },
};

describe("Icon", () => {
  it("falls back to lucide when the user hasn't generated the Basil pack", () => {
    const html = renderToStaticMarkup(<IconView name="bookmark" />);
    expect(html).toContain("lucide-bookmark");
    expect(html).toContain('stroke-width="1.5"'); // Basil's line weight
    expect(html).toContain('aria-hidden="true"');
  });

  it("uses Basil's outline at rest and its solid version when active", () => {
    const rest = renderToStaticMarkup(<IconView name="bookmark" pack={PACK} />);
    const active = renderToStaticMarkup(<IconView name="bookmark" filled pack={PACK} />);
    expect(rest).toContain('d="M1 1L2 2"');
    expect(active).toContain('d="M3 3L4 4"');
    expect(rest).toContain('viewBox="0 0 24 24"');
    expect(rest).not.toContain("lucide");
  });

  it("fills lucide fallbacks that have a solid shape, thickens the rest", () => {
    expect(renderToStaticMarkup(<IconView name="vote-up" filled />)).toContain('fill="currentColor"');
    expect(renderToStaticMarkup(<IconView name="settings" filled />)).toContain('stroke-width="2.1"');
  });

  it("is hidden from screen readers unless it stands alone with a label", () => {
    const html = renderToStaticMarkup(<IconView name="mute" label="Alerts off" pack={PACK} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Alerts off"');
    expect(html).not.toContain("aria-hidden");
  });

  it("maps only roles the app knows, and every role has a lucide fallback", () => {
    const roles = Object.keys(map).filter((k) => !k.startsWith("_"));
    for (const role of roles) expect(ICON_NAMES).toContain(role);
    expect(roles).not.toContain("vote-up"); // Basil's arrows have no filled state
    expect(roles).not.toContain("sort"); // the sort chip keeps v1's lucide icon (user's choice)
  });
});
