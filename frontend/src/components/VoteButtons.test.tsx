import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Vote } from "../lib/vote";
import { VoteButtons } from "./VoteButtons";

function render(vote: Vote, compact = false): { up: string; down: string; html: string } {
  const html = renderToStaticMarkup(<VoteButtons vote={vote} onVote={() => undefined} compact={compact} />);
  const buttons = html.match(/<button[\s\S]*?<\/button>/g) ?? [];
  expect(buttons).toHaveLength(2);
  return { up: buttons[0] ?? "", down: buttons[1] ?? "", html };
}

describe("VoteButtons", () => {
  it("labels the arrows and replaces the old thumbs", () => {
    const { up, down, html } = render(null);
    expect(up).toContain('aria-label="Upvote"');
    expect(down).toContain('aria-label="Downvote"');
    expect(html).not.toMatch(/aria-label="(More|Less) like this"|lucide-thumbs/);
    expect(html).toContain("lucide-arrow-big-up");
  });

  it("shows nothing active without a vote", () => {
    const { up, down } = render(null);
    expect(up).toContain('aria-pressed="false"');
    expect(down).toContain('aria-pressed="false"');
    expect(up + down).not.toContain('fill="currentColor"');
  });

  it("fills the upvote in accent green", () => {
    const { up, down } = render(1);
    expect(up).toContain('aria-pressed="true"');
    expect(up).toContain("text-accent");
    expect(up).toContain('fill="currentColor"');
    expect(down).not.toContain('fill="currentColor"');
  });

  it("fills the downvote in danger red", () => {
    const { up, down } = render(-1);
    expect(down).toContain('aria-pressed="true"');
    expect(down).toContain("text-danger");
    expect(down).toContain('fill="currentColor"');
    expect(up).not.toContain("text-accent");
  });

  it("keeps 44px targets, and 36px glass on desktop tiles", () => {
    expect(render(null).up).toContain("size-11");
    const compact = render(null, true);
    expect(compact.up).toContain("size-9");
    expect(compact.html).toContain("glass");
  });
});
