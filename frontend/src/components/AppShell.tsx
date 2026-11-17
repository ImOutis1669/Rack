import { LayoutGroup, m, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { pillTransition } from "../lib/motion";
import { useScrolled } from "../lib/useScrolled";
import { cn } from "../lib/utils";
import { Icon, type IconName } from "./icons/Icon";

export const TABS: readonly { to: string; label: string; icon: IconName }[] = [
  { to: "/", label: "Feed", icon: "feed" },
  { to: "/hunts", label: "Hunts", icon: "hunts" },
  { to: "/saved", label: "Saved", icon: "bookmark" },
  { to: "/taste", label: "Wardrobe", icon: "wardrobe" },
];

/**
 * The tab chrome, rendered once at app level (main.tsx), outside the routes and their Suspense
 * fallback: it persists across navigation, so the active pill slides from tab to tab instead of
 * being rebuilt with each page (v1.2), and lazy pages loading never make it flicker.
 */
export function AppTabs() {
  return (
    <>
      <DesktopTabs />
      <TabBar />
    </>
  );
}

/**
 * Desktop: segmented tabs centred in the top bar. Fixed over each page's (sticky) bar rather than
 * inside it, so they persist; `layoutRoot` keeps the pill's slide correct while the page scrolls.
 */
function DesktopTabs() {
  const reduce = useReducedMotion();
  return (
    <LayoutGroup id="desktop-tabs">
      <m.nav
        layoutRoot
        aria-label="Tabs"
        data-testid="desktop-tabs"
        className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+11px)] z-40 mx-auto isolate hidden w-fit items-center rounded-full bg-fill p-0.5 md:flex"
      >
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
                  <m.span
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
      </m.nav>
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
    <m.nav
      layoutRoot
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
          {TABS.map(({ to, label, icon }) => (
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
                    <m.span
                      layoutId="dock-pill"
                      data-testid="dock-pill"
                      transition={pillTransition(reduce)}
                      className="absolute inset-0 -z-10 rounded-full bg-fill-strong"
                    />
                  )}
                  {/* outline at rest, solid when selected (iOS tab bar convention) */}
                  <Icon name={icon} size={22} filled={isActive} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </LayoutGroup>
    </m.nav>
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
          <h1 className="truncate font-display text-pagetitle font-bold heavy md:hidden">{title}</h1>
          {/* room for the desktop tabs, which AppTabs draws over the bar */}
          <div className="flex-1" />
          <div className="-mr-2 flex items-center">
            {actions}
            {pathname !== "/settings" && (
              <Link to="/settings" aria-label="Settings" title="Settings" className="press inline-flex size-11 items-center justify-center rounded-full hover:bg-fill">
                <Icon name="settings" size={22} />
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
        {desktopTitle && <h1 className="mb-4 hidden font-display text-largetitle font-bold heavy md:block">{title}</h1>}
        {children}
      </main>
    </div>
  );
}
