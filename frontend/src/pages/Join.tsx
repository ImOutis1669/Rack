import { useState } from "react";
import { inviteFromHash, passwordProblem, usernameProblem } from "@rack/shared/account";
import { api } from "../api/client";
import { MagicCard } from "../components/magicui/magic-card";
import { Button, Input } from "../components/ui";

/** Sign-up from an invite link: /join#<code>. The code sits in the fragment, so it never
 *  reaches the server's logs; it goes up only in the sign-up request. */
export function Join({ onSuccess }: { onSuccess: () => void }) {
  const [code] = useState(() => inviteFromHash(window.location.hash));
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = (username && usernameProblem(username)) || (password && passwordProblem(password, username)) || "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      await api.signup({ invite: code, username: username.trim(), password, display_name: name.trim() || undefined });
      window.history.replaceState(null, "", "/"); // drop the used code from the address bar
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create your account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 pt-safe pb-safe">
      <div className="w-full max-w-sm rounded-sheet">
        <MagicCard mode="orb" className="rounded-sheet" gradientSize={260} glowSize={240} glowOpacity={0.35}>
          {code ? (
            <form onSubmit={submit} className="flex flex-col gap-4 p-7">
              <div className="mb-2 text-center">
                <h1 className="font-display text-largetitle font-bold">Rack</h1>
                <p className="mt-1 text-footnote text-muted">You've been invited. Make your account.</p>
              </div>
              <Input autoComplete="name" placeholder="Name (optional)" aria-label="Name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className="bg-background dark:bg-elevated" />
              <Input
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Username"
                aria-label="Username"
                value={username}
                maxLength={24}
                onChange={(e) => setUsername(e.target.value)}
                className="bg-background dark:bg-elevated"
              />
              <Input type="password" autoComplete="new-password" placeholder="Password" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="bg-background dark:bg-elevated" />
              <p className={`text-center text-footnote ${problem || error ? "text-danger" : "text-muted"}`}>
                {error ?? (problem || "At least 12 characters for the password.")}
              </p>
              <Button type="submit" variant="primary" size="lg" disabled={busy || !username || !password || !!problem}>
                {busy ? "Creating account" : "Create account"}
              </Button>
            </form>
          ) : (
            <div className="p-7 text-center">
              <h1 className="font-display text-largetitle font-bold">Rack</h1>
              <p className="mt-3 text-body text-muted">This link has no invite code. Ask for a new one.</p>
              <Button variant="secondary" className="mt-5" onClick={() => window.location.assign("/")}>
                Log in instead
              </Button>
            </div>
          )}
        </MagicCard>
      </div>
    </div>
  );
}
