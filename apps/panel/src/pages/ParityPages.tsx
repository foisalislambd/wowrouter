import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { MarkdownView } from "@/components/markdown-view";
import { DangerButton, EmptyState, ErrorNote, LoadingBlock } from "@/components/ui/feedback";
import { activityTabs, agentTabs, costTabs, endpointTabs, healthTabs, keyTabs, localTabs, PageTabs, routeTabs, type PageTab } from "@/components/ui/page-tabs";
import {
  addAgentNote,
  addBookmark,
  addEval,
  addSkill,
  addTeam,
  addWebhook,
  auditLogs,
  cacheStats,
  catalogModels,
  changelogText,
  clearCache,
  consoleLines,
  costReport,
  deleteAgentNote,
  deleteBookmark,
  deleteEval,
  deleteSkill,
  deleteTeam,
  deleteWebhook,
  endpointList,
  freeProviders,
  getGuards,
  healthDetail,
  listAgentNotes,
  listBookmarks,
  listEvals,
  listSkills,
  listTeams,
  listWebhooks,
  localBatches,
  localFiles,
  onboardingSteps,
  previewCompression,
  quotaSlots,
  runEval,
  saveGuards,
  translateBody,
  type CatalogModel,
  type Guards,
} from "@/lib/api";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

function Frame({ title, children, tabs, actions }: { title: string; children: ReactNode; tabs?: PageTab[]; actions?: ReactNode }) {
  return (
    <div>
      <PanelPageHeader title={title} actions={actions} />
      {tabs && <PageTabs tabs={tabs} />}
      {children}
    </div>
  );
}

function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    loader()
      .then((next) => {
        if (!cancel) {
          setData(next);
          setError("");
        }
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return { data, error, loading, setError, reload: () => setTick((value) => value + 1) };
}

const field = "mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white";
const button = "rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60";

export function ModelsPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [query, setQuery] = useState(params.get("q") ?? "");
  const kind = params.get("kind") ?? "";
  const sort = params.get("sort") ?? "name";
  const page = Math.max(1, Number(params.get("page") || "1"));
  const limit = 20;
  const { data, error, loading } = useLoad(() => catalogModels({ q: query, kind, sort: sort === "name" ? "" : sort, limit, offset: (page - 1) * limit }), [query, kind, sort, page]);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(q.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [q]);
  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  }
  const total = data?.total ?? 0;
  return (
    <Frame title="Models">
      <ErrorNote>{error}</ErrorNote>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input value={q} onChange={(event) => { setQ(event.target.value); setParam("q", event.target.value); }} placeholder="Search models" aria-label="Search models" className={field + " max-w-md"} />
        <select aria-label="Kind" value={kind} onChange={(event) => setParam("kind", event.target.value)} className={field + " sm:w-40"}>
          <option value="">All kinds</option>
          <option value="chat">Chat</option>
          <option value="search">Search</option>
          <option value="image">Image</option>
          <option value="embedding">Embedding</option>
        </select>
        <select aria-label="Sort" value={sort} onChange={(event) => setParam("sort", event.target.value)} className={field + " sm:w-40"}>
          <option value="name">Name</option>
          <option value="price">Price</option>
          <option value="provider">Provider</option>
        </select>
      </div>
      {loading ? <LoadingBlock label="Loading models…" /> : <ModelTable models={data?.models ?? []} />}
      <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
        <span>{total} models</span>
        <div className="flex gap-2">
          <button type="button" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))} className="rounded-lg border border-gray-200 px-3 py-1 disabled:opacity-40 dark:border-gray-700">Previous</button>
          <button type="button" disabled={page * limit >= total} onClick={() => setParam("page", String(page + 1))} className="rounded-lg border border-gray-200 px-3 py-1 disabled:opacity-40 dark:border-gray-700">Next</button>
        </div>
      </div>
    </Frame>
  );
}

