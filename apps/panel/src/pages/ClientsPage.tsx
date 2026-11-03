import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { getClients, type ClientSnippet } from "@/lib/api";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

export default function ClientsPage() {
  const [baseUrl, setBaseUrl] = useState("");
  const [clients, setClients] = useState<ClientSnippet[]>([]);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getClients()
      .then((result) => {
        setBaseUrl(result.baseUrl);
        setClients(result.clients);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function copy(id: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    window.setTimeout(() => setCopied(""), 1500);
  }

  return (
    <div>
      <PanelPageHeader title="Clients" />
      <p className="mb-4 max-w-2xl text-sm text-gray-600 dark:text-gray-300">
        Point an OpenAI-compatible tool at <span className="font-mono text-xs">{baseUrl || "…"}</span> and paste a router key from API keys.
        Use <span className="font-mono text-xs">auto</span> when you want WowRouter to pick a turned-on chat model.
      </p>
      {error && <p className="mb-4 text-sm text-error-500">{error}</p>}
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
