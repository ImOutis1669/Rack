// Magic UI "Number Ticker" (https://magicui.design/docs/components/number-ticker), MIT.
// Adapted: theme colour inherited, en-GB formatting, re-animates when the value changes.
import { useInView, useMotionValue, useSpring } from "motion/react";
import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/utils";

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number;
  delay?: number;
}

export function NumberTicker({ value, delay = 0, className, ...props }: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { damping: 60, stiffness: 100 });
  const isInView = useInView(ref, { once: true, margin: "0px" });

  useEffect(() => {
    if (!isInView) return;
    const t = setTimeout(() => motionValue.set(value), delay * 1000);
    return () => clearTimeout(t);
  }, [motionValue, isInView, delay, value]);

  useEffect(
    () =>
      spring.on("change", (latest) => {
        if (ref.current) ref.current.textContent = Intl.NumberFormat("en-GB").format(Math.round(latest));
      }),
    [spring],
  );

  return (
    <span ref={ref} className={cn("tabular inline-block", className)} {...props}>
      0
    </span>
  );
}
