import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { CopyButton } from "@/components/ui/feedback";
import { getClients, listClientTargets, restoreClientConfig, writeClientConfig, type ClientSnippet, type ClientTarget } from "@/lib/api";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

export default function ClientsPage() {
  const [baseUrl, setBaseUrl] = useState("");
  const [clients, setClients] = useState<ClientSnippet[]>([]);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const [targets, setTargets] = useState<ClientTarget[]>([]);
  const [routerKey, setRouterKey] = useState("");
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    getClients()
      .then((result) => {
        setBaseUrl(result.baseUrl);
        setClients(result.clients);
      })
      .catch((err: Error) => setError(err.message));
    listClientTargets()
      .then((result) => setTargets(result.clients))
      .catch((err: Error) => setError(err.message));
  }, []);

  async function writeTarget(id: string) {
    setError("");
    setNotice("");
    try {
      const result = await writeClientConfig(id, routerKey.trim(), confirmWrite);
      setNotice(`Wrote ${result.path}${result.backup ? `. Backup: ${result.backup}` : ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not write the config");
    }
  }

  async function restoreTarget(id: string) {
    setError("");
    setNotice("");
    if (!window.confirm("Restore the newest backup over the current config?")) return;
    try {
      const result = await restoreClientConfig(id, true);
      setNotice(`Restored ${result.path} from ${result.backup}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore the config");
    }
  }

  async function copy(id: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    window.setTimeout(() => setCopied(""), 1500);
  }

  return (
    <div>
      <PanelPageHeader
        title="Clients"
        actions={baseUrl ? <CopyButton text={baseUrl} label="Copy base URL" /> : undefined}
      />
      {error && <p className="mb-4 text-sm text-error-500">{error}</p>}
      {notice && <p className="mb-4 text-sm text-success-600">{notice}</p>}
      <section className="panel-card panel-card-body mb-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Write a config on this computer</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          The writer keeps a backup in the data folder and refuses to replace a file that is not valid JSON or TOML. Check the box before it writes.
        </p>
        <input
          value={routerKey}
          onChange={(event) => setRouterKey(event.target.value)}
          placeholder="Router key, sk-airoute-…"
          className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 font-mono text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white"
        />
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
          <input type="checkbox" checked={confirmWrite} onChange={(event) => setConfirmWrite(event.target.checked)} />
          I confirm this may overwrite the client config
        </label>
        <div className="grid gap-3">
          {targets.map((target) => (
            <div key={target.id} className="rounded-lg border border-gray-100 p-3 dark:border-gray-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{target.name}</p>
                  <p className="font-mono text-xs text-gray-500">{target.path}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => writeTarget(target.id)}
                    className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600"
                  >
                    Write
                  </button>
                  <button
                    type="button"
                    onClick={() => restoreTarget(target.id)}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
                  >
                    Restore
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{target.summary}</p>
            </div>
          ))}
        </div>
      </section>
      <div className="grid gap-4">
        {clients.map((client) => (
          <section key={client.id} className="panel-card panel-card-body">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{client.name}</h2>
                <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-300">{client.summary}</p>
              </div>
              <button
                type="button"
                onClick={() => copy(client.id, client.config)}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
              >
                {copied === client.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied === client.id ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="mt-3 overflow-auto rounded-lg bg-gray-50 p-3 font-mono text-xs text-gray-800 dark:bg-white/5 dark:text-gray-100">{client.config}</pre>
          </section>
        ))}
      </div>
    </div>
  );
}
