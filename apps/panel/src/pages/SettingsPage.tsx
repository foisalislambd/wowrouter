import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { ConfirmDialog, useToast } from "@/components/ui/feedback";
import { Link } from "react-router-dom";
import { hiddenNavHrefs, panelNavItems, saveHiddenNav } from "@/config/panel.config";
import { clearActivity, getDesktop, getSession, getSettings, saveDesktop, saveFeatures, saveOIDC, savePanelAuth, type Features } from "@/lib/api";
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
  const [features, setFeatures] = useState<Features>({ compression: "off", cache: false, cacheTtl: 300, memory: false });
  const [oidcOn, setOidcOn] = useState(false);
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUrl, setRedirectUrl] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const toast = useToast();

  useEffect(() => {
    getSettings()
      .then((result) => {
        setDataDir(result.dataDir);
        setAddress(result.address);
        setLogCount(result.logCount);
        if (result.features) setFeatures(result.features);
        if (result.oidc) {
          setOidcOn(result.oidc.enabled);
          setIssuer(result.oidc.issuer || "");
          setClientId(result.oidc.clientId || "");
        }
        setRedirectUrl(result.redirectUrl || "");
      })
      .catch((err: Error) => setError(err.message));
    getDesktop()
      .then((result) => {
        setOsName(result.os);
        setStartWithWindows(result.startWithWindows);
      })
      .catch((err: Error) => setError(err.message));
    getSession()
      .then((result) => setAuthOn(Boolean(result.password)))
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

  async function onOIDC(enabled: boolean) {
    setBusy(true);
    setError("");
    setAuthMessage("");
    try {
      const saved = await saveOIDC({ enabled, issuer, clientId, clientSecret });
      setOidcOn(saved.enabled);
      setClientSecret("");
      setAuthMessage(saved.enabled ? "OIDC sign-in is on." : "OIDC sign-in is off.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save OIDC");
    } finally {
      setBusy(false);
    }
  }

  async function onFeatures() {
    setBusy(true);
    setError("");
    try {
      const saved = await saveFeatures(features);
      setFeatures(saved);
      setAuthMessage("Prompt helpers saved.");
      toast("Helpers saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save prompt helpers");
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    setBusy(true);
    setError("");
    try {
      await clearActivity();
      setLogCount(0);
      setConfirmClear(false);
      toast("Logs cleared");
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
        description="Password and sign-in stay off until you turn them on. Provider keys and router keys are separate."
        actions={<Link to="/changelog" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-200">Changelog</Link>}
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
          <p className="text-xs tracking-wide text-gray-500 uppercase">Sign in with OIDC</p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Optional. Off by default. The panel asks for a password or this provider only after you turn one of them on. Register this redirect URL with the provider.
          </p>
          <p className="mt-2 font-mono text-xs text-gray-800 dark:text-gray-100">{redirectUrl || "—"}</p>
          <div className="mt-3 grid gap-2 sm:max-w-md">
            <input value={issuer} onChange={(event) => setIssuer(event.target.value)} placeholder="Issuer URL" className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white" />
            <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Client id" className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white" />
            <input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="Client secret" className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white" />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onOIDC(true)} disabled={busy} className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60">
                {oidcOn ? "Update OIDC" : "Turn on OIDC"}
              </button>
              {oidcOn && (
                <button type="button" onClick={() => onOIDC(false)} disabled={busy} className="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                  Turn off
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
          <p className="text-xs tracking-wide text-gray-500 uppercase">Prompt helpers</p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">All off by default. Compression rewrites text locally. Cache stores non-streaming replies on this computer. Memory sends notes from the Memory page.</p>
          <div className="mt-3 space-y-2 text-sm text-gray-800 dark:text-gray-100">
            <label className="flex items-center gap-2">
              Compression
              <select value={features.compression || "off"} onChange={(event) => setFeatures({ ...features, compression: event.target.value })} className="h-9 rounded-lg border border-gray-200 bg-white px-2 dark:border-gray-700 dark:bg-white/5">
                <option value="off">Off</option>
                <option value="light">Light — squeeze spaces</option>
                <option value="caveman">Caveman — drop filler words</option>
                <option value="dedup">Dedup — drop repeated lines</option>
                <option value="headroom">Headroom — keep the first 4000 characters</option>
                <option value="rtk">RTK — drop shell prompt lines</option>
                <option value="terse">Terse</option>
                <option value="ultra">Ultra</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={features.cache} onChange={(event) => setFeatures({ ...features, cache: event.target.checked })} />
              Response cache
            </label>
            <label className="flex items-center gap-2">
              Cache for
              <input type="number" min={30} max={86400} value={features.cacheTtl} onChange={(event) => setFeatures({ ...features, cacheTtl: Number(event.target.value) })} className="h-9 w-28 rounded-lg border border-gray-200 bg-white px-2 dark:border-gray-700 dark:bg-white/5" />
              seconds
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={features.memory} onChange={(event) => setFeatures({ ...features, memory: event.target.checked })} />
              Memory notes
            </label>
            <button type="button" onClick={onFeatures} disabled={busy} className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60">
              Save helpers
            </button>
          </div>
        </div>
        <SidebarChoices />
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
            onClick={() => setConfirmClear(true)}
            disabled={busy || logCount === 0}
            className="rounded-lg border border-error-200 px-3 py-2 text-sm font-medium text-error-500 hover:bg-error-50 disabled:opacity-50 dark:border-error-500/30 dark:hover:bg-error-500/10"
          >
            Clear request logs
          </button>
        </div>
      </div>
      <ConfirmDialog open={confirmClear} title="Clear request logs?" body="This deletes every stored call on this computer." confirmLabel="Clear logs" busy={busy} onClose={() => setConfirmClear(false)} onConfirm={onClear} />
    </div>
  );
}

function SidebarChoices() {
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    setHidden([...hiddenNavHrefs()]);
  }, []);
  function toggle(href: string) {
    const next = hidden.includes(href) ? hidden.filter((item) => item !== href) : [...hidden, href];
    setHidden(next);
    saveHiddenNav(next);
  }
  return (
    <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
      <p className="text-xs tracking-wide text-gray-500 uppercase">Sidebar</p>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Hide pages you do not use. Settings stays visible. This choice stays in this browser.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {panelNavItems.filter((item) => item.href !== "/settings").map((item) => (
          <label key={item.href} className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
            <input type="checkbox" checked={!hidden.includes(item.href)} onChange={() => toggle(item.href)} />
            {item.name}
          </label>
        ))}
      </div>
    </div>
  );
}
