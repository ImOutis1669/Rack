import type { Source } from "../api/types";
import { SOURCE_LABEL } from "../lib/format";

const STYLE: Record<Source, string> = {
  ebay: "bg-ebay text-white",
  vinted: "bg-vinted text-white",
  grailed: "bg-grailed text-black",
  vestiaire: "bg-vestiaire text-black",
};

export function SourceBadge({ source }: { source: Source }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STYLE[source]}`}>
      {SOURCE_LABEL[source] ?? source}
    </span>
  );
}