function ModelTable({ models }: { models: CatalogModel[] }) {
  return (
    <div className="panel-card overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-gray-500">
          <tr>
            <th className="px-3 py-2">Model</th>
            <th className="px-3 py-2">Kind</th>
            <th className="px-3 py-2">Price / M</th>
            <th className="px-3 py-2">State</th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => (
            <tr key={model.id} className="border-t border-gray-100 dark:border-gray-800">
              <td className="px-3 py-2">
                <p className="font-medium text-gray-900 dark:text-white">{model.displayName}</p>
                <p className="font-mono text-xs text-gray-500">{model.id}</p>
              </td>
              <td className="px-3 py-2">{model.kind}</td>
              <td className="px-3 py-2">{model.inputUsdPerMillion} / {model.outputUsdPerMillion}</td>
              <td className="px-3 py-2">{model.active ? "On" : "Off"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {models.length === 0 && <p className="px-3 py-4 text-sm text-gray-500">No models match.</p>}
    </div>
  );
}

export function QuotaPage() {
  const { data, error } = useLoad(() => quotaSlots());
  return (
    <Frame title="Quota" tabs={routeTabs}>
      {error && <p className="text-sm text-error-500">{error}</p>}
      <div className="grid gap-3">
        {(data?.slots ?? []).map((slot) => (
          <section key={slot.slot} className="panel-card panel-card-body text-sm">
            <p className="font-mono text-gray-900 dark:text-white">{slot.slot}</p>
            <p className="mt-1 text-gray-600 dark:text-gray-300">Remaining {slot.remaining} of {slot.limit}. Reset {slot.resetUnix || "unknown"}. Cooldown until {slot.cooldownUntil || "none"}.</p>
          </section>
        ))}
        {data && data.slots.length === 0 && <EmptyState title="No quota headers yet" body="A slot appears after a provider response includes rate-limit headers. Combo strategies then read this list." />}
      </div>
    </Frame>
  );
}

export function EndpointsPage() {
  const { data, error } = useLoad(() => endpointList());
  return (
    <Frame title="Endpoints" tabs={endpointTabs}>
      {error && <p className="text-sm text-error-500">{error}</p>}
      <p className="mb-3 font-mono text-sm text-gray-800 dark:text-gray-100">{data?.base}</p>
      <div className="grid gap-2">
        {(data?.routes ?? []).map((route) => (
          <div key={route.path} className="panel-card panel-card-body flex flex-wrap items-center gap-3 text-sm">
            <span className="font-mono text-xs text-brand-600">{route.method}</span>
            <span className="font-mono text-gray-900 dark:text-white">{route.path}</span>
            <span className="text-gray-500">{route.use}</span>
          </div>
        ))}
      </div>
    </Frame>
  );
}

export function TranslatorPage() {
  const [direction, setDirection] = useState("openai-to-anthropic");
  const [text, setText] = useState('{"model":"m","messages":[{"role":"user","content":"hi"}]}');
  const [out, setOut] = useState("");
  const [error, setError] = useState("");
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await translateBody(direction, JSON.parse(text));
      setOut(JSON.stringify(result.body, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not translate");
    }
  }
  return (
    <Frame title="Translator" tabs={endpointTabs}>
      <form onSubmit={onSubmit} className="panel-card panel-card-body space-y-3">
        <select value={direction} onChange={(event) => setDirection(event.target.value)} className={field}>
          <option value="openai-to-anthropic">OpenAI to Anthropic</option>
          <option value="anthropic-to-openai">Anthropic to OpenAI</option>
        </select>
        <textarea value={text} onChange={(event) => setText(event.target.value)} className={field + " min-h-32 py-2 font-mono"} />
        <button className={button} type="submit">Convert</button>
        {error && <p className="text-sm text-error-500">{error}</p>}
        {out && <pre className="overflow-x-auto text-xs text-gray-800 dark:text-gray-100">{out}</pre>}
      </form>
    </Frame>
  );
}

export function HealthPage() {
  const { data, error } = useLoad(() => healthDetail());
  return (
    <Frame title="Health" tabs={healthTabs}>
      {error && <p className="text-sm text-error-500">{error}</p>}
      {data && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label="Status" value={data.status} />
          <Stat label="Uptime" value={`${data.uptimeSec}s`} />
          <Stat label="Go" value={data.go} />
          <Stat label="Memory" value={`${data.allocMb} MB`} />
          <Stat label="Listen" value={data.addr || "—"} />
          <Stat label="Data" value={data.dataDir || "—"} />
          <Stat label="Logs" value={String(data.logs)} />
          <Stat label="Active models" value={String(data.activeModels)} />
        </div>
      )}
      <h2 className="mt-6 mb-2 text-sm font-semibold">Calls by provider</h2>
      {(data?.providersStats ?? []).map((row) => (
        <p key={row.provider} className="text-sm text-gray-600 dark:text-gray-300">{row.provider}: {row.requests} calls, {row.errors} errors</p>
      ))}
    </Frame>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <section className="panel-card panel-card-body">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 break-all text-sm font-medium text-gray-900 dark:text-white">{value}</p>
    </section>
  );
}

export function ChaosPage() {
  const { data, error, setError, reload } = useLoad(() => getGuards());
  const [form, setForm] = useState<Guards | null>(null);
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);
  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setError("");
    try {
      await saveGuards(form);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }
  if (!form) return <Frame title="Chaos">{error ? <p className="text-sm text-error-500">{error}</p> : <LoadingBlock />}</Frame>;
  return (
    <Frame title="Chaos" tabs={healthTabs}>
      <form onSubmit={onSave} className="panel-card panel-card-body space-y-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.chaos} onChange={(event) => setForm({ ...form, chaos: event.target.checked })} /> Enable chaos</label>
        <label>Fail percent <input type="number" min={0} max={100} value={form.chaosFailPercent} onChange={(event) => setForm({ ...form, chaosFailPercent: Number(event.target.value) })} className={field} /></label>
        <label>Delay milliseconds <input type="number" min={0} max={2000} value={form.chaosDelayMs} onChange={(event) => setForm({ ...form, chaosDelayMs: Number(event.target.value) })} className={field} /></label>
        {error && <p className="text-error-500">{error}</p>}
        <button className={button} type="submit">Save chaos</button>
      </form>
    </Frame>
  );
}

