import { describe, expect, it } from "vitest";
import { SHARED_API_VERSION } from "@rack/shared/index";

// Guards the @rack/shared wiring: tsconfig "paths", the Vite alias and the Dockerfile's COPY shared/.
describe("@rack/shared alias", () => {
  it("resolves the shared package", () => {
    expect(SHARED_API_VERSION).toBe(1);
  });
});
