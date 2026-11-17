// Magic Card from Magic UI by Dillion Verma
// Copyright (c) Magic UI. Licensed under MIT: https://github.com/magicuidesign/magicui/blob/main/LICENSE.md
// Source: https://github.com/magicuidesign/magicui (d7207e5), via craftwork.design
//
// Adapted for Rack (behaviour unchanged, styling from the theme tokens):
// - `m.*` elements, because Motion runs under LazyMotion (strict) in main.tsx;
// - colours default to tokens in index.css (--accent, --foreground, --fill-strong, --glow-*);
//   the card face is --surface, the resting border --border;
// - dark mode follows the system like the rest of the app (prefers-color-scheme), so no
//   next-themes; with reduced motion the orb tracks the pointer without the trailing spring.
import { m, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { cn } from "../../lib/utils";

interface MagicCardBaseProps {
  children?: React.ReactNode;
  className?: string;
  gradientSize?: number;
  gradientFrom?: string;
  gradientTo?: string;
}

interface MagicCardGradientProps extends MagicCardBaseProps {
  mode?: "gradient";
  gradientColor?: string;
  gradientOpacity?: number;
  glowFrom?: never;
  glowTo?: never;
  glowAngle?: never;
  glowSize?: never;
  glowBlur?: never;
  glowOpacity?: never;
}

interface MagicCardOrbProps extends MagicCardBaseProps {
  mode: "orb";
  glowFrom?: string;
  glowTo?: string;
  glowAngle?: number;
  glowSize?: number;
  glowBlur?: number;
  glowOpacity?: number;
  gradientColor?: never;
  gradientOpacity?: never;
}

export type MagicCardProps = MagicCardGradientProps | MagicCardOrbProps;
type ResetReason = "enter" | "leave" | "global" | "init";

function isOrbMode(props: MagicCardProps): props is MagicCardOrbProps {
  return props.mode === "orb";
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeScheme(onChange: () => void): () => void {
  const mq = window.matchMedia?.(DARK_QUERY);
  mq?.addEventListener("change", onChange);
  return () => mq?.removeEventListener("change", onChange);
}

/** The system colour scheme, which is what the app's dark mode follows. */
export function useSystemDark(): boolean {
  return useSyncExternalStore(
    subscribeScheme,
    () => window.matchMedia?.(DARK_QUERY).matches ?? false,
    () => true,
  );
}

export function MagicCard(props: MagicCardProps) {
  const {
    children,
    className,
    gradientSize = 200,
    gradientColor = "var(--fill-strong)",
    gradientOpacity = 0.8,
    gradientFrom = "var(--accent)",
    gradientTo = "var(--foreground)",
    mode = "gradient",
  } = props;

  const orb = isOrbMode(props) ? props : undefined;
  const glowFrom = orb?.glowFrom ?? "var(--glow-from)";
  const glowTo = orb?.glowTo ?? "var(--glow-to)";
  const glowAngle = orb?.glowAngle ?? 90;
  const glowSize = orb?.glowSize ?? 420;
  const glowBlur = orb?.glowBlur ?? 60;
  const glowOpacity = orb?.glowOpacity ?? 0.9;

  const isDark = useSystemDark();
  const reduced = useReducedMotion();

  const mouseX = useMotionValue(-gradientSize);
  const mouseY = useMotionValue(-gradientSize);

  const springX = useSpring(mouseX, { stiffness: 250, damping: 30, mass: 0.6 });
  const springY = useSpring(mouseY, { stiffness: 250, damping: 30, mass: 0.6 });
  const orbVisible = useSpring(0, { stiffness: 300, damping: 35 });

  const modeRef = useRef(mode);
  const glowOpacityRef = useRef(glowOpacity);
  const gradientSizeRef = useRef(gradientSize);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    glowOpacityRef.current = glowOpacity;
  }, [glowOpacity]);

  useEffect(() => {
    gradientSizeRef.current = gradientSize;
  }, [gradientSize]);

  const reset = useCallback(
    (reason: ResetReason = "leave") => {
      if (modeRef.current === "orb") {
        if (reason === "enter") orbVisible.set(glowOpacityRef.current);
        else orbVisible.set(0);
        return;
      }
      const off = -gradientSizeRef.current;
      mouseX.set(off);
      mouseY.set(off);
    },
    [mouseX, mouseY, orbVisible],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      mouseX.set(e.clientX - rect.left);
      mouseY.set(e.clientY - rect.top);
    },
    [mouseX, mouseY],
  );

  useEffect(() => {
    reset("init");
  }, [reset]);

  useEffect(() => {
    const handleGlobalPointerOut = (e: PointerEvent) => {
      if (!e.relatedTarget) reset("global");
    };
    const handleBlur = () => reset("global");
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") reset("global");
    };

    window.addEventListener("pointerout", handleGlobalPointerOut);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("pointerout", handleGlobalPointerOut);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [reset]);

  const borderBackground = useMotionTemplate`
    linear-gradient(var(--surface) 0 0) padding-box,
    radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px,
      ${gradientFrom},
      ${gradientTo},
      var(--border) 100%
    ) border-box
  `;
  const spotlight = useMotionTemplate`
    radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px,
      ${gradientColor},
      transparent 100%
    )
  `;

  return (
    <m.div
      className={cn(
        "group relative isolate overflow-hidden rounded-[inherit] border border-transparent",
        className,
      )}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => reset("leave")}
      onPointerEnter={() => reset("enter")}
      style={{ background: borderBackground }}
    >
      <div className="absolute inset-px z-20 rounded-[inherit] bg-surface" />

      {mode === "gradient" && (
        <m.div
          className="pointer-events-none absolute inset-px z-30 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: spotlight, opacity: gradientOpacity }}
        />
      )}

      {mode === "orb" && (
        <m.div
          aria-hidden="true"
          data-testid="magic-card-orb"
          className="pointer-events-none absolute top-0 left-0 z-30"
          style={{
            width: glowSize,
            height: glowSize,
            x: reduced ? mouseX : springX,
            y: reduced ? mouseY : springY,
            translateX: "-50%",
            translateY: "-50%",
            borderRadius: 9999,
            filter: `blur(${glowBlur}px)`,
            opacity: orbVisible,
            background: `linear-gradient(${glowAngle}deg, ${glowFrom}, ${glowTo})`,
            mixBlendMode: isDark ? "screen" : "multiply",
            willChange: "transform, opacity",
          }}
        />
      )}
      <div className="relative z-40">{children}</div>
    </m.div>
  );
}
