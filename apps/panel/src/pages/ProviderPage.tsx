import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { ModalityFlow } from "@/components/modalities";
import { ProviderMark } from "@/components/provider-mark";
import {
  createAccount,
  deleteAccount,
  formatPrice,
  formatTokens,
  getProvider,
  listAccounts,
  listProviderModels,
  loadProviderModels,
  setModelActive,
  testProvider,
  updateAccount,
  updateProvider,
  type Model,
  type Provider,
  type ProviderAccount,
} from "@/lib/api";
import { providersListPath, readModelSearch, writeModelSearch } from "@/lib/provider-list-view";
import { ArrowLeft, ExternalLink, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

const MODEL_PAGE = 24;

export default function ProviderPage() {
  const { slug = "" } = useParams();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [modelTotal, setModelTotal] = useState(0);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsPaging, setModelsPaging] = useState(false);
  const remembered = useRef(readModelSearch(slug));
  const restoreModelScroll = useRef(remembered.current.scroll);
  const [query, setQuery] = useState(remembered.current.q);
  const [debounced, setDebounced] = useState(remembered.current.q);
  const [modelReload, setModelReload] = useState(0);
  const [baseUrl, setBaseUrl] = useState("");
  const [strategy, setStrategy] = useState("fill-first");
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [accountName, setAccountName] = useState("");
  const [accountKey, setAccountKey] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const generation = useRef(0);

  useEffect(() => {
    let cancel = false;
    getProvider(slug)
      .then((nextProvider) => {
        if (cancel) return;
        setProvider(nextProvider);
        setBaseUrl(nextProvider.baseUrl);
        setStrategy(nextProvider.accountStrategy || "fill-first");
        setEnabled(nextProvider.enabled);
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      });
    return () => {
      cancel = true;
    };
  }, [slug]);

  useEffect(() => {
    let cancel = false;
    listAccounts(slug)
      .then((page) => {
        if (!cancel) setAccounts(page.accounts);
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      });
    return () => {
      cancel = true;
    };
  }, [slug, provider?.accountCount]);

  useEffect(() => {
    const next = readModelSearch(slug);
    remembered.current = next;
    setQuery(next.q);
    setDebounced(next.q);
  }, [slug]);

  useEffect(() => {
    const current = readModelSearch(slug);
    if (current.q !== debounced) restoreModelScroll.current = 0;
    writeModelSearch(slug, debounced, current.q === debounced ? current.scroll : 0);
    const main = document.querySelector("main");
    if (!main) return;
    const onScroll = () => writeModelSearch(slug, debounced, main.scrollTop);
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, [debounced, slug]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const request = ++generation.current;
    setModelsLoading(true);
    setModelsPaging(false);
    listProviderModels(slug, { q: debounced, limit: MODEL_PAGE, offset: 0 })
      .then((page) => {
        if (generation.current !== request) return;
        setModels(page.models);
        setModelTotal(page.total);
      })
      .catch((err: Error) => {
        if (generation.current === request) setError(err.message);
      })
      .finally(() => {
        if (generation.current !== request) return;
        setModelsLoading(false);
      });
  }, [slug, debounced, modelReload]);

  useEffect(() => {
    const top = restoreModelScroll.current;
    if (!top || modelsLoading || models.length === 0) return;
    const main = document.querySelector("main");
    if (!main) return;
    const frame = requestAnimationFrame(() => {
      if (restoreModelScroll.current <= 0) return;
      main.scrollTop = restoreModelScroll.current;
      if (main.scrollTop > 0) restoreModelScroll.current = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [modelsLoading, models.length]);

  useEffect(() => {
    const node = bottomRef.current;
    if (!node || modelsLoading || models.length === 0 || models.length >= modelTotal) return;
    const root = node.closest("main");
    const request = generation.current;
    let started = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (started || !entries.some((entry) => entry.isIntersecting)) return;
        started = true;
        observer.disconnect();
        setModelsPaging(true);
        listProviderModels(slug, { q: debounced, limit: MODEL_PAGE, offset: models.length })
          .then((page) => {
            if (generation.current !== request) return;
            setModels((current) => appendModels(current, page.models));
            setModelTotal(page.total);
          })
          .catch((err: Error) => {
            if (generation.current === request) setError(err.message);
          })
          .finally(() => {
            if (generation.current === request) setModelsPaging(false);
          });
      },
      { root, rootMargin: "280px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [debounced, modelTotal, models.length, modelsLoading, slug]);

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await updateProvider(slug, { baseUrl, enabled, accountStrategy: strategy });
      setProvider(next);
      setNotice("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await testProvider(slug, { baseUrl, accountId: accounts.find((account) => account.enabled)?.id });
      setNotice(`Key works. OpenAI listed ${result.upstreamModels} models.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadModels() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await loadProviderModels(slug, { baseUrl });
      const nextProvider = await getProvider(slug);
      setProvider(nextProvider);
      setModelReload((current) => current + 1);
      setNotice(`Loaded ${result.models} models.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load models");
    } finally {
      setBusy(false);
    }
  }

  async function addAccount() {
    if (!accountKey.trim()) {
      setError(provider?.category === "Web Cookie" ? "Paste a session cookie." : "Paste an API key.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await createAccount(slug, {
        name: accountName.trim() || undefined,
        apiKey: accountKey.trim(),
        priority: accounts.length,
      });
      setAccountName("");
      setAccountKey("");
      const nextProvider = await getProvider(slug);
      setProvider(nextProvider);
      setAccounts((await listAccounts(slug)).accounts);
      setNotice("Account added.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add account");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAccount(account: ProviderAccount) {
    setError("");
    try {
      const next = await updateAccount(slug, account.id, { enabled: !account.enabled });
      setAccounts((current) => current.map((item) => (item.id === next.id ? next : item)));
      setProvider(await getProvider(slug));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update account");
    }
  }

  async function removeAccount(account: ProviderAccount) {
    setError("");
    setNotice("");
    try {
      await deleteAccount(slug, account.id);
      setAccounts((current) => current.filter((item) => item.id !== account.id));
      setProvider(await getProvider(slug));
      setNotice("Account removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove account");
    }
  }

  async function testAccount(account: ProviderAccount) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await testProvider(slug, { baseUrl, accountId: account.id });
      setNotice(`${account.name} works. OpenAI listed ${result.upstreamModels} models.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(model: Model) {
    setError("");
    try {
      const next = await setModelActive(slug, model.upstreamId, !model.active);
      setModels((current) => current.map((item) => (item.id === next.id ? next : item)));
      setProvider((current) =>
        current
          ? {
              ...current,
              activeModels: current.activeModels + (next.active ? 1 : -1),
            }
          : current,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update model");
    }
  }

  if (!provider && !error) {
    return <p className="text-sm text-gray-500">Loading provider…</p>;
  }

  return (
    <div>
      <Link to={providersListPath()} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" />
        Providers
      </Link>
      <PanelPageHeader
        title={provider?.displayName ?? "Provider"}
        leading={provider ? <ProviderMark slug={provider.slug} name={provider.displayName} /> : undefined}
        actions={
          provider?.docsUrl ? (
            <a
              href={provider.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"
            >
              Docs
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null
        }
      />
      {error && <p className="mb-4 text-sm text-error-500">{error}</p>}
      {notice && <p className="mb-4 text-sm text-success-600">{notice}</p>}

      <section className="panel-card panel-card-body">
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-gray-700 dark:text-gray-200">Base URL</span>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 font-mono text-sm text-gray-900 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-gray-700 dark:text-gray-200">Account order</span>
            <select
              value={strategy}
              onChange={(event) => setStrategy(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white"
            >
              <option value="fill-first">Fill first — use the lowest priority until it fails</option>
              <option value="round-robin">Round robin — spread calls across accounts</option>
            </select>
          </label>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Provider enabled
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60">
            Save
          </button>
          <button type="button" onClick={test} disabled={busy} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5">
            Test connection
          </button>
          <button type="button" onClick={loadModels} disabled={busy} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5">
            Load models
          </button>
        </div>
      </section>

      <section className="panel-card panel-card-body mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Accounts</h2>
          <p className="text-xs text-gray-500">{accounts.length} saved</p>
        </div>
        <div className="mt-4 space-y-2">
          {accounts.length === 0 ? (
            <p className="text-sm text-gray-500">
              {provider?.keyOptional ? "No account yet. This provider can run without one." : "No account yet."}
            </p>
          ) : (
            accounts.map((account) => (
              <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{account.name}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <label className="inline-flex items-center gap-1">
                      Priority
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        defaultValue={account.priority}
                        key={`${account.id}-${account.priority}`}
                        onBlur={(event) => {
                          const priority = Number(event.target.value);
                          if (!Number.isFinite(priority) || priority === account.priority) return;
                          updateAccount(slug, account.id, { priority })
                            .then((next) => {
                              setAccounts((current) =>
                                current.map((item) => (item.id === next.id ? next : item)).sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt)),
                              );
                            })
                            .catch((err: Error) => setError(err.message));
                        }}
                        className="h-7 w-16 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-900 dark:border-gray-700 dark:bg-white/5 dark:text-white"
                      />
                    </label>
                    {account.apiKeyHint ? <span>{account.apiKeyHint}</span> : null}
                    {account.lastUsedAt ? <span>used {account.lastUsedAt.slice(0, 16).replace("T", " ")}</span> : null}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => toggleAccount(account)} className={`rounded-full px-3 py-1 text-xs font-medium ${account.enabled ? "bg-brand-500 text-white" : "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300"}`}>
                    {account.enabled ? "On" : "Off"}
                  </button>
                  <button type="button" onClick={() => testAccount(account)} disabled={busy} className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200">
                    Test
                  </button>
                  <button type="button" onClick={() => removeAccount(account)} className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 dark:border-gray-700 dark:text-gray-200">
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.4fr_auto] lg:items-end">
          <label className="block text-sm">
            <span className="font-medium text-gray-700 dark:text-gray-200">Name</span>
            <input
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              placeholder={`Account ${accounts.length + 1}`}
              className="mt-1.5 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-gray-700 dark:text-gray-200">
              {provider?.category === "Web Cookie" ? "Session cookie" : "API key"}
            </span>
            <input
              type="password"
              value={accountKey}
              onChange={(event) => setAccountKey(event.target.value)}
              placeholder={provider?.category === "Web Cookie" ? "Paste the session cookie" : "sk-..."}
              autoComplete="off"
              className="mt-1.5 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 font-mono text-sm text-gray-900 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white"
            />
          </label>
          <button type="button" onClick={addAccount} disabled={busy} className="h-10 rounded-lg bg-brand-500 px-3 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60">
            Add account
          </button>
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Models</h2>
          <label className="relative block w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models"
              className="h-10 w-full rounded-lg border border-gray-200 bg-white pr-9 pl-9 text-sm text-gray-900 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-gray-400 hover:text-gray-700 dark:hover:text-white"
                aria-label="Clear model search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
        </div>
        <p className="mb-3 text-sm text-gray-500">
          {models.length} of {modelTotal}
        </p>
        <div className="panel-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="border-b border-gray-200 text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800">
                <tr>
                  <th className="w-[34%] px-4 py-3 font-medium">Model</th>
                  <th className="w-[26%] px-4 py-3 font-medium">Input → output</th>
                  <th className="w-[14%] px-4 py-3 font-medium">Context</th>
                  <th className="w-[16%] px-4 py-3 font-medium">Price / 1M</th>
                  <th className="w-[10%] px-4 py-3 font-medium">Active</th>
                </tr>
              </thead>
              <tbody>
                {modelsLoading && models.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-sm text-gray-500">
                      Loading models…
                    </td>
                  </tr>
                ) : models.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-sm text-gray-500">
                      {debounced ? "No models match that search." : "This provider has no models yet."}
                    </td>
                  </tr>
                ) : null}
                {models.map((model) => {
                  const blurb = modelNote(model.description);
                  return (
                  <tr key={model.id} className="border-b border-gray-100 last:border-0 dark:border-gray-800">
                    <td className="max-w-0 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <p title={model.displayName} className="truncate font-medium text-gray-900 dark:text-white">
                          {model.displayName}
                        </p>
                        {model.kind && model.kind !== "chat" && (
                          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:bg-white/10 dark:text-gray-300">
                            {model.kind}
                          </span>
                        )}
                      </div>
                      <p title={model.id} className="truncate font-mono text-xs text-gray-500">{model.id}</p>
                      {blurb && (
                        <p title={blurb} className="mt-1 truncate text-xs text-gray-500">
                          {blurb}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ModalityFlow inputs={model.inputs} outputs={model.outputs} />
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {formatTokens(model.contextWindow)}
                      <span className="block text-xs text-gray-400">out {formatTokens(model.maxOutputTokens)}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {model.inputUsdPerMillion || model.outputUsdPerMillion || model.contextWindow ? (
                        <>
                          {formatPrice(model.inputUsdPerMillion)} in
                          <span className="block">{formatPrice(model.outputUsdPerMillion)} out</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        aria-pressed={model.active}
                        onClick={() => toggle(model)}
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          model.active
                            ? "bg-brand-500 text-white"
                            : "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300"
                        }`}
                      >
                        {model.active ? "On" : "Off"}
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div ref={bottomRef} className="h-8" />
        {modelsPaging && <p className="text-sm text-gray-500">Loading more models…</p>}
      </section>
    </div>
  );
}

function modelNote(description: string) {
  const text = description.trim();
  if (!text || text === "Loaded from the provider." || /^.+ model$/i.test(text)) return "";
  return text;
}

function appendModels(current: Model[], next: Model[]) {
  const seen = new Set(current.map((model) => model.id));
  const added = next.filter((model) => !seen.has(model.id));
  return added.length === 0 ? current : [...current, ...added];
}
