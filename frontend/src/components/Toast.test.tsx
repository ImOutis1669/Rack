import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ToastView } from "./Toast";

describe("ToastView", () => {
  it("shows plain messages without a button", () => {
    const html = renderToStaticMarkup(<ToastView msg={{ text: "Link copied" }} />);
    expect(html).toContain("Link copied");
    expect(html).not.toContain("<button");
  });

  it("gives an action a 44px tappable button", () => {
    const html = renderToStaticMarkup(
      <ToastView msg={{ text: "Added to your wardrobe", action: { label: "Undo", onClick: () => undefined } }} />,
    );
    expect(html).toMatch(/<button[^>]*h-11[^>]*>Undo<\/button>/);
    expect(html).toContain("pointer-events-auto");
  });
});
