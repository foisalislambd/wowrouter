import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { clearActivity, getDesktop, getSettings, saveDesktop } from "@/lib/api";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [dataDir, setDataDir] = useState("");
  const [address, setAddress] = useState("");
  const [logCount, setLogCount] = useState(0);
  const [osName, setOsName] = useState("");
  const [startWithWindows, setStartWithWindows] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
