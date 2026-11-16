// Magic UI "Animated Shiny Text" (https://magicui.design/docs/components/animated-shiny-text), MIT.
// Adapted: theme tokens.
import type { ComponentPropsWithoutRef, CSSProperties, FC } from "react";
import { cn } from "../../lib/utils";

interface Props extends ComponentPropsWithoutRef<"span"> {
  shimmerWidth?: number;
}

export const AnimatedShinyText: FC<Props> = ({ children, className, shimmerWidth = 100, ...props }) => (
  <span
    style={{ "--shiny-width": `${shimmerWidth}px` } as CSSProperties}
    className={cn(
      "text-muted",
      "animate-shiny-text bg-size-[var(--shiny-width)_100%] bg-clip-text bg-position-[0_0] bg-no-repeat",
      "bg-linear-to-r from-transparent via-foreground/80 via-50% to-transparent",
      className,
    )}
    {...props}
  >
    {children}
  </span>
);
