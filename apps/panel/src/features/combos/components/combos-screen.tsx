import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { PageHeader, Panel } from '@/components/ui/layout';

interface Preset {
  id: string;
  name: string;
  base_url: string;
  format: string;
  auth: string;
  free: boolean;
  models?: string[];
  sources?: string[];
}

interface StrategyDoc {
  strategies: string[];
  auto_models: string[];
  compression: { engines: string[]; not_implemented: string[]; profiles: string[] };
}

interface QuotaRow {
  name: string;
  kind: string;
  state: string;
  failures?: number;
  quota?: number;
  latency_ms?: number;
}

const CLIENTS = ['claude', 'codex', 'cursor', 'cline', 'opencode', 'copilot'];

async function admin<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch('/admin/v1/' + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || res.statusText);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export function CombosScreen() {
  const [query, setQuery] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [count, setCount] = useState(0);
  const [doc, setDoc] = useState<StrategyDoc | null>(null);
  const [quotas, setQuotas] = useState<QuotaRow[]>([]);
  const [status, setStatus] = useState('');
  const [comboName, setComboName] = useState('coding');
  const [strategy, setStrategy] = useState('priority');
  const [targets, setTargets] = useState('');
  const [client, setClient] = useState('cursor');
  const [snippet, setSnippet] = useState('');
  const [profile, setProfile] = useState('off');

  useEffect(() => {
    let stop = false;
    const q = new URLSearchParams();
    if (query.trim()) q.set('q', query.trim());
    if (freeOnly) q.set('free', '1');
    const timer = window.setTimeout(() => {
      admin<{ count: number; items: Preset[] }>('provider-presets?' + q.toString())
        .then((body) => {
          if (!stop) {
            setCount(body.count);
            setPresets(body.items ?? []);
          }
        })
        .catch((err: Error) => {
          if (!stop) setStatus(err.message);
        });
    }, 150);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [query, freeOnly]);

  useEffect(() => {
    admin<StrategyDoc>('routing/strategies').then(setDoc).catch(() => {});
    admin<{ items: QuotaRow[] }>('runtime/quotas')
      .then((body) => setQuotas(body.items ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    admin<{ body: string }>('clients/' + client)
      .then((body) => setSnippet(body.body))
      .catch(() => setSnippet(''));
  }, [client]);

  const shown = useMemo(() => presets.slice(0, 40), [presets]);

  async function install(id: string) {
    setStatus('Installing ' + id + '…');
    try {
      const body = await admin<{ provider: string; deployment?: string }>('provider-presets/' + id + ':install', {
        method: 'POST',
      });
      setStatus('Installed ' + body.provider + (body.deployment ? ' with deployment ' + body.deployment : '') + '. Paste a key on the provider if it needs one.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Install failed');
    }
  }

  async function saveCombo() {
    const list = targets
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((deployment) => ({ deployment, weight: 1 }));
    try {
      await admin('combos/' + encodeURIComponent(comboName), {
        method: 'PUT',
        body: JSON.stringify({ spec: { strategy, targets: list, enabled: true } }),
      });
      setStatus('Saved combo:' + comboName + '. Call it as the model name.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save the combo');
    }
  }

  async function saveProfile(next: string) {
    setProfile(next);
    try {
      await admin('settings/compression', {
        method: 'PUT',
        body: JSON.stringify({ spec: { profile: next } }),
      });
      setStatus(next === 'off' ? 'Compression is off.' : 'Compression profile is ' + next + '.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save compression');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Combos"
        description="Install a provider in one click, then route with a combo or an auto model."
        meta={count ? `${count} presets` : undefined}
      />
      {status ? <p className="text-sm text-muted">{status}</p> : null}

      <Panel
        title="Provider presets"
        subtitle="Search the catalog. Free tiers are marked. Installing does not store a secret."
        actions={
          <Button type="button" variant={freeOnly ? 'primary' : 'secondary'} size="sm" onClick={() => setFreeOnly((v) => !v)}>
            {freeOnly ? 'Showing free tiers' : 'All providers'}
          </Button>
        }
      >
        <div className="flex flex-col gap-3 px-5 pb-5">
          <Input value={query} placeholder="Search openai, ollama, anthropic…" onChange={(e) => setQuery(e.target.value)} />
          <ul className="divide-y divide-line">
            {shown.map((preset) => (
              <li key={preset.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{preset.name || preset.id}</span>
                    {preset.free ? <Badge tone="success">Free</Badge> : null}
                    <span className="text-xs text-muted">{preset.format}</span>
                  </div>
                  <div className="truncate text-xs text-muted">{preset.base_url}</div>
                </div>
                <Button type="button" size="sm" onClick={() => void install(preset.id)}>
                  Install
                </Button>
              </li>
            ))}
          </ul>
          {presets.length > shown.length ? (
            <p className="text-xs text-muted">Showing {shown.length} of {presets.length}. Narrow the search to see the rest.</p>
          ) : null}
        </div>
      </Panel>

      <Panel title="Combo builder" subtitle="Targets are deployment names, separated by commas. Call the combo as combo:name.">
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <Input value={comboName} onChange={(e) => setComboName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Strategy
            <select
              className="h-9 rounded-md border border-line bg-sunken px-2"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
            >
              {(doc?.strategies ?? ['priority']).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Deployments
            <Input value={targets} placeholder="openai-gpt-4o-mini, anthropic-claude" onChange={(e) => setTargets(e.target.value)} />
          </label>
          <div>
            <Button type="button" variant="primary" onClick={() => void saveCombo()}>
              Save combo
            </Button>
          </div>
          <div className="text-xs text-muted sm:col-span-2">
            Zero-config models: {(doc?.auto_models ?? []).join(', ') || 'auto'}. auto/subscription fails closed when no subscription quota is left.
          </div>
        </div>
      </Panel>

      <Panel title="Quota and breakers" subtitle="Cooldowns, open circuits, and model lockouts in this process.">
        <div className="px-5 pb-5">
          {quotas.length === 0 ? (
            <p className="text-sm text-muted">No cooldown or open circuit right now.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {quotas.map((row) => (
                <li key={row.kind + row.name} className="flex justify-between py-2">
                  <span>
                    {row.kind} · {row.name}
                  </span>
                  <span className="text-muted">{row.state}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Panel title="Compression" subtitle="Rule-based engines only. Model compressors are listed and not run.">
        <div className="flex flex-col gap-3 px-5 pb-5">
          <div className="flex flex-wrap gap-2">
            {(doc?.compression.profiles ?? ['off']).map((item) => (
              <Button key={item} type="button" size="sm" variant={profile === item ? 'primary' : 'secondary'} onClick={() => void saveProfile(item)}>
                {item}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted">
            Runs: {(doc?.compression.engines ?? []).join(', ')}. Not in this build: {(doc?.compression.not_implemented ?? []).join(', ')}.
          </p>
        </div>
      </Panel>

      <Panel title="Connect a client" subtitle="One snippet for Claude Code, Codex, Cursor, Cline, OpenCode, or Copilot. wowrouter configure prints the same text.">
        <div className="flex flex-col gap-3 px-5 pb-5">
          <div className="flex flex-wrap gap-2">
            {CLIENTS.map((name) => (
              <Button key={name} type="button" size="sm" variant={client === name ? 'primary' : 'secondary'} onClick={() => setClient(name)}>
                {name}
              </Button>
            ))}
          </div>
          <pre className="overflow-auto rounded-md bg-sunken p-3 text-xs">{snippet}</pre>
        </div>
      </Panel>
    </div>
  );
}
