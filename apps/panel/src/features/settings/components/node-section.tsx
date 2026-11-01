'use client';

import { useEffect, type ReactNode } from 'react';

import { LoadError, LoadingRows } from '@/components/ui/states';
import type { Slot } from '@/lib/slot';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';

import { useGatewaySettings } from '../store';
import { Card, Facts, FromFile } from './parts';

type Json = unknown;

/** The value at a dotted path of a settings document. */
function at(doc: Json, path: string): Json {
  let cur: Json = doc;
  for (const key of path.split('.')) {
    if (typeof cur !== 'object' || cur === null || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, Json>)[key];
  }
  return cur;
}

export interface NodeFact {
  label: string;
  /** Path under the settings member (`http.idle_timeout` under `server`). */
  path: string;
  /** Words for some values (`true` → On); the value itself otherwise. */
  words?: Record<string, string>;
  /** What an unset value with no default means ("Automatic"). */
  unset?: string;
  hint?: string;
}

const ON_OFF = { true: 'On', false: 'Off' };
const YES_NO = { true: 'Yes', false: 'No' };

/**
 * A fact's value as shown: the file's value, or the built-in default marked "default". Lists are
 * joined, `null` is "Not set" (or the fact's own word).
 */
export function nodeValue(
  spec: Json,
  defaults: Json,
  fact: NodeFact,
): { text: string; mono: boolean; isDefault: boolean } {
  const own = at(spec, fact.path);
  const value = own === undefined ? at(defaults, fact.path) : own;
  const isDefault = own === undefined && value !== undefined;
  if (value === undefined || value === null)
    return { text: fact.unset ?? 'Not set', mono: false, isDefault: false };
  if (Array.isArray(value))
    return {
      text: value.length ? value.map((x) => JSON.stringify(x).replace(/^"|"$/g, '')).join(', ') : 'None',
      mono: value.length > 0,
      isDefault,
    };
  if (typeof value === 'object') return { text: JSON.stringify(value), mono: true, isDefault };
  const key = typeof value === 'string' ? value : JSON.stringify(value);
  const word = fact.words?.[key];
  if (word) return { text: word, mono: false, isDefault };
  return { text: key, mono: true, isDefault };
}

function NodeFacts({ spec, defaults, facts }: { spec: Json; defaults: Json; facts: NodeFact[] }) {
  return (
    <Facts
      items={facts.map((fact) => {
        const v = nodeValue(spec, defaults, fact);
        return {
          label: fact.label,
          value: (
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className={v.mono ? 'mono break-all' : undefined}>{v.text}</span>
              {v.isDefault ? <span className="text-caption text-dim">default</span> : null}
            </span>
          ),
          hint: fact.hint,
        };
      })}
    />
  );
}

function NodeCard<T extends { spec: unknown }>({
  title,
  description,
  slot,
  subject,
  children,
}: {
  title: string;
  description: string;
  slot: Slot<T>;
  subject: string;
  children: (spec: Json) => ReactNode;
}) {
  return (
    <Card title={title} badge={<FromFile />} description={description}>
      {slot.status === 'loading' && !slot.data ? <LoadingRows rows={4} /> : null}
      <LoadError of={slot} subject={subject} size="sm" />
      {slot.data ? <div className="flex flex-col gap-5">{children(slot.data.spec)}</div> : null}
    </Card>
  );
}

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-ui font-semibold text-fg">{title}</h4>
      {children}
    </div>
  );
}

const D = SETTINGS_DEFAULTS;

