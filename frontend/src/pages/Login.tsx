import { useState } from "react";
import { api } from "../api/client";
import { AnimatedShinyText } from "../components/magicui/animated-shiny-text";
import { MagicCard } from "../components/magicui/magic-card";
import { Button, Input } from "../components/ui";

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't log in");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 pt-safe pb-safe">
      <div className="w-full max-w-sm rounded-sheet">
        <MagicCard className="rounded-sheet" gradientSize={260}>
          <form onSubmit={submit} className="flex flex-col gap-4 p-7">
            <div className="mb-2 text-center">
              <h1 className="font-display text-largetitle font-bold">Rack</h1>
              <AnimatedShinyText className="mt-1 inline-block text-footnote">Second-hand, ranked by your taste</AnimatedShinyText>
            </div>
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              aria-label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-background dark:bg-elevated"
            />
            <Button type="submit" variant="primary" size="lg" disabled={busy || !password}>
              {busy ? "Logging in" : "Log in"}
            </Button>
            {error && <p className="text-center text-footnote text-danger">{error}</p>}
          </form>
        </MagicCard>
      </div>
    </div>
  );
}
