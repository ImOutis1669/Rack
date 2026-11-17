import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AppTabs, PageShell } from "./AppShell";

const css: string = readFileSync(new URL("../index.css", import.meta.url), "utf8");

function render(path: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <PageShell title="Saved">
        <p>content</p>
      </PageShell>
    </MemoryRouter>,
  );
}

function renderTabs(path: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppTabs />
    </MemoryRouter>,
  );
}

describe("tab chrome lives at app level (so the pill slides between pages)", () => {
  it("pages don't draw the dock or the desktop tabs themselves", () => {
    const html = render("/saved");
    expect(html).not.toContain('data-testid="dock"');
    expect(html).not.toContain('data-testid="desktop-tabs"');
  });

  it("AppTabs draws both, each with one pill on the current tab", () => {
    const html = renderTabs("/hunts");
    expect(html.match(/data-testid="dock-pill"/g)).toHaveLength(1);
    expect(html.match(/<nav[^>]*data-testid="desktop-tabs"[^>]*class="[^"]*\bfixed\b/g)).toHaveLength(1);
  });

  it("shows no pill on pages outside the tabs (Settings)", () => {
    expect(renderTabs("/settings")).not.toContain("dock-pill");
  });
});

describe("Liquid Glass chrome", () => {
  it("draws the dock as one glass layer with a single active pill", () => {
    const html = renderTabs("/saved");
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

  it("draws the iPhone title big and bold in the 56px bar row, with no fake-weight effect", () => {
    const html = shell(false);
    const h1 = html.match(/<h1 class="([^"]*)">Rack<\/h1>/)?.[1] ?? "";
    expect(h1.split(" ")).toEqual(expect.arrayContaining(["text-pagetitle", "font-bold", "truncate"]));
    expect(h1).not.toMatch(/\bheavy\b/); // iOS drew its text-shadow copies as a blurry halo
    expect(css).not.toMatch(/@utility heavy|-webkit-text-stroke/);
    expect(html).toMatch(/class="[^"]*\bh-14\b/);
  });
});