export const LISTENER_FACTS: NodeFact[] = [
  { label: 'Apps connect to', path: 'listen', hint: 'The address the gateway listens on for apps.' },
  { label: 'Public URL', path: 'public_url' },
  { label: 'Worker threads', path: 'worker_threads', unset: 'One per CPU core' },
  { label: 'HTTP/2', path: 'http.http2', words: ON_OFF },
  { label: 'HTTP/2 without TLS (h2c)', path: 'http.h2c', words: ON_OFF },
  { label: 'Connections at most', path: 'http.max_connections' },
  { label: 'Wait for request headers', path: 'http.header_read_timeout' },
  { label: 'Wait for the request body', path: 'http.body_read_timeout' },
  { label: 'Close idle connections after', path: 'http.idle_timeout' },
  { label: 'Give up on a stalled write after', path: 'http.write_stall_timeout' },
];

const COMPRESSION_FACTS: NodeFact[] = [
  { label: 'Compress responses', path: 'compression.enabled', words: ON_OFF },
  { label: 'Compression methods', path: 'compression.algorithms' },
  { label: 'Smallest response compressed', path: 'compression.min_size' },
  { label: 'Compress streams', path: 'compression.stream', words: ON_OFF },
  { label: 'Accept compressed requests', path: 'decompression.enabled', words: ON_OFF },
  { label: 'Accepted methods', path: 'decompression.algorithms' },
];

const LIFECYCLE_FACTS: NodeFact[] = [
  { label: 'Drain for at least', path: 'shutdown.drain_min' },
  { label: 'Drain for at most', path: 'shutdown.drain_max' },
  { label: 'Flush records within', path: 'shutdown.flush_timeout' },
  { label: 'Ready only when these are up', path: 'probes.readiness_requires' },
  { label: 'Unhealthy after a stall of', path: 'probes.liveness_stall' },
];

const UPSTREAM_FACTS: NodeFact[] = [
  { label: 'Connections per host', path: 'upstream.max_connections_per_host' },
  { label: 'Connections per origin', path: 'upstream.max_connections_per_origin' },
  { label: 'Idle connections kept per origin', path: 'upstream.max_idle_per_origin' },
  { label: 'Close idle connections after', path: 'upstream.idle_timeout' },
  { label: 'Replace connections after', path: 'upstream.max_connection_age' },
  {
    label: 'HTTP/2 to providers',
    path: 'upstream.http2',
    words: { auto: 'When the provider offers it', prior_knowledge: 'Always', never: 'Never' },
  },
  { label: 'TCP keep-alive', path: 'upstream.tcp_keepalive' },
  { label: 'Connections opened ahead', path: 'upstream.prewarm_connections' },
  { label: 'DNS answers kept at least', path: 'upstream.dns.min_ttl' },
  { label: 'DNS answers kept at most', path: 'upstream.dns.max_ttl' },
  { label: 'DNS servers', path: 'upstream.dns.servers', unset: "The system's" },
];

export const ADMIN_FACTS: NodeFact[] = [
  { label: 'Console and Admin API listen on', path: 'listen' },
  { label: 'Console', path: 'ui.enabled', words: ON_OFF },
  { label: 'Console path', path: 'ui.path' },
  {
    label: 'Gateway URL shown to people',
    path: 'ui.data_plane_url',
    hint: 'In code snippets and on Endpoints & security.',
  },
];

const CONFIG_FACTS: NodeFact[] = [
  { label: 'Configuration file', path: 'config.file', unset: 'None' },
  { label: 'Applied as source', path: 'config.source' },
  { label: 'Reload when the file changes', path: 'config.watch', words: YES_NO },
  {
    label: 'Settings from the file are locked',
    path: 'config.lock_applied',
    words: YES_NO,
    hint: 'When locked, the console and API cannot change what the file applies.',
  },
  { label: 'Versions kept', path: 'config.history_limit' },
  { label: 'Audit log kept for', path: 'audit.retention' },
  { label: 'Audit entries include the change', path: 'audit.include_diffs', words: YES_NO },
];

const ADMIN_API_FACTS: NodeFact[] = [
  { label: 'Items per page', path: 'api.default_page_size' },
  { label: 'Items per page at most', path: 'api.max_page_size' },
  { label: 'Largest document', path: 'api.max_document' },
  { label: 'Longest wait for a result', path: 'api.max_wait' },
  { label: 'Retries recognised for', path: 'api.idempotency_ttl' },
];