export function ProxyPage() {
  const { data, error, setError, reload } = useLoad(() => getGuards());
  const [proxy, setProxy] = useState("");
  useEffect(() => {
    if (data) setProxy(data.upstreamProxy);
  }, [data]);
  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!data) return;
    setError("");
    try {
      await saveGuards({ ...data, upstreamProxy: proxy });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }
  return (
    <Frame title="Upstream proxy" tabs={healthTabs}>
      <form onSubmit={onSave} className="panel-card panel-card-body space-y-3">
        <input value={proxy} onChange={(event) => setProxy(event.target.value)} placeholder="http://127.0.0.1:8888" className={field} />
        {error && <p className="text-sm text-error-500">{error}</p>}
        <button className={button} type="submit">Save proxy</button>
      </form>
    </Frame>
  );
}

export function ConsolePage() {
  const { data, error, reload } = useLoad(() => consoleLines());
  return (
    <Frame title="Console" tabs={healthTabs}>
      {error && <p className="text-sm text-error-500">{error}</p>}
      <button type="button" onClick={reload} className={button}>Refresh</button>
      <pre className="panel-card panel-card-body mt-3 overflow-x-auto text-xs">{(data?.lines ?? []).join("\n") || "No events yet."}</pre>
    </Frame>
  );
}

export function CostsPage() {
  const { data, error } = useLoad(() => costReport());
  return (
    <Frame title="Costs" tabs={costTabs}>
      {error && <p className="text-sm text-error-500">{error}</p>}
      <p className="mb-3 text-sm font-medium">Recorded spend ${data?.totalUsd.toFixed(4) ?? "0"}</p>
      {(data?.byModel ?? []).map((row) => (
        <p key={row.modelId} className="text-sm text-gray-600 dark:text-gray-300">{row.modelId}: {row.requests} calls, ${row.costUsd.toFixed(4)}</p>
      ))}
    </Frame>
  );
}

