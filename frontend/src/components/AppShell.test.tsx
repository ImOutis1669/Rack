import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { PageShell } from "./AppShell";

function render(path: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <PageShell title="Saved">
        <p>content</p>
      </PageShell>
    </MemoryRouter>,
  );
}

describe("Liquid Glass chrome", () => {
  it("draws the dock as one glass layer with a single active pill", () => {
    const html = render("/saved");
    const dock = html.match(/<div data-testid="dock"[^>]*>/)?.[0] ?? "";
    expect(dock).toContain("glass-chrome");
    expect(dock).not.toMatch(/\bring-1\b|\bglass\b(?!-)/); // no decorated border, no second glass
    expect(html.match(/data-testid="dock-pill"/g)).toHaveLength(1);
    // the pill belongs to the Saved tab
    expect(html).toMatch(/aria-current="page"[^>]*href="\/saved"|href="\/saved"[^>]*aria-current="page"/);
  });

  it("gives the top bar the same glass and no hairline divider", () => {
    const html = render("/");
    expect(html).toMatch(/<header data-scrolled="false" class="glass-bar /);
    expect(html).not.toContain("h-px bg-border");
  });
});

describe("page titles", () => {
  const shell = (desktopTitle?: boolean) =>
    renderToStaticMarkup(
      <MemoryRouter initialEntries={["/"]}>
        <PageShell title="Rack" desktopTitle={desktopTitle}>
          <p>feed</p>
        </PageShell>
      </MemoryRouter>,
    );

  it("leaves out the desktop heading on the feed, so 'Rack' isn't shown twice", () => {
    const html = shell(false);
    expect(html.match(/<h1/g)).toHaveLength(1); // the iPhone title only (md:hidden)
    expect(html).toMatch(/<h1 class="[^"]*md:hidden[^"]*">Rack<\/h1>/);
  });

  it("keeps it on other pages", () => {
    expect(shell().match(/<h1/g)).toHaveLength(2);
  });
});
