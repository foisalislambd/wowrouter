import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { DangerButton, EmptyState, useToast } from "@/components/ui/feedback";
import { PageTabs, routeTabs } from "@/components/ui/page-tabs";
import { deleteFallback, listActiveModels, listFallbacks, saveFallback, type FallbackChain, type Model } from "@/lib/api";
import { useEffect, useMemo, useState, type FormEvent } from "react";

const strategies = [
  { id: "priority", label: "Priority", detail: "Try the list from the top. The next model runs only if the earlier one fails." },
  { id: "round-robin", label: "Round robin", detail: "Start at the next model on each call, then continue down the list if that one fails." },
  { id: "weighted", label: "Weighted", detail: "Start on a model more often when its weight is higher, then fall through the rest." },
  { id: "cost", label: "Cheapest", detail: "Try the lowest catalog price first." },
  { id: "least-used", label: "Least used", detail: "Start with the model that has the fewest logged calls." },
  { id: "fill-first", label: "Fill first", detail: "Skip models that are cooling down or out of requests, then keep the saved order." },
  { id: "headroom", label: "Headroom", detail: "Prefer the model with the largest share of its limit left. Unknown limits stay in the saved order." },
  { id: "reset-window", label: "Reset window", detail: "Prefer the model whose limit resets sooner." },
  { id: "quota-weighted", label: "Quota weighted", detail: "Start more often on models that have more requests left." },
  { id: "quota-share", label: "Quota share", detail: "Spread calls across models. A model that already used its local share waits behind the others." },
];

const autos = [
  ["auto", "Balance price, recent speed, errors, and context."],
  ["auto/coding", "Prefer reasoning models and a long context."],
  ["auto/fast", "Prefer models that have been answering quickly."],
  ["auto/cheap", "Prefer the lowest catalog price."],
];

export default function FallbackPage() {
  const [chains, setChains] = useState<FallbackChain[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [name, setName] = useState("");
  const [strategy, setStrategy] = useState("priority");
  const [picked, setPicked] = useState<string[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    listFallbacks()
      .then((result) => setChains(result.fallbacks))
      .catch((err: Error) => setError(err.message));
    listActiveModels()
      .then((result) =>
        setModels(result.models.filter((item) => (item.kind === "" || item.kind === "chat") && !item.id.startsWith("fallback/") && !item.id.startsWith("auto"))),
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

  const selected = strategies.find((item) => item.id === strategy) ?? strategies[0];

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const saved = await saveFallback(
        name.trim(),
        picked,
        strategy,
        picked.map((id) => weights[id] || 1),
      );
      setChains((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setName("");
      setPicked([]);
      setWeights({});
      setQuery("");
      toast("Combo saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save combo");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setError("");
    await deleteFallback(id);
    setChains((current) => current.filter((item) => item.id !== id));
  }

  async function onDuplicate(chain: FallbackChain) {
    const saved = await saveFallback(`${chain.name} copy`, chain.models, chain.strategy, chain.weights?.length ? chain.weights : chain.models.map(() => 1));
    setChains((current) => [saved, ...current]);
    toast("Combo duplicated");
  }

  return (
    <div>
      <PanelPageHeader title="Routing" />
      <PageTabs tabs={routeTabs} />
      {error && <p className="mb-4 text-sm text-error-500">{error}</p>}
      <section className="panel-card panel-card-body mb-4">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Auto</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          No setup. Set the model to one of these ids. WowRouter ranks chat models that are turned on, with a saved key, and tries up to four.
        </p>
        <ul className="mt-3 space-y-2">
          {autos.map(([id, detail]) => (
            <li key={id} className="text-sm">
              <span className="font-mono text-xs text-brand-500">{id}</span>
              <span className="mt-0.5 block text-gray-600 dark:text-gray-300">{detail}</span>
            </li>
          ))}
        </ul>
      </section>
      <form onSubmit={onSave} className="panel-card panel-card-body mb-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Combo</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">A named list you call as <span className="font-mono text-xs">fallback/name</span>. If the first try fails, the next model in the order runs.</p>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name, for example Daily"
          className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white"
        />
        <label className="block text-sm text-gray-700 dark:text-gray-200">
          Order
          <select
            value={strategy}
            onChange={(event) => setStrategy(event.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          >
            {strategies.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <p className="text-xs text-gray-500">{selected.detail}</p>
        {picked.length > 0 && (
          <ol className="space-y-2">
            {picked.map((id, index) => (
              <li key={id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                <span className="font-mono text-xs">{index + 1}. {id}</span>
                <span className="flex items-center gap-2">
                  {strategy === "weighted" && (
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={weights[id] ?? 1}
                      onChange={(event) => setWeights((current) => ({ ...current, [id]: Number(event.target.value) }))}
                      className="h-8 w-16 rounded border border-gray-200 bg-white px-2 text-xs dark:border-gray-700 dark:bg-white/5"
                      aria-label={`Weight for ${id}`}
                    />
                  )}
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
          Save combo
        </button>
      </form>
      <div className="panel-card overflow-hidden">
        {chains.length === 0 ? (
          <EmptyState title="No combos yet" body="Auto still works without one. Add two or more active chat models to build a fallback list." />
        ) : (
          <ul>
            {chains.map((chain) => (
              <li key={chain.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 last:border-0 dark:border-gray-800">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{chain.name}</p>
                  <p className="mt-1 font-mono text-xs text-brand-500">{chain.modelId}</p>
                  <p className="mt-1 text-xs text-gray-500">{labelFor(chain.strategy)} · {chain.models.join(" → ")}</p>
                </div>
                <div className="flex gap-3">
                  <button type="button" className="text-sm text-brand-600" onClick={() => onDuplicate(chain).catch((err: Error) => setError(err.message))}>Duplicate</button>
                  <DangerButton label="Delete" title={`Delete ${chain.name}?`} body="Clients using this combo id fall back to a missing model." onConfirm={() => onDelete(chain.id)} />
                </div>
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

function labelFor(strategy: string) {
  return strategies.find((item) => item.id === strategy)?.label ?? "Priority";
}
