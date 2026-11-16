import { describe, expect, it } from "vitest";

import { FEED_TITLE } from "./Feed";

describe("feed title", () => {
  it("is the app name, whatever the sort", () => {
    expect(FEED_TITLE).toBe("Rack");
  });
});
