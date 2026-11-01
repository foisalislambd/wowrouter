import { login } from "@/lib/api";
import { useState, type FormEvent } from "react";

export default function LoginPage({ onReady }: { onReady: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(token.trim());
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel-shell flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={onSubmit} className="panel-card w-full max-w-md panel-card-body space-y-4">
        <div>
          <p className="text-xs font-semibold tracking-wide text-brand-600 uppercase">WowRouter</p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">Sign in</h1>
          <p className="mt-2 text-sm text-gray-500">
            Paste the admin token printed the first time this data folder started. It is also stored as bootstrap-token next to the database.
          </p>
        </div>
        <input
          value={token}
          onChange={(event) => setToken(event.target.value)}
          type="password"
          autoFocus
          placeholder="Admin token"
          className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white"
        />
        {error && <p className="text-sm text-error-500">{error}</p>}
        <button
          type="submit"
          disabled={busy || token.trim() === ""}
          className="h-11 w-full rounded-lg bg-brand-500 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
