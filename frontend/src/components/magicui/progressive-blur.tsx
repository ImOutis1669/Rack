// Magic UI "Progressive Blur" (https://magicui.design/docs/components/progressive-blur), MIT.
// Adapted: fewer layers (cheaper on iPhone); used as the soft scroll-edge effect under glass bars.
import { cn } from "../../lib/utils";

interface ProgressiveBlurProps {
  className?: string;
  height?: string;
  position?: "top" | "bottom";
  blurLevels?: number[];
}

export function ProgressiveBlur({
  className,
  height = "32px",
  position = "top",
  blurLevels = [1, 2, 4, 8, 16],
}: ProgressiveBlurProps) {
  const dir = position === "bottom" ? "to bottom" : "to top";
  const step = 100 / (blurLevels.length + 1);
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-x-0", position === "top" ? "top-full" : "bottom-full", className)}
      style={{ height }}
    >
      {blurLevels.map((b, i) => {
        const start = i * step;
        const mask = `linear-gradient(${dir}, rgba(0,0,0,0) ${start}%, rgba(0,0,0,1) ${start + step}%, rgba(0,0,0,1) ${start + 2 * step}%, rgba(0,0,0,0) ${start + 3 * step}%)`;
        return (
          <div
            key={b}
            className="absolute inset-0"
            style={{
              zIndex: i + 1,
              backdropFilter: `blur(${b}px)`,
              WebkitBackdropFilter: `blur(${b}px)`,
              maskImage: mask,
              WebkitMaskImage: mask,
            }}
          />
        );
      })}
    </div>
  );
}
