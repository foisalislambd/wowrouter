import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { DangerButton, EmptyState, ErrorNote, useToast } from "@/components/ui/feedback";
import { keyTabs, PageTabs } from "@/components/ui/page-tabs";
import { createKey, deleteKey, listKeys, type CreatedKey, type RouterKey } from "@/lib/api";
import { Check, Copy } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

export default function KeysPage() {
  const [keys, setKeys] = useState<RouterKey[]>([]);
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

  useEffect(() => {
    listKeys()
      .then((result) => setKeys(result.keys))
      .catch((err: Error) => setError(err.message));
  }, []);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const monthly = budget.trim() === "" ? undefined : Number(budget);
      if (monthly !== undefined && (!Number.isFinite(monthly) || monthly <= 0)) {
        setError("Monthly budget must be greater than zero, or leave it empty.");
        return;
      }
      const next = await createKey(name.trim(), monthly);
      setCreated(next);
      setName("");
      setBudget("");
      setKeys((current) => [next, ...current]);
      toast("Router key created. Copy it now.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create key");
    }
  }

  async function onDelete(id: string) {
    setError("");
    await deleteKey(id);
    setKeys((current) => current.filter((item) => item.id !== id));
  }

  async function copySecret() {
    if (!created) return;
    await navigator.clipboard.writeText(created.secret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <PanelPageHeader title="API keys" />
      <PageTabs tabs={keyTabs} />
      <ErrorNote>{error}</ErrorNote>
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
        <input
          value={budget}
          onChange={(event) => setBudget(event.target.value)}
          inputMode="decimal"
          placeholder="Monthly USD cap, optional"
          className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand-400 sm:w-56 dark:border-gray-700 dark:bg-white/5 dark:text-white"
        />
        <button type="submit" className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600">
          Create key
        </button>
      </form>

      <div className="panel-card mt-4 overflow-hidden">
        {keys.length === 0 ? (
          <EmptyState title="No router keys yet" body="Create a key and paste it as the OpenAI API key in your coding agent. Leave the base URL as the endpoint on Overview." />
        ) : (
          <ul>
            {keys.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 last:border-0 dark:border-gray-800">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{item.name}</p>
                  <p className="font-mono text-xs text-gray-500">{item.prefix}</p>
                  <p className="text-xs text-gray-500">
                    {item.monthlyBudgetUsd
                      ? `$${item.monthSpendUsd.toFixed(4)} of $${item.monthlyBudgetUsd.toFixed(2)} this month`
                      : `$${item.monthSpendUsd.toFixed(4)} this month · no cap`}
                  </p>
                </div>
                <DangerButton label="Revoke" title={`Revoke ${item.name}?`} body="Clients using this key stop working. This does not delete the provider key." onConfirm={() => onDelete(item.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
