import { Bookmark, Crosshair, LayoutGrid, Settings as SettingsIcon, Shirt } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { pillTransition } from "../lib/motion";
import { useScrolled } from "../lib/useScrolled";
import { cn } from "../lib/utils";

export const TABS = [
  { to: "/", label: "Feed", icon: LayoutGrid },
  { to: "/hunts", label: "Hunts", icon: Crosshair },
  { to: "/saved", label: "Saved", icon: Bookmark },
  { to: "/taste", label: "Wardrobe", icon: Shirt },
] as const;

/** Desktop: segmented tabs in the top bar. */
function DesktopTabs() {
  const reduce = useReducedMotion();
  return (
    <LayoutGroup id="desktop-tabs">
      <nav className="isolate hidden items-center rounded-full bg-fill p-0.5 md:flex">
        {TABS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "press relative rounded-full px-4 py-1.5 text-footnote font-semibold transition-colors",
                isActive ? "text-foreground" : "text-muted hover:text-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="desktop-tab-pill"
                    transition={pillTransition(reduce)}
                    className="absolute inset-0 -z-10 rounded-full bg-elevated shadow-sm"
                  />
                )}
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </LayoutGroup>
  );
}

/**
 * iPhone: the Liquid Glass dock floating above the home indicator. One glass layer; the active
 * tab sits on a plain fill pill (never glass on glass) that slides between tabs with a spring.
 */
function TabBar() {
  const reduce = useReducedMotion();
  return (
    <nav
      aria-label="Tabs"
      className="fixed inset-x-0 bottom-0 z-30 px-4 pt-6 pb-[max(calc(env(safe-area-inset-bottom)-6px),12px)] md:hidden"
    >
      {/* soft fade from the page into the bar, all the way down past the home indicator */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background from-35% via-background/75 via-60% to-transparent"
      />
      <LayoutGroup id="dock">
        <div data-testid="dock" className="glass-chrome mx-auto flex max-w-md items-stretch justify-around rounded-full p-1">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "press relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[10px] font-medium",
                  isActive ? "text-foreground" : "text-muted",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="dock-pill"
                      data-testid="dock-pill"
                      transition={pillTransition(reduce)}
                      className="absolute inset-0 -z-10 rounded-full bg-fill-strong"
                    />
                  )}
                  <Icon size={20} strokeWidth={isActive ? 2.1 : 1.75} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </LayoutGroup>
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
  desktopTitle = true,
}: {
  title: string;
  actions?: ReactNode;
  below?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  /** iOS grouped-list page: grey page with white rows (black / dark grey in dark mode) */
  grouped?: boolean;
  /** Desktop large heading under the bar. Off for the feed, whose title is the "Rack" wordmark. */
  desktopTitle?: boolean;
}) {
  const { pathname } = useLocation();
  const scrolled = useScrolled();
  return (
    <div className={cn("min-h-dvh", grouped && "bg-surface dark:bg-background")}>
      <header data-scrolled={scrolled} className="glass-bar sticky top-0 z-30 pt-safe">
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
      </header>
      <main
        className={cn(
          "mx-auto px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+104px)] md:px-6 md:pb-16",
          wide ? "max-w-7xl" : "max-w-3xl",
        )}
      >
        {desktopTitle && <h1 className="mb-4 hidden font-display text-largetitle font-bold md:block">{title}</h1>}
        {children}
      </main>
      <TabBar />
    </div>
  );
}
