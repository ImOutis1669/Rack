import { NavLink } from "react-router-dom";

const LINKS = [
  ["/", "Feed"],
  ["/taste", "Wardrobe"],
  ["/hunts", "Hunts"],
  ["/saved", "Saved"],
  ["/settings", "Settings"],
] as const;

export function Nav({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-lg font-bold tracking-tight">Rack</h1>
      <nav className="flex items-center gap-3 text-xs">
        {LINKS.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) => (isActive ? "text-white" : "text-neutral-400")}
          >
            {label}
          </NavLink>
        ))}
        <button onClick={onLogout} className="text-neutral-500">
          Log out
        </button>
      </nav>
    </div>
  );
}

export function PageShell({ onLogout, children }: { onLogout: () => void; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-3 pb-16">
      <header className="sticky top-0 z-10 -mx-3 bg-neutral-950/90 px-3 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)] backdrop-blur">
        <Nav onLogout={onLogout} />
      </header>
      {children}
    </div>
  );
}