export function PricingPage() {
  const { data, error } = useLoad(() => catalogModels({ limit: 40, priced: true }));
  return (
    <Frame title="Pricing" tabs={costTabs}>
      {error && <p className="text-sm text-error-500">{error}</p>}
      <ModelTable models={data?.models ?? []} />
    </Frame>
  );
}

export function FreePage() {
  const { data, error } = useLoad(() => freeProviders());
  return (
    <Frame title="Free tiers" tabs={costTabs}>
      {error && <p className="text-sm text-error-500">{error}</p>}
      <div className="grid gap-3">
        {(data?.providers ?? []).slice(0, 40).map((provider) => (
          <Link key={provider.slug} to={`/providers/${provider.slug}`} className="panel-card panel-card-body block">
            <p className="font-medium text-gray-900 dark:text-white">{provider.name}</p>
            <p className="text-xs text-gray-500">{provider.category}</p>
            <p className="mt-1 line-clamp-2 text-sm text-gray-600 dark:text-gray-300">{provider.summary}</p>
          </Link>
        ))}
      </div>
    </Frame>
  );
}

export function TeamsPage() {
  const { data, error, setError, reload } = useLoad(() => listTeams());
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [keyId, setKeyId] = useState("");
  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await addTeam(name, budget ? Number(budget) : null, keyId ? [keyId] : []);
      setName("");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }
  return (
    <Frame title="Teams" tabs={costTabs}>
      {error && <p className="mb-3 text-sm text-error-500">{error}</p>}
      <form onSubmit={onAdd} className="panel-card panel-card-body mb-4 grid gap-2 sm:grid-cols-4">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Team name" className={field} />
        <input value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="Monthly USD" className={field} />
        <input value={keyId} onChange={(event) => setKeyId(event.target.value)} placeholder="Router key id" className={field} />
        <button className={button} type="submit">Add team</button>
      </form>
      {(data?.teams ?? []).map((team) => (
        <section key={team.id} className="panel-card panel-card-body mb-2 flex items-center justify-between text-sm">
          <div>
            <p className="font-medium">{team.name}</p>
            <p className="text-gray-500">Cap {team.monthlyBudgetUsd ?? "none"} · keys {team.keyIds.join(", ") || "none"}</p>
          </div>
          <DangerButton label="Delete" title={`Delete ${team.name}?`} body="Member keys keep working, but the shared cap is removed." onConfirm={async () => { await deleteTeam(team.id); reload(); }} />
        </section>
      ))}
    </Frame>
  );
}

export function LimitsPage() {
  const { data, error, setError, reload } = useLoad(() => getGuards());
  const [rpm, setRpm] = useState(0);
  useEffect(() => {
    if (data) setRpm(data.rpm);
  }, [data]);
  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!data) return;
    setError("");
    try {
      await saveGuards({ ...data, rpm });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }
  return (
    <Frame title="Limits" tabs={keyTabs}>
      <form onSubmit={onSave} className="panel-card panel-card-body space-y-3">
        <input type="number" min={0} max={600} value={rpm} onChange={(event) => setRpm(Number(event.target.value))} className={field + " max-w-xs"} />
        {error && <p className="text-sm text-error-500">{error}</p>}
        <button className={button} type="submit">Save limit</button>
      </form>
    </Frame>
  );
}

