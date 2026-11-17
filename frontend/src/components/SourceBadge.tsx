import type { Source } from "@rack/shared/types";
import { SOURCE_LABEL } from "@rack/shared/format";
import { cn } from "../lib/utils";

const DOT: Record<Source, string> = {
  ebay: "bg-ebay",
  vinted: "bg-vinted",
  grailed: "bg-grailed dark:bg-white",
};

/** Small source label; `glass` when it floats over a photo. */
export function SourceBadge({ source, glass, className }: { source: Source; glass?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-caption font-semibold",
        glass ? "glass text-foreground" : "bg-fill text-foreground",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT[source])} />
      {SOURCE_LABEL[source] ?? source}
    </span>
  );
}
