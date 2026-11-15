import { useState } from "react";
import { api } from "../api/client";

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
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto mt-32 flex max-w-xs flex-col gap-3 px-4">
      <h1 className="text-center text-2xl font-bold tracking-tight">Rack</h1>
      <input
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded-lg bg-neutral-900 px-3 py-2.5 ring-1 ring-white/15 focus:outline-none focus:ring-white/40"
      />
      <button
        disabled={busy || !password}
        className="rounded-lg bg-white py-2.5 font-semibold text-black disabled:opacity-50"
      >
        {busy ? "…" : "Log in"}
      </button>
      {error && <p className="text-center text-sm text-red-400">{error}</p>}
    </form>
  );
}
