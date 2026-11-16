// Magic UI "Magic Card" (https://magicui.design/docs/components/magic-card), MIT.
// Adapted: gradient mode only, monochrome + accent colours from the theme tokens.
import { motion, useMotionTemplate, useMotionValue } from "motion/react";
import { useCallback, useEffect } from "react";
import { cn } from "../../lib/utils";

interface MagicCardProps {
  children?: React.ReactNode;
  className?: string;
  gradientSize?: number;
  gradientColor?: string;
  gradientOpacity?: number;
  gradientFrom?: string;
  gradientTo?: string;
}

export function MagicCard({
  children,
  className,
  gradientSize = 220,
  gradientColor = "var(--fill-strong)",
  gradientOpacity = 0.8,
  gradientFrom = "var(--accent)",
  gradientTo = "var(--foreground)",
}: MagicCardProps) {
  const mouseX = useMotionValue(-gradientSize);
  const mouseY = useMotionValue(-gradientSize);

  const reset = useCallback(() => {
    mouseX.set(-gradientSize);
    mouseY.set(-gradientSize);
  }, [mouseX, mouseY, gradientSize]);

  const onMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      mouseX.set(e.clientX - r.left);
      mouseY.set(e.clientY - r.top);
    },
    [mouseX, mouseY],
  );

  useEffect(() => {
    reset();
  }, [reset]);

  return (
    <motion.div
      className={cn("group relative isolate overflow-hidden rounded-[inherit] border border-transparent", className)}
      onPointerMove={onMove}
      onPointerLeave={reset}
      style={{
        background: useMotionTemplate`
          linear-gradient(var(--surface) 0 0) padding-box,
          radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px, ${gradientFrom}, ${gradientTo}, var(--border) 100%) border-box
        `,
      }}
    >
      <div className="absolute inset-px z-20 rounded-[inherit] bg-surface" />
      <motion.div
        className="pointer-events-none absolute inset-px z-30 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: useMotionTemplate`radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px, ${gradientColor}, transparent 100%)`,
          opacity: gradientOpacity,
        }}
      />
      <div className="relative z-40">{children}</div>
    </motion.div>
  );
}
