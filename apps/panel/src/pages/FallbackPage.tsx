import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { deleteFallback, listActiveModels, listFallbacks, saveFallback, type FallbackChain, type Model } from "@/lib/api";
import { useEffect, useMemo, useState, type FormEvent } from "react";

export default function FallbackPage() {
  const [chains, setChains] = useState<FallbackChain[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listFallbacks()
      .then((result) => setChains(result.fallbacks))
      .catch((err: Error) => setError(err.message));
    listActiveModels()
      .then((result) =>
        setModels(result.models.filter((item) => (item.kind === "" || item.kind === "chat") && !item.id.startsWith("fallback/"))),
      )
      .catch((err: Error) => setError(err.message));
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return models
      .filter((item) => !picked.includes(item.id))
      .filter((item) => !needle || `${item.displayName} ${item.id}`.toLowerCase().includes(needle))
      .slice(0, 12);
  }, [models, picked, query]);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const saved = await saveFallback(name.trim(), picked);
      setChains((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setName("");
      setPicked([]);
      setQuery("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save fallback");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setError("");
    try {
      await deleteFallback(id);
      setChains((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete fallback");
    }
  }

  return (
    <div>
      <PanelPageHeader
        title="Fallback"
      />
      {error && <p className="mb-4 text-sm text-error-500">{error}</p>}
      <form onSubmit={onSave} className="panel-card panel-card-body mb-4 space-y-3">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name, for example Daily"
          className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white"
        />
        {picked.length > 0 && (
          <ol className="space-y-2">
            {picked.map((id, index) => (
              <li key={id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                <span className="font-mono text-xs">{index + 1}. {id}</span>
                <span className="flex gap-2">
                  <button type="button" className="text-xs text-gray-500" onClick={() => move(index, -1)} disabled={index === 0}>Up</button>
                  <button type="button" className="text-xs text-gray-500" onClick={() => move(index, 1)} disabled={index === picked.length - 1}>Down</button>
                  <button type="button" className="text-xs text-error-500" onClick={() => setPicked((current) => current.filter((item) => item !== id))}>Remove</button>
                </span>
              </li>
            ))}
          </ol>
        )}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search active chat models"
          className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white"
        />
        {matches.length > 0 && (
          <div className="max-h-48 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
            {matches.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPicked((current) => [...current, item.id])}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-white/5"
              >
                <span className="block text-gray-900 dark:text-white">{item.displayName}</span>
                <span className="font-mono text-xs text-gray-500">{item.id}</span>
              </button>
            ))}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || picked.length < 2 || !name.trim()}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
        >
          Save fallback
        </button>
      </form>
      <div className="panel-card overflow-hidden">
        {chains.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">No fallbacks yet.</p>
        ) : (
          <ul>
            {chains.map((chain) => (
              <li key={chain.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 last:border-0 dark:border-gray-800">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{chain.name}</p>
                  <p className="mt-1 font-mono text-xs text-brand-500">{chain.modelId}</p>
                  <p className="mt-1 text-xs text-gray-500">{chain.models.join(" → ")}</p>
                </div>
                <button type="button" onClick={() => onDelete(chain.id)} className="text-sm text-error-500">
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  function move(index: number, delta: number) {
    setPicked((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  }
}
