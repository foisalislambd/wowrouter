import { getSession, login } from "@/lib/api";
import { useEffect, useState, type FormEvent } from "react";

export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [passwordOn, setPasswordOn] = useState(true);
  const [oidc, setOidc] = useState(false);

  useEffect(() => {
    getSession()
      .then((session) => {
        setPasswordOn(Boolean(session.password));
        setOidc(Boolean(session.oidc));
      })
      .catch(() => undefined);
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      <form onSubmit={onSubmit} className="panel-card w-full max-w-sm p-6">
        <p className="text-lg font-semibold text-gray-900 dark:text-white">WowRouter</p>
        <p className="mt-1 text-sm text-gray-500">This panel asks you to sign in.</p>
        {error && <p className="mt-3 text-sm text-error-500">{error}</p>}
        {oidc && (
          <a href="/api/oidc/start" className="mt-4 block rounded-lg border border-gray-200 px-4 py-2 text-center text-sm dark:border-gray-700">
            Continue with SSO
          </a>
        )}
        {passwordOn && (
          <>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              className="mt-4 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white"
            />
            <button
              type="submit"
              disabled={busy || password.length === 0}
              className="mt-3 w-full rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
            >
              Sign in
            </button>
          </>
        )}
      </form>
    </div>
  );
}
