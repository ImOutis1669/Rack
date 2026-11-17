/** Length input helpers: settings accept "86", "86cm", "34in", "34\"" or "2'10\"". Stored in cm. */

const CM_PER_IN = 2.54;

export function parseLengthCm(input: string, defaultUnit: "cm" | "in" = "cm"): number | null {
  const s = input.trim().toLowerCase().replace(/,/g, ".");
  if (!s) return null;
  const feet = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)\s*(\d+(?:\.\d+)?)?\s*(?:"|in)?$/);
  if (feet) {
    return round1((Number(feet[1]) * 12 + Number(feet[2] ?? 0)) * CM_PER_IN);
  }
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(cm|in|inch|inches|"|”)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ? (m[2] === "cm" ? "cm" : "in") : defaultUnit;
  return round1(unit === "cm" ? n : n * CM_PER_IN);
}

export function formatLength(cm: number | null | undefined, unit: "cm" | "in"): string {
  if (cm == null) return "";
  return unit === "cm" ? `${round1(cm)}` : `${round1(cm / CM_PER_IN)}`;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Comma list <-> array, trimmed, empties dropped. */
export function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}
