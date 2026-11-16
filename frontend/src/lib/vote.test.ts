import { describe, expect, it } from "vitest";

import { nextVote, voteValue } from "./vote";

describe("nextVote", () => {
  it("sets a vote from nothing", () => {
    expect(nextVote(null, 1)).toBe(1);
    expect(nextVote(null, -1)).toBe(-1);
  });

  it("clears when the active arrow is tapped again", () => {
    expect(nextVote(1, 1)).toBeNull();
    expect(nextVote(-1, -1)).toBeNull();
  });

  it("switches when the other arrow is tapped", () => {
    expect(nextVote(1, -1)).toBe(-1);
    expect(nextVote(-1, 1)).toBe(1);
  });
});

describe("voteValue", () => {
  it("posts 1 / -1 / 0 to the feedback API", () => {
    expect(voteValue(1)).toBe(1);
    expect(voteValue(-1)).toBe(-1);
    expect(voteValue(null)).toBe(0);
  });
});