const STORE_FACTS: NodeFact[] = [
  {
    label: 'Kind',
    path: 'backend',
    words: { embedded: 'Built in (on this node’s disk)', postgres: 'PostgreSQL' },
  },
  { label: 'Ledger written every', path: 'ledger.flush_interval' },
];

const EMBEDDED_FACTS: NodeFact[] = [{ label: 'Data folder', path: 'embedded.path' }];

const POSTGRES_FACTS: NodeFact[] = [
  { label: 'Connection', path: 'postgres.url', hint: 'Secrets are never shown.' },
  { label: 'Connections in the pool', path: 'postgres.pool_size' },
  { label: 'Connect timeout', path: 'postgres.connect_timeout' },
  { label: 'Statement timeout', path: 'postgres.statement_timeout' },
  {
    label: 'Database upgrades',
    path: 'postgres.migrate',
    words: { auto: 'At startup', manual: 'Run by hand' },
  },
];

const SPOOL_FACTS: NodeFact[] = [
  { label: 'Spool folder', path: 'spool.path' },
  { label: 'Spool size at most', path: 'spool.max_size' },
  {
    label: 'When the spool is full',
    path: 'spool.on_full',
    words: {
      reject_budgeted: 'Refuse requests that have a budget',
      drop: 'Keep serving; that spend is not recorded',
    },
  },
];

const LOG_STORE_FACTS: NodeFact[] = [
  {
    label: 'Request log kept in',
    path: 'logs.backend',
    words: { primary: 'The main store', clickhouse: 'ClickHouse' },
  },
];

const CLICKHOUSE_FACTS: NodeFact[] = [
  { label: 'ClickHouse connection', path: 'logs.clickhouse.url', hint: 'Secrets are never shown.' },
  { label: 'Database', path: 'logs.clickhouse.database' },
  { label: 'Rows per write', path: 'logs.clickhouse.batch_size' },
  { label: 'Written every', path: 'logs.clickhouse.flush_interval' },
];

export const CLUSTER_FACTS: NodeFact[] = [
  {
    label: 'Mode',
    path: 'mode',
    words: { standalone: 'One node', cluster: 'Several nodes sharing a store' },
  },
  { label: 'This node’s name', path: 'node_id', unset: 'Generated at startup' },
  { label: 'Heartbeat every', path: 'heartbeat_interval' },
  { label: 'A silent node counts as gone after', path: 'node_ttl' },
  { label: 'Check the other nodes every', path: 'probe_interval' },
  { label: 'Look for configuration changes every', path: 'config_sync.poll_interval' },
  {
    label: 'Limit counters kept in',
    path: 'counters.backend',
    words: { memory: 'Each node’s memory', redis: 'Redis' },
  },
];

const REDIS_FACTS: NodeFact[] = [
  { label: 'Redis connection', path: 'counters.redis.url', hint: 'Secrets are never shown.' },
  {
    label: 'Redis setup',
    path: 'counters.redis.topology',
    words: { standalone: 'One server', sentinel: 'Sentinel', cluster: 'Cluster' },
  },
  { label: 'Command timeout', path: 'counters.redis.command_timeout' },
  { label: 'Key prefix', path: 'counters.redis.key_prefix' },
  { label: 'Failed calls counted over', path: 'counters.redis.failure_detection.window' },
  {
    label: 'Out of use after at least',
    path: 'counters.redis.failure_detection.min_failures',
    hint: 'Failed calls within that time.',
  },
  {
    label: 'And a share of calls of at least',
    path: 'counters.redis.failure_detection.failure_rate',
  },
];

/**
 * The startup settings: listeners, the admin plane, the store and the cluster. They come from the
 * configuration file when the gateway starts; nothing here, in Configuration or in the API can
 * change them.
 */
