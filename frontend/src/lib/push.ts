import { api } from "../api/client";

export type PushState = "unsupported" | "insecure" | "needs-install" | "denied" | "off" | "on";

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export async function pushState(): Promise<PushState> {
  if (!window.isSecureContext) return "insecure";
  if (isIos() && !isStandalone()) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

export async function enablePush(): Promise<PushState> {
  const { public_key } = await api.pushKey();
  if (!public_key) throw new Error("Web Push keys aren't set up on the server (run `rack vapid-keys`).");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(public_key),
  });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.pushSubscribe(json);
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint);
    await sub.unsubscribe();
  }
  return "off";
}

export const PUSH_HELP: Record<PushState, string> = {
  unsupported: "This browser doesn't support push notifications.",
  insecure: "Push needs HTTPS: open Rack through your Cloudflare Tunnel address (or localhost).",
  "needs-install": "On iPhone/iPad: Share → Add to Home Screen, open Rack from there, then enable.",
  denied: "Notifications are blocked for this site in your browser settings.",
  off: "Get alerts on this device without ntfy or Telegram.",
  on: "This device receives Rack alerts.",
};
