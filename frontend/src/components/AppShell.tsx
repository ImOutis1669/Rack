import { Bookmark, Crosshair, LayoutGrid, Settings as SettingsIcon, Shirt } from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { cn } from "../lib/utils";
import { ProgressiveBlur } from "./magicui/progressive-blur";

export const TABS = [
  { to: "/", label: "Feed", icon: LayoutGrid },
  { to: "/hunts", label: "Hunts", icon: Crosshair },
  { to: "/saved", label: "Saved", icon: Bookmark },
  { to: "/taste", label: "Wardrobe", icon: Shirt },
] as const;

/** Desktop: segmented tabs in the top bar. */
function DesktopTabs() {
  return (
    <nav className="hidden items-center rounded-full bg-fill p-0.5 md:flex">
      {TABS.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) =>
            cn(
              "press rounded-full px-4 py-1.5 text-footnote font-semibold transition-colors",
              isActive ? "bg-elevated text-foreground shadow-sm" : "text-muted hover:text-foreground",
            )
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

/** iPhone: floating glass tab bar above the home indicator. */
function TabBar() {
  return (
    <nav
      aria-label="Tabs"
      className="fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(env(safe-area-inset-bottom),12px)] md:hidden"
    >
      <ProgressiveBlur position="bottom" height="48px" className="-mb-px" />
      <div className="glass relative mx-auto flex max-w-md items-stretch justify-around rounded-full p-1 shadow-lg ring-1 ring-border">
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "press flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[10px] font-medium",
                isActive ? "bg-fill text-foreground" : "text-muted",
              )
            }
          >
            <Icon size={20} strokeWidth={1.75} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export function PageShell({
  title,
  actions,
  below,
  children,
  wide = true,
  grouped = false,
}: {
  title: string;
  actions?: ReactNode;
  below?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  /** iOS grouped-list page: grey page with white rows (black / dark grey in dark mode) */
  grouped?: boolean;
}) {
  const { pathname } = useLocation();
  return (
    <div className={cn("min-h-dvh", grouped && "bg-surface dark:bg-background")}>
      <header className="glass sticky top-0 z-30 pt-safe">
        <div className={cn("mx-auto flex h-14 items-center gap-3 px-4 md:px-6", wide ? "max-w-7xl" : "max-w-3xl")}>
          <Link to="/" className="hidden font-display text-[19px] font-bold tracking-tight md:block">
            Rack
          </Link>
          <h1 className="truncate font-display text-title font-bold md:hidden">{title}</h1>
          <div className="flex flex-1 justify-center">
            <DesktopTabs />
          </div>
          <div className="-mr-2 flex items-center">
            {actions}
            {pathname !== "/settings" && (
              <Link to="/settings" aria-label="Settings" title="Settings" className="press inline-flex size-11 items-center justify-center rounded-full hover:bg-fill">
                <SettingsIcon size={20} strokeWidth={1.75} />
              </Link>
            )}
          </div>
        </div>
        {below && <div className={cn("mx-auto px-4 pb-2.5 md:px-6", wide ? "max-w-7xl" : "max-w-3xl")}>{below}</div>}
        <div className="h-px bg-border" />
        <ProgressiveBlur position="top" height="24px" className="md:hidden" />
      </header>
      <main
        className={cn(
          "mx-auto px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+104px)] md:px-6 md:pb-16",
          wide ? "max-w-7xl" : "max-w-3xl",
        )}
      >
        <h1 className="mb-4 hidden font-display text-largetitle font-bold md:block">{title}</h1>
        {children}
      </main>
      <TabBar />
    </div>
  );
}
