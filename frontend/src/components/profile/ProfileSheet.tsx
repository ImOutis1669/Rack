// Profile (v2.1): opened from your avatar, where the settings gear used to be. Your account at the
// top (photo, name, username), then the way into Settings, Sources, security and privacy. One
// sheet with its own small stack of views (no sheet on top of a sheet).
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { isOwner, memberSince, passwordProblem } from "@rack/shared/account";
import type { Account } from "@rack/shared/types";
import { api } from "../../api/client";
import { clearSnapshots } from "../../lib/snapshot";
import { clearOwnerAssets } from "../../lib/ownerAssets";
import { clearRecent } from "../../lib/recentSearches";
import { useAccount } from "../../lib/account";
import { cn } from "../../lib/utils";
import { Icon, type IconName } from "../icons/Icon";
import { SourcesList } from "../SourcesButton";
import { toast } from "../Toast";
import { Button, Group, Input, Menu, Row, Sheet } from "../ui";
import { Avatar } from "./Avatar";

/** Signed out (log out, everywhere, or account deleted): drop everything this browser holds for
 *  the account and start the app again at the login screen. A full reload is the only way to be
 *  sure no query, snapshot, font or icon of that account stays in memory. */
function leave(qc: QueryClient): void {
  clearSnapshots();
  clearRecent();
  clearOwnerAssets();
  qc.clear();
  window.location.replace("/");
}

type View = "main" | "sources" | "password" | "privacy" | "delete";
const TITLES: Record<View, string> = {
  main: "Profile",
  sources: "Sources",
  password: "Change password",
  privacy: "Privacy",
  delete: "Delete my account",
};

export function ProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [view, setView] = useState<View>("main");
  const account = useAccount();
  useEffect(() => {
    if (!open) setView("main"); // next time, start at the top
  }, [open]);
  const back = view !== "main" && (
    <button
      type="button"
      onClick={() => setView("main")}
      className="press -ml-2 inline-flex h-9 items-center gap-0.5 rounded-full pr-2 text-body"
    >
      <Icon name="chevron-left" size={20} /> Profile
    </button>
  );
  return (
    <Sheet open={open} onClose={onClose} title={back || TITLES[view]}>
      <div className="space-y-6 bg-surface p-4 pb-[max(env(safe-area-inset-bottom),20px)] dark:bg-transparent dark:[&_.rounded-group]:bg-elevated">
        {view !== "main" && <h2 className="px-1 font-display text-title font-bold">{TITLES[view]}</h2>}
        {account.data ? (
          <>
            {view === "main" && <Main account={account.data} onView={setView} onClose={onClose} />}
            {view === "sources" && <Sources />}
            {view === "password" && <ChangePassword account={account.data} onDone={() => setView("main")} />}
            {view === "privacy" && <Privacy />}
            {view === "delete" && <DeleteAccount />}
          </>
        ) : (
          <div className="h-64" />
        )}
      </div>
    </Sheet>
  );
}

function NavRow({ icon, label, detail, onClick, danger }: { icon: IconName; label: string; detail?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("press flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left", danger && "text-danger")}>
      <Icon name={icon} size={20} className={danger ? undefined : "text-muted"} />
      <span className="min-w-0 flex-1">
        <span className="block text-body">{label}</span>
        {detail && <span className="block text-footnote text-muted">{detail}</span>}
      </span>
      {!danger && <Icon name="chevron-right" size={18} className="text-subtle" />}
    </button>
  );
}

function Main({ account, onView, onClose }: { account: Account; onView: (v: View) => void; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const owner = isOwner(account);
  const go = (path: string) => {
    onClose();
    navigate(path);
  };
  const signedOut = () => leave(qc);
  const logout = useMutation({ mutationFn: api.logout, onSettled: signedOut });
  const logoutAll = useMutation({ mutationFn: api.logoutAll, onSettled: signedOut });
  return (
    <>
      <Header account={account} />
      <NameField account={account} />
      <Group>
        <NavRow icon="settings" label="Settings" detail="Taste, sizes, budget, alerts" onClick={() => go("/settings")} />
        <NavRow icon="sources" label="Sources" onClick={() => onView("sources")} />
        {owner && <NavRow icon="friends" label="Friends and invites" onClick={() => go("/friends")} />}
      </Group>
      <Group
        title="Security"
        footer="Log out all devices ends every session of yours, including this one. Use it if a phone or computer you were logged in on is lost. Changing your password does the same on your other devices."
      >
        <NavRow icon="password" label="Change password" onClick={() => onView("password")} />
        <button type="button" className="press flex min-h-11 w-full items-center gap-3 px-4 text-body" onClick={() => logout.mutate()}>
          <Icon name="logout" size={20} className="text-muted" /> Log out
        </button>
        <button
          type="button"
          className="press flex min-h-11 w-full items-center gap-3 px-4 text-body text-danger disabled:opacity-40"
          disabled={logoutAll.isPending}
          onClick={() => window.confirm("Log out on every device?") && logoutAll.mutate()}
        >
          <Icon name="logout" size={20} /> Log out all devices
        </button>
      </Group>
      <Group>
        <NavRow icon="privacy" label="Privacy" onClick={() => onView("privacy")} />
        {!owner && <NavRow icon="delete" label="Delete my account" onClick={() => onView("delete")} danger />}
      </Group>
    </>
  );
}

function Header({ account }: { account: Account }) {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const done = (a: Account) => qc.setQueryData(["account"], a);
  const upload = useMutation({
    mutationFn: (f: File) => api.uploadAvatar(f),
    onSuccess: done,
    onError: (e) => toast(e instanceof Error ? e.message : "Couldn't use that photo"),
  });
  const remove = useMutation({ mutationFn: api.removeAvatar, onSuccess: done });
  const busy = upload.isPending || remove.isPending;
  const choose = () => file.current?.click();
  return (
    <section className="flex flex-col items-center gap-1 pt-1 text-center">
      <Menu
        align="left"
        trigger={(p) => (
          <button
            type="button"
            {...p}
            onClick={account.avatar ? p.onClick : choose}
            aria-label={account.avatar ? "Change or remove photo" : "Add a photo"}
            className={cn("press relative mb-2 rounded-full", busy && "opacity-50")}
            disabled={busy}
          >
            <Avatar account={account} size={88} />
            <span className="absolute -right-0.5 -bottom-0.5 inline-flex size-8 items-center justify-center rounded-full bg-foreground text-background ring-3 ring-surface dark:ring-background">
              <Icon name="camera" size={16} />
            </span>
          </button>
        )}
        items={[
          { label: "Choose photo", onSelect: choose },
          { label: "Remove photo", onSelect: () => remove.mutate(), danger: true },
        ]}
      />
      <input
        ref={file}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) upload.mutate(f);
        }}
      />
      <h2 className="font-display text-title font-bold">{account.display_name}</h2>
      <p className="text-footnote text-muted">
        @{account.username}
        {isOwner(account) && " · Owner"}
      </p>
      <p className="text-footnote text-muted">{memberSince(account.created_at)}</p>
    </section>
  );
}

