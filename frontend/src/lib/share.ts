import { shareLink as shareWith, type ShareEnv, type ShareResult } from "@rack/shared/share";

export { shareMessage, type ShareEnv, type ShareResult } from "@rack/shared/share";

/** The browser's share sheet and clipboard, where they exist. */
export function browserShareEnv(): ShareEnv {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    share: nav && typeof nav.share === "function" ? (d) => nav.share(d) : undefined,
    writeText: nav?.clipboard?.writeText ? (t) => nav.clipboard.writeText(t) : undefined,
  };
}

/** Share a marketplace listing URL with the browser's share sheet, or copy it. */
export function shareLink(url: string, title: string, env: ShareEnv = browserShareEnv()): Promise<ShareResult> {
  return shareWith(url, title, env);
}
