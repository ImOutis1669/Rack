// Account display rules both apps share (v2.1 Profile).
import type { Account } from "./types";

/** Up to two letters for the placeholder avatar: "Sam Rivera" -> "SR", "sam" -> "S". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return letters
    .map((w) => Array.from(w)[0] ?? "")
    .join("")
    .toUpperCase();
}

/** "Member since November 2026" */
export function memberSince(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return `Member since ${d.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`;
}

/** Same rules as the server: at least 12 characters, not the username. "" when fine. */
export function passwordProblem(password: string, username = ""): string {
  if (password.length < 12) return "Use at least 12 characters";
  if (password.length > 256) return "Use at most 256 characters";
  if (new Set(password).size < 4) return "That password is too easy to guess";
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    return "Don't put your username in your password";
  }
  return "";
}

/** Usernames: 3-24 of a-z 0-9 _ . (stored lowercase). "" when fine. */
export function usernameProblem(raw: string): string {
  const u = raw.trim().toLowerCase();
  if (!/^[a-z0-9_.]{3,24}$/.test(u)) return "3-24 characters: letters, numbers, _ and .";
  return "";
}

/** The invite code from a `/join#<code>` link (the code never reaches the server's logs). */
export function inviteFromHash(hash: string): string {
  return decodeURIComponent(hash.replace(/^#/, "")).trim();
}

export const isOwner = (a: Pick<Account, "role"> | null | undefined): boolean => a?.role === "owner";

/** One line on a Vinted likes import ("212 of 365 added · 9 no longer on Vinted"). */
export function vintedImportSummary(s: {
  running: boolean;
  total: number;
  queued: number;
  added: number;
  already: number;
  skipped: number;
  missing: number;
}): string {
  const toFetch = s.added + s.missing + s.queued;
  const parts = [
    s.running ? `${s.added + s.missing} of ${toFetch} fetched from Vinted` : `${s.added + s.already} of ${s.total} liked items added`,
  ];
  if (s.already) parts.push(`${s.already} already in Rack`);
  if (s.missing) parts.push(`${s.missing} no longer on Vinted`);
  if (s.skipped) parts.push(`${s.skipped} already voted on in Rack`);
  return parts.join(" · ");
}
