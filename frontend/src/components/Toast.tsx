import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

type Listener = (msg: string | null) => void;
const listeners = new Set<Listener>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Short status message above the tab bar, and above open sheets (z-60). Not for errors that need action. */
export function toast(message: string, ms = 4000): void {
  listeners.forEach((l) => l(message));
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => listeners.forEach((l) => l(null)), ms);
}

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
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
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", damping: 30, stiffness: 400 }}
            className="glass max-w-md rounded-full px-4 py-2.5 text-footnote font-medium shadow-lg ring-1 ring-border"
          >
            {msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
