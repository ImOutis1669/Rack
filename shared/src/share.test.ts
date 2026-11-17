import { describe, expect, it, vi } from "vitest";

import { shareLink, shareMessage } from "./share";

const URL_ = "https://www.vinted.co.uk/items/123-jeans";

function abort(): Error {
  const e = new Error("cancelled");
  e.name = "AbortError";
  return e;
}

describe("shareLink", () => {
  it("opens the share sheet with the marketplace url and title", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    expect(await shareLink(URL_, "Vetements jeans", { share, writeText })).toBe("shared");
    expect(share).toHaveBeenCalledWith({ url: URL_, title: "Vetements jeans" });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("does nothing when the share sheet is dismissed", async () => {
    const writeText = vi.fn();
    const share = vi.fn().mockRejectedValue(abort());
    expect(await shareLink(URL_, "t", { share, writeText })).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies when sharing fails for another reason", async () => {
    const err = new Error("nope");
    err.name = "NotAllowedError";
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareLink(URL_, "t", { share: vi.fn().mockRejectedValue(err), writeText })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(URL_);
  });

  it("copies when there is no share sheet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareLink(URL_, "t", { writeText })).toBe("copied");
  });

  it("fails when copying fails or isn't available", async () => {
    expect(await shareLink(URL_, "t", { writeText: vi.fn().mockRejectedValue(new Error("x")) })).toBe("failed");
    expect(await shareLink(URL_, "t", {})).toBe("failed");
  });

  it("refuses non-http urls", async () => {
    const share = vi.fn();
    expect(await shareLink("javascript:alert(1)", "t", { share })).toBe("failed");
    expect(share).not.toHaveBeenCalled();
  });
});

describe("shareMessage", () => {
  it("only toasts copies and failures", () => {
    expect(shareMessage("copied")).toBe("Link copied");
    expect(shareMessage("failed")).toBe("Couldn't copy the link");
    expect(shareMessage("shared")).toBeNull();
    expect(shareMessage("cancelled")).toBeNull();
  });
});