function NameField({ account }: { account: Account }) {
  const qc = useQueryClient();
  const [name, setName] = useState(account.display_name);
  useEffect(() => setName(account.display_name), [account.display_name]);
  const save = useMutation({
    mutationFn: (n: string) => api.updateAccount(n),
    onSuccess: (a) => {
      qc.setQueryData(["account"], a);
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => {
      setName(account.display_name);
      toast(e instanceof Error ? e.message : "Couldn't save your name");
    },
  });
  const commit = () => {
    const n = name.trim();
    if (n && n !== account.display_name) save.mutate(n);
    else setName(account.display_name);
  };
  return (
    <Group title="Name" footer="Shown on your profile. Your username stays the same.">
      <Row>
        <input
          aria-label="Name"
          value={name}
          maxLength={60}
          autoComplete="name"
          enterKeyHint="done"
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none"
        />
      </Row>
    </Group>
  );
}

function Sources() {
  const { data } = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 60_000 });
  return <SourcesList data={data} />;
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block px-1 text-footnote font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function ChangePassword({ account, onDone }: { account: Account; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const problem = next ? passwordProblem(next, account.username) || (again && again !== next ? "The two new passwords differ" : "") : "";
  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      toast("Password changed. Your other devices are logged out.");
      onDone();
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem && again === next) change.mutate();
      }}
    >
      <input type="text" autoComplete="username" value={account.username} readOnly hidden />
      <Labelled label="Current password">
        <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="bg-elevated dark:bg-fill" />
      </Labelled>
      <Labelled label="New password">
        <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className="bg-elevated dark:bg-fill" />
      </Labelled>
      <Labelled label="New password again">
        <Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className="bg-elevated dark:bg-fill" />
      </Labelled>
      <p className={cn("px-1 text-footnote", problem || change.error ? "text-danger" : "text-muted")}>
        {change.error instanceof Error ? change.error.message : problem || "At least 12 characters. A few random words work well."}
      </p>
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!current || !next || again !== next || !!problem || change.isPending}>
        {change.isPending ? "Changing" : "Change password"}
      </Button>
    </form>
  );
}

function Privacy() {
  return (
    <div className="space-y-4 px-1 text-body leading-relaxed">
      <p>
        Rack runs on its owner's own computer, not a company's servers. What you add stays there: your account, taste,
        designers and sizes, wardrobe and wishlist photos, Saved, votes, hunts, hidden sellers and the devices you turned
        alerts on for.
      </p>
      <p>Other people using this Rack can't see any of it. The owner runs the server, so they could look at the database.</p>
      <p>
        Photos you upload are re-saved without their location and camera details. Passwords are stored as a one-way hash,
        never as text.
      </p>
      <p>
        No ads, no analytics, no tracking. Listings come from eBay, Vinted and Grailed; Rack keeps no eBay seller or buyer
        details.
      </p>
      <p>Deleting your account removes everything that's yours, at once.</p>
    </div>
  );
}

function DeleteAccount() {
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const del = useMutation({
    mutationFn: () => api.deleteAccount(password),
    onSuccess: () => leave(qc),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (password && window.confirm("Delete your account and everything in it? This can't be undone.")) del.mutate();
      }}
    >
      <p className="px-1 text-body">
        This removes your account and everything in it: taste, wardrobe photos, Saved, votes, hunts and alerts. It can't be
        undone.
      </p>
      <Labelled label="Your password">
        <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="bg-elevated dark:bg-fill" />
      </Labelled>
      {del.error instanceof Error && <p className="px-1 text-footnote text-danger">{del.error.message}</p>}
      <Button type="submit" variant="danger" size="lg" className="w-full" disabled={!password || del.isPending}>
        {del.isPending ? "Deleting" : "Delete my account"}
      </Button>
    </form>
  );
}