export function NodeSection() {
  const server = useGatewaySettings((s) => s.server);
  const admin = useGatewaySettings((s) => s.admin);
  const store = useGatewaySettings((s) => s.store);
  const cluster = useGatewaySettings((s) => s.cluster);
  const loadNode = useGatewaySettings((s) => s.loadNode);
  useEffect(() => {
    void loadNode();
  }, [loadNode]);
  const storeBackend = at(store.data?.spec, 'backend') ?? D.store.backend;
  const logBackend = at(store.data?.spec, 'logs.backend') ?? D.store.logs.backend;
  const counters = at(cluster.data?.spec, 'counters.backend') ?? D.cluster.counters.backend;
  return (
    <>
      <p className="border-b border-line bg-raised px-5 py-3 text-ui text-muted max-sm:px-gutter-sm">
        These settings are read from the gateway&apos;s configuration file when it starts. To change one, edit
        the file and restart the gateway. Values marked default are not set in the file.
      </p>
      <NodeCard
        title="Listeners and HTTP"
        description="Where apps connect, and how connections are handled."
        slot={server}
        subject="Server settings"
      >
        {(spec) => (
          <>
            <NodeFacts spec={spec} defaults={D.server} facts={LISTENER_FACTS} />
            <Sub title="Compression">
              <NodeFacts spec={spec} defaults={D.server} facts={COMPRESSION_FACTS} />
            </Sub>
            <Sub title="Shutdown and health checks">
              <NodeFacts spec={spec} defaults={D.server} facts={LIFECYCLE_FACTS} />
            </Sub>
          </>
        )}
      </NodeCard>
      <NodeCard
        title="Connections to providers"
        description="How the gateway opens and reuses connections to providers."
        slot={server}
        subject="Server settings"
      >
        {(spec) => <NodeFacts spec={spec} defaults={D.server} facts={UPSTREAM_FACTS} />}
      </NodeCard>
      <NodeCard
        title="Console and configuration"
        description="Where the console and Admin API listen, and where the configuration comes from."
        slot={admin}
        subject="Admin settings"
      >
        {(spec) => (
          <>
            <NodeFacts spec={spec} defaults={D.admin} facts={ADMIN_FACTS} />
            <Sub title="Configuration and audit">
              <NodeFacts spec={spec} defaults={D.admin} facts={CONFIG_FACTS} />
            </Sub>
            <Sub title="Admin API">
              <NodeFacts spec={spec} defaults={D.admin} facts={ADMIN_API_FACTS} />
            </Sub>
          </>
        )}
      </NodeCard>
      <NodeCard
        title="Store"
        description="Where keys, budgets, usage and the request log are kept."
        slot={store}
        subject="Store settings"
      >
        {(spec) => (
          <>
            <NodeFacts
              spec={spec}
              defaults={D.store}
              facts={[...STORE_FACTS, ...(storeBackend === 'postgres' ? POSTGRES_FACTS : EMBEDDED_FACTS)]}
            />
            <Sub title="Request log">
              <NodeFacts
                spec={spec}
                defaults={D.store}
                facts={[...LOG_STORE_FACTS, ...(logBackend === 'clickhouse' ? CLICKHOUSE_FACTS : [])]}
              />
            </Sub>
            <Sub title="Spool, while the store is down">
              <NodeFacts spec={spec} defaults={D.store} facts={SPOOL_FACTS} />
            </Sub>
          </>
        )}
      </NodeCard>
      <NodeCard
        title="Cluster"
        description="How nodes find each other and share limit counters."
        slot={cluster}
        subject="Cluster settings"
      >
        {(spec) => (
          <NodeFacts
            spec={spec}
            defaults={D.cluster}
            facts={[...CLUSTER_FACTS, ...(counters === 'redis' ? REDIS_FACTS : [])]}
          />
        )}
      </NodeCard>
    </>
  );
}
