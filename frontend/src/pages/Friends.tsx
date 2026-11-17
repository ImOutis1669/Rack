// Owner only (v2.1): invite friends, see who uses Rack, disable or delete accounts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { isOwner } from "@rack/shared/account";
import { timeAgo } from "@rack/shared/format";
import type { AdminUser, CreatedInvite, Invite } from "@rack/shared/types";
import { api } from "../api/client";
import { PageShell } from "../components/AppShell";
import { Icon } from "../components/icons/Icon";
import { Avatar } from "../components/profile/Avatar";
import { toast } from "../components/Toast";
import { Button, Group, Input, Menu, Row, Skeleton } from "../components/ui";
import { useAccount } from "../lib/account";

const STATUS: Record<Invite["status"], string> = { open: "Waiting", used: "Used", revoked: "Revoked", expired: "Expired" };

export function Friends() {
  const account = useAccount();
  if (account.data && !isOwner(account.data)) return <Navigate to="/" replace />;
  return (
    <PageShell title="Friends" wide={false} grouped>
      <div className="space-y-7">
        <NewInvite />
        <People />
        <Invites />
      </div>
    </PageShell>
  );
}

function NewInvite() {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [made, setMade] = useState<CreatedInvite | null>(null);
  const create = useMutation({
    mutationFn: () => api.createInvite(note),
    onSuccess: (inv) => {
      setMade(inv);
      setNote("");
      void qc.invalidateQueries({ queryKey: ["invites"] });
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Couldn't make an invite"),
  });
  const share = async () => {
    if (!made) return;
    if (navigator.share) {
      await navigator.share({ title: "Rack", text: "Join me on Rack", url: made.url }).catch(() => undefined);
    } else {
      await navigator.clipboard.writeText(made.url);
      toast("Link copied");
    }
  };
  return (
    <Group
      title="Invite a friend"
      footer="Each link works once and expires in 7 days. You'll only see it now, so send it straight away."
    >
      {made ? (
        <div className="space-y-3 px-4 py-3">
          <p className="text-footnote text-muted">{made.note ? `Link for ${made.note}` : "New invite link"}</p>
          <p className="rounded-photo bg-fill px-3 py-2.5 text-footnote break-all select-all">{made.url}</p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={share}>
              <Icon name="share" size={18} /> Share link
            </Button>
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(made.url).then(() => toast("Link copied"));
              }}
            >
              Copy
            </Button>
            <Button variant="plain" onClick={() => setMade(null)}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex items-center gap-2 px-4 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input placeholder="Who's it for? (optional)" aria-label="Who the invite is for" value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" variant="primary" disabled={create.isPending}>
            Create link
          </Button>
        </form>
      )}
    </Group>
  );
}

function People() {
  const users = useQuery({ queryKey: ["admin-users"], queryFn: api.adminUsers });
  return (
    <Group title="People" footer="eBay searches are the hunts' and live searches' share of eBay's 5,000 a day, today.">
      {users.isPending && <Skeleton className="m-4 h-12" />}
      {users.data?.map((u) => <Person key={u.id} user={u} />)}
    </Group>
  );
}

function Person({ user }: { user: AdminUser }) {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ["admin-users"] });
  const toggle = useMutation({ mutationFn: () => (user.disabled ? api.enableUser(user.id) : api.disableUser(user.id)), onSuccess: done });
  const remove = useMutation({ mutationFn: () => api.deleteUser(user.id), onSuccess: done });
  const owner = user.role === "owner";
  const detail = [
    owner ? "You" : user.disabled ? "Disabled" : user.last_active_at ? `Active ${timeAgo(user.last_active_at)}` : "Not used yet",
    `${user.hunts} hunt${user.hunts === 1 ? "" : "s"}`,
    `${user.ebay_searches_today} eBay searches`,
  ].join(" · ");
  return (
    <Row>
      <Avatar account={{ ...user, avatar: user.avatar }} size={36} className={user.disabled ? "opacity-50" : undefined} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body">
          {user.display_name} <span className="text-muted">@{user.username}</span>
        </div>
        <div className="truncate text-footnote text-muted tabular">{detail}</div>
      </div>
      {!owner && (
        <Menu
          trigger={(p) => (
            <button type="button" {...p} aria-label={`Manage ${user.username}`} className="press -mr-2 inline-flex size-11 items-center justify-center rounded-full hover:bg-fill">
              <Icon name="more" size={20} />
            </button>
          )}
          items={[
            { label: user.disabled ? "Enable" : "Disable", onSelect: () => toggle.mutate() },
            {
              label: "Delete account",
              danger: true,
              onSelect: () => {
                if (window.confirm(`Delete @${user.username} and everything theirs? This can't be undone.`)) remove.mutate();
              },
            },
          ]}
        />
      )}
    </Row>
  );
}

function Invites() {
  const qc = useQueryClient();
  const invites = useQuery({ queryKey: ["invites"], queryFn: api.invites });
  const revoke = useMutation({
    mutationFn: (id: number) => api.revokeInvite(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["invites"] }),
  });
  if (!invites.data?.length) return null;
  return (
    <Group title="Invite links">
      {invites.data.map((inv) => (
        <Row
          key={inv.id}
          label={inv.note || "Invite"}
          detail={inv.status === "used" && inv.used_by ? `Used by @${inv.used_by}` : `${STATUS[inv.status]} · made ${timeAgo(inv.created_at)}`}
        >
          {inv.status === "open" && (
            <Button size="sm" variant="danger" onClick={() => revoke.mutate(inv.id)}>
              Revoke
            </Button>
          )}
        </Row>
      ))}
    </Group>
  );
}
