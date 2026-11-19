import { describe, expect, it } from "vitest";
import { initials, inviteFromHash, isOwner, memberSince, passwordProblem, usernameProblem, vintedImportSummary } from "./account";

describe("account", () => {
  it("makes initials", () => {
    expect(initials("Sam Rivera")).toBe("SR");
    expect(initials("sam")).toBe("S");
    expect(initials("  ana  de la cruz ")).toBe("AC");
    expect(initials("")).toBe("");
  });

  it("says when you joined", () => {
    expect(memberSince("2026-11-17T12:00:00Z")).toBe("Member since November 2026");
    expect(memberSince("nope")).toBe("");
  });

  it("checks passwords and usernames like the server", () => {
    expect(passwordProblem("short")).toMatch(/12/);
    expect(passwordProblem("aaaaaaaaaaaaaa")).toMatch(/guess/);
    expect(passwordProblem("sam-is-the-best-2026", "Sam")).toMatch(/username/);
    expect(passwordProblem("a-very-long-password")).toBe("");
    expect(usernameProblem("Sam.R_2")).toBe("");
    expect(usernameProblem("ab")).not.toBe("");
    expect(usernameProblem("has space")).not.toBe("");
  });

  it("reads the invite code from the link's fragment", () => {
    expect(inviteFromHash("#abc-DEF_123")).toBe("abc-DEF_123");
    expect(inviteFromHash("")).toBe("");
  });

  it("knows the owner", () => {
    expect(isOwner({ role: "owner" })).toBe(true);
    expect(isOwner({ role: "friend" })).toBe(false);
    expect(isOwner(null)).toBe(false);
  });
});

describe("vinted import summary", () => {
  it("says how far it got and what happened to the rest", () => {
    const base = { total: 382, already: 17, skipped: 0 };
    expect(vintedImportSummary({ ...base, running: true, queued: 153, added: 203, missing: 9 })).toBe(
      "212 of 365 fetched from Vinted · 17 already in Rack · 9 no longer on Vinted",
    );
    expect(vintedImportSummary({ ...base, running: false, queued: 0, added: 340, missing: 25, skipped: 2 })).toBe(
      "357 of 382 liked items added · 17 already in Rack · 25 no longer on Vinted · 2 already voted on in Rack",
    );
  });
});
