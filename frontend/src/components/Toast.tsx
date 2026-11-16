import { AnimatePresence, m } from "motion/react";
import { useEffect, useState } from "react";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastMessage {
  text: string;
  action?: ToastAction;
}

type Listener = (msg: ToastMessage | null) => void;
const listeners = new Set<Listener>();
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Short status message above the tab bar, and above open sheets (z-60). Not for errors that need
 * action. An optional action (e.g. Undo) gets a 44px button and more time on screen.
 */
export function toast(message: string, ms?: number | { action?: ToastAction; ms?: number }): void {
  const opts = typeof ms === "number" ? { ms } : (ms ?? {});
  const msg: ToastMessage = { text: message, action: opts.action };
  listeners.forEach((l) => l(msg));
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => listeners.forEach((l) => l(null)), opts.ms ?? (opts.action ? 6000 : 4000));
}

export function dismissToast(): void {
  if (timer) clearTimeout(timer);
  listeners.forEach((l) => l(null));
}

export function ToastView({ msg }: { msg: ToastMessage }) {
  return (
    <div
      role="status"
      className="glass flex max-w-md items-center gap-1 rounded-full py-1 pr-1 pl-4 text-footnote font-medium shadow-lg ring-1 ring-border"
    >
      <span className="py-1.5 pr-3">{msg.text}</span>
      {msg.action && (
        <button
          type="button"
          onClick={() => {
            dismissToast();
            msg.action?.onClick();
          }}
          className="press pointer-events-auto h-11 rounded-full px-4 font-semibold text-accent hover:bg-fill"
        >
          {msg.action.label}
        </button>
      )}
    </div>
  );
}

export function Toaster() {
  const [msg, setMsg] = useState<ToastMessage | null>(null);
  useEffect(() => {
    listeners.add(setMsg);
    return () => {
      listeners.delete(setMsg);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+96px)] z-[60] flex justify-center px-4 md:bottom-8">
      <AnimatePresence>
        {msg && (
          <m.div
            key={msg.text}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", damping: 30, stiffness: 400 }}
          >
            <ToastView msg={msg} />
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
