import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { createKey, deleteKey, listKeys, type CreatedKey, type RouterKey } from "@/lib/api";
import { Check, Copy } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

export default function KeysPage() {
  const [keys, setKeys] = useState<RouterKey[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listKeys()
      .then((result) => setKeys(result.keys))
      .catch((err: Error) => setError(err.message));
  }, []);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const next = await createKey(name.trim());
      setCreated(next);
      setName("");
      setKeys((current) => [next, ...current]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create key");
    }
  }

  async function onDelete(id: string) {
    setError("");
    try {
      await deleteKey(id);
      setKeys((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke key");
    }
  }

  async function copySecret() {
    if (!created) return;
    await navigator.clipboard.writeText(created.secret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <PanelPageHeader
        title="API keys"
      />
      {error && <p className="mb-4 text-sm text-error-500">{error}</p>}
      {created && (
        <div className="panel-card mb-4 border-brand-200 bg-brand-50 p-4 dark:border-brand-500/30 dark:bg-brand-500/10">
          <p className="text-sm font-medium text-gray-900 dark:text-white">Copy this key now. It will not be shown again.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-white px-3 py-2 font-mono text-xs text-gray-900 dark:bg-gray-900 dark:text-white">
              {created.secret}
            </code>
            <button type="button" onClick={copySecret} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <form onSubmit={onCreate} className="panel-card panel-card-body flex flex-col gap-3 sm:flex-row">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Key name, for example Cursor"
          className="h-10 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white"
        />
        <button type="submit" className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600">
          Create key
        </button>
      </form>

      <div className="panel-card mt-4 overflow-hidden">
        {keys.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">No router keys yet.</p>
        ) : (
          <ul>
            {keys.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 last:border-0 dark:border-gray-800">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{item.name}</p>
                  <p className="font-mono text-xs text-gray-500">{item.prefix}</p>
                </div>
                <button type="button" onClick={() => onDelete(item.id)} className="text-sm font-medium text-error-500 hover:underline">
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
