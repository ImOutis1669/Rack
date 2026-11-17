// Rack's icons: Basil Icons (Craftwork) when the user has generated them from their own pack
// (scripts/basil-icons.mjs -> basil.generated.ts, git-ignored: the licence forbids sharing the
// files and this repo is public), otherwise lucide. Roles Basil has no icon for always use lucide.
//
// Design language (DESIGN.md "Icons"): outline at rest, solid when active/selected (the iOS
// convention): the current tab, a saved bookmark, a cast vote. Basil's 1.5px line is matched by
// lucide's strokeWidth 1.5, so mixed screens read as one set.
import {
  ArrowBigDown,
  ArrowBigUp,
  ArrowDownWideNarrow,
  BellOff,
  BellRing,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  ExternalLink,
  EyeOff,
  ImagePlus,
  LayoutGrid,
  Link2,
  LogOut,
  type LucideIcon,
  MoreHorizontal,
  PackageCheck,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  RotateCw,
  SearchX,
  Settings,
  Share,
  Shirt,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";

export type BasilPack = Record<string, { outline: string; solid: string }>;

const LUCIDE = {
  bookmark: Bookmark,
  close: X,
  plus: Plus,
  check: Check,
  filters: SlidersHorizontal,
  share: Share,
  settings: Settings,
  search: SearchX,
  refresh: RotateCw,
  edit: Pencil,
  bought: PackageCheck,
  logout: LogOut,
  feed: LayoutGrid,
  "add-photo": ImagePlus,
  hunts: Crosshair,
  "chevron-down": ChevronDown,
  sort: ArrowDownWideNarrow,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  buy: ShoppingBag,
  hide: EyeOff,
  mute: BellOff,
  "alerts-on": BellRing,
  pause: Pause,
  play: Play,
  delete: Trash2,
  // no Basil equivalent (or, for votes, no filled state): always lucide
  "vote-up": ArrowBigUp,
  "vote-down": ArrowBigDown,
  more: MoreHorizontal,
  wardrobe: Shirt,
  sources: Radio,
  sparkles: Sparkles,
  text: Type,
  link: Link2,
  external: ExternalLink,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof LUCIDE;
export const ICON_NAMES = Object.keys(LUCIDE) as IconName[];

/** lucide shapes that can be filled solid (others get a heavier line when active) */
const FILLABLE = new Set<IconName>(["bookmark", "vote-up", "vote-down"]);

// The generated pack, if the user made one. A glob, so a missing file is just an empty match.
const generated = import.meta.glob<{ BASIL: BasilPack }>("./basil.generated.ts", { eager: true });
const PACK: BasilPack | undefined = Object.values(generated)[0]?.BASIL;

interface IconProps {
  name: IconName;
  size?: number;
  /** active / selected: Basil's solid version */
  filled?: boolean;
  className?: string;
  /** only for icons that stand alone (no text or button label next to them) */
  label?: string;
}

export function IconView({ name, size = 20, filled = false, className, label, pack }: IconProps & { pack?: BasilPack }) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  const basil = pack?.[name];
  if (basil) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        {...a11y}
        focusable="false"
        data-icon={name}
        className={cn("shrink-0", className)}
        // Built by scripts/basil-icons.mjs from validated path data only.
        dangerouslySetInnerHTML={{ __html: filled ? basil.solid : basil.outline }}
      />
    );
  }
  const Lucide = LUCIDE[name];
  return (
    <Lucide
      size={size}
      {...a11y}
      data-icon={name}
      strokeWidth={filled && !FILLABLE.has(name) ? 2.1 : 1.5}
      fill={filled && FILLABLE.has(name) ? "currentColor" : "none"}
      className={cn("shrink-0", className)}
    />
  );
}

export function Icon(props: IconProps) {
  return <IconView {...props} pack={PACK} />;
}
