import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps a text colour next to a custom text size", () => {
    expect(cn("bg-foreground text-background", "h-12 text-body")).toBe("bg-foreground text-background h-12 text-body");
  });
  it("still lets a later size or radius win", () => {
    expect(cn("text-body", "text-footnote")).toBe("text-footnote");
    expect(cn("rounded-photo", "rounded-sheet")).toBe("rounded-sheet");
  });
});
