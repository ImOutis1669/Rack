// The owner's licensed font and icons (v2.1). Neue Montreal (personal-use licence) and Basil
// Icons (Craftwork: no sharing the files) aren't in the public bundle: after an owner login the
// app adds the @font-face rules and fetches the icon paths from /api/owner-assets, which only
// answers the owner. Friends, and the login screen, use the system font and lucide.
import { setIconPack, type BasilPack } from "../components/icons/iconPack";

const STYLE_ID = "rack-owner-fonts";
const FONT_URL = "/api/owner-assets/fonts";
const NO_DIGITS = "U+0000-002B, U+002D, U+002F, U+003B-10FFFF";
const FACES: [string, string][] = [
  ["neuemontreal-regular.otf", "400"],
  ["neuemontreal-medium.otf", "500 600"],
  ["neuemontreal-bold.otf", "700 900"],
];

/** "Neue Montreal" for text, plus "Rack Tabular" (the same faces minus digits and , . :, which
 *  fall through to the system font's tabular figures; Neue Montreal v1 has none). */
export function fontFaceCss(base = FONT_URL): string {
  return FACES.flatMap(([file, weight]) => [
    `@font-face{font-family:"Neue Montreal";src:url("${base}/${file}") format("opentype");font-weight:${weight};font-style:normal;font-display:swap}`,
    `@font-face{font-family:"Rack Tabular";src:url("${base}/${file}") format("opentype");font-weight:${weight};font-display:swap;unicode-range:${NO_DIGITS}}`,
  ]).join("\n");
}

// Only <path> elements with these attributes: the markup goes into innerHTML.
const PATH = /^<path(?: (?:d|fill|fill-rule|clip-rule|stroke|stroke-width|stroke-linecap|stroke-linejoin)="[^"<>]*")+\/>$/;

/** The icon pack if every entry is plain path markup, else null (then lucide stays). */
export function validPack(data: unknown): BasilPack | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const out: BasilPack = {};
  for (const [role, v] of Object.entries(data as Record<string, unknown>)) {
    const entry = v as { outline?: unknown; solid?: unknown } | null;
    if (!entry || typeof entry.outline !== "string" || typeof entry.solid !== "string") return null;
    for (const markup of [entry.outline, entry.solid]) {
      const parts = markup.match(/<[^>]*>/g) ?? [];
      if (parts.join("") !== markup || !parts.every((p) => PATH.test(p))) return null;
    }
    out[role] = { outline: entry.outline, solid: entry.solid };
  }
  return out;
}

export async function loadOwnerAssets(fetcher: typeof fetch = fetch): Promise<void> {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = fontFaceCss();
    document.head.appendChild(style);
  }
  try {
    const res = await fetcher("/api/owner-assets/icons.json", { credentials: "same-origin" });
    if (res.ok) setIconPack(validPack(await res.json()) ?? undefined);
  } catch {
    // no icons file: lucide stays
  }
}

/** On log out (or a friend logging in on this browser): back to the system font and lucide. */
export function clearOwnerAssets(): void {
  document.getElementById(STYLE_ID)?.remove();
  setIconPack(undefined);
}