export function WebhooksPage() {
  const { data, error, setError, reload } = useLoad(() => listWebhooks());
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await addWebhook(url, secret);
      setUrl("");
      setSecret("");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }
  return (
    <Frame title="Webhooks">
      {error && <p className="mb-3 text-sm text-error-500">{error}</p>}
      <form onSubmit={onAdd} className="panel-card panel-card-body mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/hook" className={field} />
        <input value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Signing secret" className={field} />
        <button className={button} type="submit">Add</button>
      </form>
      {(data?.webhooks ?? []).map((hook) => (
        <section key={hook.id} className="panel-card panel-card-body mb-2 flex items-center justify-between text-sm">
          <div>
            <p className="font-mono">{hook.url}</p>
            <p className="text-gray-500">{hook.hint || "no secret"}</p>
          </div>
          <DangerButton label="Delete" title="Delete this webhook?" body="Later calls will not be posted to this URL." onConfirm={async () => { await deleteWebhook(hook.id); reload(); }} />
        </section>
      ))}
    </Frame>
  );
}

export function BatchesPage() {
  const files = useLoad(() => localFiles());
  const batches = useLoad(() => localBatches());
  return (
    <Frame title="Batches">
      <h2 className="mb-2 text-sm font-semibold">Files</h2>
      {(files.data?.files ?? []).map((file) => <p key={file.id} className="text-sm">{file.filename} · {file.bytes} bytes · {file.purpose}</p>)}
      {files.data && files.data.files.length === 0 && <EmptyState title="No files" body="POST /v1/files with a router key stores a file here. Batches accept at most 40 JSONL lines." />}
      <h2 className="mt-4 mb-2 text-sm font-semibold">Batches</h2>
      {(batches.data?.batches ?? []).map((batch) => <p key={batch.id} className="text-sm">{batch.id} · {batch.status} · {batch.endpoint}</p>)}
      {batches.data && batches.data.batches.length === 0 && <p className="text-sm text-gray-500">No batches.</p>}
      {(files.error || batches.error) && <p className="text-sm text-error-500">{files.error || batches.error}</p>}
    </Frame>
  );
}

export function CachePage() {
  const { data, error, reload } = useLoad(() => cacheStats());
  return (
    <Frame title="Cache" tabs={localTabs}>
      {error && <p className="text-sm text-error-500">{error}</p>}
      <p className="text-sm">Enabled: {data?.enabled ? "yes" : "no"}. Entries: {data?.entries ?? 0}. TTL {data?.ttl ?? 0}s. Oldest {data?.oldest || "—"}.</p>
      <DangerButton label="Clear cache" title="Clear cached replies?" body="The next matching call will ask the provider again." onConfirm={async () => { await clearCache(); reload(); }} />
    </Frame>
  );
}

