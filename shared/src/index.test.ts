import { describe, expect, it } from "vitest";
import { SHARED_API_VERSION } from "./index";

describe("@rack/shared", () => {
  it("exports its API version", () => {
    expect(SHARED_API_VERSION).toBe(1);
  });
});
