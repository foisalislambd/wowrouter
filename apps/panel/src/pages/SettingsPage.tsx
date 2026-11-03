import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { clearActivity, getDesktop, getSession, getSettings, saveDesktop, savePanelAuth } from "@/lib/api";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [dataDir, setDataDir] = useState("");
  const [address, setAddress] = useState("");
  const [logCount, setLogCount] = useState(0);
  const [osName, setOsName] = useState("");
  const [startWithWindows, setStartWithWindows] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authOn, setAuthOn] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");

  useEffect(() => {
    getSettings()
      .then((result) => {
        setDataDir(result.dataDir);
        setAddress(result.address);
        setLogCount(result.logCount);
      })
      .catch((err: Error) => setError(err.message));
    getDesktop()
      .then((result) => {
        setOsName(result.os);
        setStartWithWindows(result.startWithWindows);
      })
      .catch((err: Error) => setError(err.message));
    getSession()
      .then((result) => setAuthOn(result.authRequired))
      .catch((err: Error) => setError(err.message));
  }, []);

  async function onStartup(next: boolean) {
    setStartWithWindows(next);
    setError("");
    try {
      await saveDesktop(next);
    } catch (err) {
      setStartWithWindows(!next);
      setError(err instanceof Error ? err.message : "Could not save the startup setting");
    }
  }

  async function onAuth(enabled: boolean) {
    setError("");
    setAuthMessage("");
    if (enabled && password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    if (enabled && password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const result = await savePanelAuth({
        enabled,
        password: enabled ? password : "",
        currentPassword,
      });
      setAuthOn(result.authRequired);
      setPassword("");
      setConfirm("");
      setCurrentPassword("");
      if (result.signedOut) {
        window.dispatchEvent(new Event("wowrouter-auth"));
        return;
      }
      setAuthMessage(result.authRequired ? "Password protection is on." : "Password protection is off.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the password setting");
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    if (!window.confirm("Delete every request log on this computer?")) return;
    setBusy(true);
    setError("");
    try {
      await clearActivity();
      setLogCount(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear logs");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PanelPageHeader
        title="Settings"
      />
      {error && <p className="mb-4 text-sm text-error-500">{error}</p>}
      <div className="panel-card panel-card-body space-y-4">
        <div>
          <p className="text-xs tracking-wide text-gray-500 uppercase">Data folder</p>
          <p className="mt-1 font-mono text-sm text-gray-900 dark:text-white">{dataDir || "—"}</p>
        </div>
        <div>
          <p className="text-xs tracking-wide text-gray-500 uppercase">Listen address</p>
          <p className="mt-1 font-mono text-sm text-gray-900 dark:text-white">{address || "—"}</p>
        </div>
        <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
          <p className="text-xs tracking-wide text-gray-500 uppercase">Panel password</p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Off by default, so this computer can open the panel with no login. Turn it on before the router is reachable from another machine, such as a VPS or a published Docker port. Router keys for Cursor stay separate.
          </p>
          {authMessage && <p className="mt-2 text-sm text-success-600">{authMessage}</p>}
          <div className="mt-3 grid gap-2 sm:max-w-sm">
            {authOn && (
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                placeholder="Current password"
                className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white"
              />
            )}
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={authOn ? "New password" : "Password"}
              className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white"
            />
            <input
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="Confirm password"
              className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white"
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onAuth(true)} disabled={busy} className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60">
                {authOn ? "Change password" : "Turn on password"}
              </button>
              {authOn && (
                <button type="button" onClick={() => onAuth(false)} disabled={busy} className="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                  Turn off
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
          <p className="text-xs tracking-wide text-gray-500 uppercase">Background</p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">The router keeps running after you close the window. Quit it from the tray icon.</p>
          {osName === "windows" ? (
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
              <input type="checkbox" checked={startWithWindows} onChange={(event) => onStartup(event.target.checked)} />
              Start when Windows starts
            </label>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
          <p className="text-sm text-gray-600 dark:text-gray-300">{logCount} request logs stored</p>
          <button
            type="button"
            onClick={onClear}
            disabled={busy || logCount === 0}
            className="rounded-lg border border-error-200 px-3 py-2 text-sm font-medium text-error-500 hover:bg-error-50 disabled:opacity-50 dark:border-error-500/30 dark:hover:bg-error-500/10"
          >
            Clear request logs
          </button>
        </div>
      </div>
    </div>
  );
}