export function CompressionPage() {
  const [mode, setMode] = useState("caveman");
  const [text, setText] = useState("please just tell the answer\nplease just tell the answer");
  const [out, setOut] = useState("");
  const [error, setError] = useState("");
  async function onPreview(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await previewCompression(mode, text);
      setOut(`${result.after} bytes from ${result.before}\n\n${result.text}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not preview");
    }
  }
  return (
    <Frame title="Compression" tabs={localTabs}>
      <form onSubmit={onPreview} className="panel-card panel-card-body space-y-3">
        <select value={mode} onChange={(event) => setMode(event.target.value)} className={field}>
          {["light", "caveman", "dedup", "headroom", "rtk", "terse", "ultra"].map((item) => <option key={item}>{item}</option>)}
        </select>
        <textarea value={text} onChange={(event) => setText(event.target.value)} className={field + " min-h-28 py-2"} />
        <button className={button} type="submit">Preview</button>
        {error && <p className="text-sm text-error-500">{error}</p>}
        {out && <pre className="whitespace-pre-wrap text-sm">{out}</pre>}
      </form>
    </Frame>
  );
}

export function AuditPage() {
  const [source, setSource] = useState("mcp");
  const { data, error } = useLoad(() => auditLogs(source), [source]);
  return (
    <Frame title="Audit" tabs={activityTabs}>
      <select value={source} onChange={(event) => setSource(event.target.value)} className={field + " mb-3 max-w-xs"}>
        <option value="mcp">MCP</option>
        <option value="a2a">A2A</option>
        <option value="eval">Evals</option>
        <option value="batch">Batches</option>
      </select>
      {error && <p className="text-sm text-error-500">{error}</p>}
      {(data?.logs ?? []).map((log) => (
        <p key={log.id} className="text-sm text-gray-600 dark:text-gray-300">{log.createdAt} {log.source} {log.modelId} {log.statusCode} {log.errorMessage}</p>
      ))}
      {data && data.logs.length === 0 && <p className="text-sm text-gray-500">No matching calls.</p>}
    </Frame>
  );
}

export function SearchPage() {
  const { data, error } = useLoad(() => catalogModels({ kind: "search", limit: 40 }));
  return (
    <Frame title="Search tools">
      {error && <p className="text-sm text-error-500">{error}</p>}
      <ModelTable models={data?.models ?? []} />
    </Frame>
  );
}

export function MediaPage() {
  const { data, error } = useLoad(() => catalogModels({ kind: "image", limit: 20 }));
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState("");
  const [fault, setFault] = useState("");
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFault("");
    const response = await fetch("/api/playground/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, prompt }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setFault((body as { error?: string }).error || response.statusText);
      return;
    }
    setResult(JSON.stringify(body, null, 2).slice(0, 2000));
  }
  return (
    <Frame title="Media">
      {error && <p className="text-sm text-error-500">{error}</p>}
      <form onSubmit={onSubmit} className="panel-card panel-card-body mb-4 space-y-3">
        <select value={model} onChange={(event) => setModel(event.target.value)} className={field}>
          <option value="">Choose a model</option>
          {(data?.models ?? []).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
        </select>
        <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Prompt" className={field} />
        <button className={button} type="submit">Generate</button>
        {fault && <p className="text-sm text-error-500">{fault}</p>}
        {result && <pre className="overflow-x-auto text-xs">{result}</pre>}
      </form>
    </Frame>
  );
}

export function SkillsPage() {
  const { data, error, setError, reload } = useLoad(() => listSkills());
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await addSkill(name, instruction);
      setName("");
      setInstruction("");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }
  return (
    <Frame title="Skills" tabs={agentTabs}>
      {error && <p className="mb-3 text-sm text-error-500">{error}</p>}
      <form onSubmit={onAdd} className="panel-card panel-card-body mb-4 space-y-2">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" className={field} />
        <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Instruction" className={field + " min-h-24 py-2"} />
        <button className={button} type="submit">Save skill</button>
      </form>
      {(data?.skills ?? []).map((skill) => (
        <section key={skill.id} className="panel-card panel-card-body mb-2 text-sm">
          <div className="flex justify-between"><p className="font-medium">{skill.name}</p><DangerButton label="Delete" title={`Delete ${skill.name}?`} body="The instruction is removed from this computer." onConfirm={async () => { await deleteSkill(skill.id); reload(); }} /></div>
          <p className="mt-1 whitespace-pre-wrap text-gray-600 dark:text-gray-300">{skill.instruction}</p>
        </section>
      ))}
    </Frame>
  );
}

export function EvalsPage() {
  const { data, error, setError, reload } = useLoad(() => listEvals());
  const [name, setName] = useState("");
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [expect, setExpect] = useState("");
  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await addEval({ name, modelId, prompt, expect });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }
  return (
    <Frame title="Evals">
      {error && <p className="mb-3 text-sm text-error-500">{error}</p>}
      <form onSubmit={onAdd} className="panel-card panel-card-body mb-4 grid gap-2">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" className={field} />
        <input value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="Model id, such as openai/gpt-4o-mini" className={field} />
        <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Prompt" className={field} />
        <input value={expect} onChange={(event) => setExpect(event.target.value)} placeholder="Expected text" className={field} />
        <button className={button} type="submit">Save eval</button>
      </form>
      {(data?.evals ?? []).map((item) => (
        <section key={item.id} className="panel-card panel-card-body mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <div>
            <p className="font-medium">{item.name}</p>
            <p className="text-gray-500">{item.modelId} · last {item.lastStatus || "not run"}</p>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => runEval(item.id).then(reload).catch((err: Error) => setError(err.message))}>Run</button>
            <DangerButton label="Delete" title={`Delete ${item.name}?`} body="The stored prompt and expected text are removed." onConfirm={async () => { await deleteEval(item.id); reload(); }} />
          </div>
        </section>
      ))}
    </Frame>
  );
}

export function AgentsPage() {
  const { data, error, setError, reload } = useLoad(() => listAgentNotes());
  const [name, setName] = useState("");
  const [kind, setKind] = useState("cloud");
  const [detail, setDetail] = useState("");
  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await addAgentNote(name, kind, detail);
      setName("");
      setDetail("");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }
  return (
    <Frame title="Agents" tabs={agentTabs}>
      {error && <p className="mb-3 text-sm text-error-500">{error}</p>}
      <form onSubmit={onAdd} className="panel-card panel-card-body mb-4 grid gap-2 sm:grid-cols-4">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" className={field} />
        <select value={kind} onChange={(event) => setKind(event.target.value)} className={field}>
          <option value="cloud">cloud</option>
          <option value="cli">cli</option>
          <option value="acp">acp</option>
        </select>
        <input value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="Note" className={field} />
        <button className={button} type="submit">Save</button>
      </form>
      {(data?.agents ?? []).map((agent) => (
        <section key={agent.id} className="panel-card panel-card-body mb-2 flex justify-between text-sm">
          <p>{agent.name} · {agent.kind} · {agent.detail}</p>
          <DangerButton label="Delete" title={`Delete ${agent.name}?`} body="This only removes the note. It does not stop a cloud agent." onConfirm={async () => { await deleteAgentNote(agent.id); reload(); }} />
        </section>
      ))}
      <h2 className="mt-4 mb-2 text-sm font-semibold">Recent calls</h2>
      {(data?.recent ?? []).slice(0, 8).map((log) => <p key={log.id} className="text-sm text-gray-600">{log.source} {log.modelId} {log.statusCode}</p>)}
    </Frame>
  );
}

export function ServicesPage() {
  const { data, error, setError, reload } = useLoad(() => listBookmarks());
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await addBookmark(name, url);
      setName("");
      setUrl("");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }
  return (
    <Frame title="Services">
      {error && <p className="mb-3 text-sm text-error-500">{error}</p>}
      <form onSubmit={onAdd} className="panel-card panel-card-body mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" className={field} />
        <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:3000" className={field} />
        <button className={button} type="submit">Add</button>
      </form>
      {(data?.bookmarks ?? []).map((item) => (
        <section key={item.id} className="panel-card panel-card-body mb-2 flex justify-between text-sm">
          <a href={item.url} target="_blank" rel="noreferrer" className="text-brand-600">{item.name}</a>
          <DangerButton label="Delete" title={`Delete ${item.name}?`} body="The bookmark is removed. The other app is unchanged." onConfirm={async () => { await deleteBookmark(item.id); reload(); }} />
        </section>
      ))}
    </Frame>
  );
}

export function ChangelogPage() {
  const { data, error } = useLoad(() => changelogText());
  return (
    <Frame title="Changelog">
      {error && <p className="text-sm text-error-500">{error}</p>}
      {data?.markdown ? <MarkdownView text={data.markdown} /> : <p className="text-sm text-gray-500">Changelog file was not found next to the panel build.</p>}
    </Frame>
  );
}

export function OnboardingPage() {
  const { data, error } = useLoad(() => onboardingSteps());
  return (
    <Frame title="Onboarding">
      {error && <p className="text-sm text-error-500">{error}</p>}
      <div className="grid gap-2">
        {(data?.steps ?? []).map((step) => (
          <p key={step.id} className="panel-card panel-card-body text-sm">{step.done ? "Done" : "To do"} · {step.label}</p>
        ))}
      </div>
    </Frame>
  );
}
