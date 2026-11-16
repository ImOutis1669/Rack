import { safeHref } from "./safe";

export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

/** The browser APIs used, injectable for tests. */
export interface ShareEnv {
  share?: (data: { url: string; title?: string }) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
}

export function browserShareEnv(): ShareEnv {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    share: nav && typeof nav.share === "function" ? (d) => nav.share(d) : undefined,
    writeText: nav?.clipboard?.writeText ? (t) => nav.clipboard.writeText(t) : undefined,
  };
}

/**
 * Share a marketplace listing URL (never Rack's own): the native share sheet where there is one
 * (iOS), otherwise copy to the clipboard. Closing the share sheet is not an error.
 */
export async function shareLink(url: string, title: string, env: ShareEnv = browserShareEnv()): Promise<ShareResult> {
  const href = safeHref(url);
  if (!href) return "failed";
  if (env.share) {
    try {
      await env.share({ url: href, title });
      return "shared";
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return "cancelled";
      // e.g. NotAllowedError: fall through to copying
    }
  }
  if (!env.writeText) return "failed";
  try {
    await env.writeText(href);
    return "copied";
  } catch {
    return "failed";
  }
}

/** Toast text for a result (null: say nothing). */
export function shareMessage(result: ShareResult): string | null {
  if (result === "copied") return "Link copied";
  if (result === "failed") return "Couldn't copy the link";
  return null;
}
