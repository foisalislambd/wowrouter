import { api, listAll, request } from '@/lib/api/client';
import type {
  ApplyResult,
  AuditEntry,
  DeploymentHealth,
  DiffResult,
  Health,
  OrganizationResource,
  ProviderResource,
  ValidateResult,
} from '@/lib/api/types';
import type { components } from '@/lib/api/schema';

type S = components['schemas'];
export type ProviderStatus = S['ProviderStatus'];
export type NodeInfo = S['Node'];
export type AuditSinkStatus = S['AuditSinkStatus'];
export type ConfigDoc = Record<string, unknown>;
export type GenerationSummary = S['GenerationSummary'];
export type EncryptionReport = S['EncryptionReport'];
export type GovernanceSettings = S['GovernanceSettings'];
export type Job = S['Job'];
export type GuardrailResource = S['GuardrailResource'];
export type ChangeRequest = S['ChangeRequest'];
export type SamlStatus = S['SamlProviderStatus'];
export type LimitSimulationResult = S['LimitSimulationResult'];
export type AlertDelivery = S['AlertDelivery'];

/** What a delivery attempt came to, as the gateway records it. */
export type DeliveryResult = 'delivered' | 'failed' | 'timeout';

export interface DeliveryFilter {
  /** A webhook's or channel's name; empty for every target. */
  target?: string | null;
  result?: DeliveryResult | '';
  eventType?: string;
}
export type TestResult = S['TestResult'];
export type UserResource = S['UserResource'];
export type SloStatus = S['SloStatus'];

/**
 * A node as `/cluster` and `/runtime/nodes/{id}` report it. The gateway also sends its load and
 * since when it runs; the contract does not list those members yet, so they are optional here.
 */
export type ClusterNode = NodeInfo & {
  in_flight?: number;
  max_in_flight?: number;
  queue_depth?: number;
  started_at?: string | null;
  ready_since?: string | null;
};

/** The cluster: its mode, its nodes, the background job leases and the summed load. */
export interface ClusterView {
  mode: S['Cluster']['mode'];
  nodes: ClusterNode[];
  jobs: S['JobLease'][];
  totals?: { in_flight: number; max_in_flight: number; queue_depth: number };
}

/** Whether every node runs a configuration version, and which do not yet. */
export interface Convergence {
  converged: boolean;
  lagging?: string[];
}

export interface AuditQuery {
  actor?: string;
  resource?: string;
  action?: string;
  outcome?: 'success' | 'denied' | 'failed';
  kind?: 'read' | 'write';
  from?: string;
  to?: string;
}

export const settingsApi = {
  exportConfig: async (): Promise<{ doc: ConfigDoc; etag: string | null }> => {
    const r = await request('get', '/config');
    return { doc: r.data, etag: r.etag };
  },
  diff: (doc: ConfigDoc): Promise<DiffResult> =>
    api.post('/config:diff', { body: doc as S['ConfigDocument'] }),
  validate: (doc: ConfigDoc): Promise<ValidateResult> =>
    api.post('/config:validate', { body: doc as S['ConfigDocument'] }),
  apply: (doc: ConfigDoc, etag: string | null, reason?: string): Promise<ApplyResult> =>
    api.post('/config:apply', { body: doc as S['ConfigDocument'], ifMatch: etag ?? undefined, reason }),
  audit: (q: AuditQuery, cursor?: string, limit = 50) =>
    api.get('/audit', { query: { ...q, limit, ...(cursor ? { cursor } : {}) } }),
  auditEntry: (id: string): Promise<AuditEntry> => api.get('/audit/{id}', { path: { id } }),
  health: (): Promise<Health> => api.get('/health'),
  deployments: async (): Promise<DeploymentHealth[]> => (await api.get('/runtime/deployments')).items,
  providerStatus: async (): Promise<ProviderStatus[]> => (await api.get('/runtime/providers')).items,
  nodes: async (): Promise<NodeInfo[]> => (await api.get('/runtime/nodes')).items,
  providers: (): Promise<ProviderResource[]> =>
    listAll((cursor) => api.get('/providers', { query: { limit: 200, cursor } })),
  setProviderEnabled: (name: string, enabled: boolean, etag: string | undefined) =>
    api.patch('/providers/{name}', { path: { name }, body: { spec: { enabled } }, ifMatch: etag }),
  testProvider: (name: string) => api.post('/providers/{name}:test', { path: { name } }),
  rotateCredential: (name: string, secret: string, overlap: string) =>
    api.post('/providers/{name}:rotate_credential', {
      path: { name },
      body: { credential: secret, retire_after: overlap },
    }),
  organization: (name: string): Promise<OrganizationResource> =>
    api.get('/organizations/{name}', { path: { name } }),
  patchOrganization: (
    name: string,
    spec: Partial<OrganizationResource['spec']>,
    etag: string | undefined,
    reason?: string,
  ) => api.patch('/organizations/{name}', { path: { name }, body: { spec }, ifMatch: etag, reason }),
  authSettings: () => api.get('/settings/auth'),
  patchAuthSettings: (spec: Record<string, unknown>, etag: string | undefined, reason?: string) =>
    api.patch('/settings/auth', { body: { spec }, ifMatch: etag, reason }),
  observabilitySettings: () => api.get('/settings/observability'),
  patchObservabilitySettings: (spec: Record<string, unknown>, etag: string | undefined, reason?: string) =>
    api.patch('/settings/observability', { body: { spec }, ifMatch: etag, reason }),
  limitsSettings: () => api.get('/settings/limits'),
  patchLimits: (spec: Record<string, unknown>, etag: string | undefined, reason?: string) =>
    api.patch('/settings/limits', { body: { spec }, ifMatch: etag, reason }),
  apiSettings: () => api.get('/settings/api'),
  patchApi: (spec: Record<string, unknown>, etag: string | undefined, reason?: string) =>
    api.patch('/settings/api', { body: { spec }, ifMatch: etag, reason }),
  streamingSettings: () => api.get('/settings/streaming'),
  patchStreaming: (spec: Record<string, unknown>, etag: string | undefined, reason?: string) =>
    api.patch('/settings/streaming', { body: { spec }, ifMatch: etag, reason }),
  /** The startup settings, read from the configuration file; the API cannot change them. */
  serverSettings: () => api.get('/settings/server'),
  adminSettings: () => api.get('/settings/admin'),
  storeSettings: () => api.get('/settings/store'),
  clusterSettings: () => api.get('/settings/cluster'),
  securitySettings: () => api.get('/settings/security'),
  auditSinks: async (): Promise<AuditSinkStatus[]> => (await api.get('/runtime/audit/sinks')).items,
  scim: () => api.get('/auth/scim/status'),
  rotateScimToken: (overlap: string) => api.post('/settings/auth:rotate_scim_token', { body: { overlap } }),
  ingress: () => api.get('/runtime/ingress'),
  pauseIngress: (body: S['IngressPause'], reason?: string) =>
    api.post('/runtime/ingress:pause', { body, reason }),
  resumeIngress: (organization?: string) =>
    api.post('/runtime/ingress:resume', { body: organization ? { organization } : {} }),
  rotateSecrets: (scope: S['SecretsRotate']['scope'], reason?: string) =>
    api.post('/settings/security:rotate_secrets', { body: { scope }, reason }),
  generations: async (): Promise<GenerationSummary[]> =>
    (await api.get('/config/generations', { query: { limit: 200 } })).items,
  generation: async (n: number): Promise<ConfigDoc> =>
    await api.get('/config/generations/{generation}', { path: { generation: n } }),
  rollback: (generation: number, etag: string | null, reason?: string): Promise<ApplyResult> =>
    api.post('/config:rollback', { body: { generation }, ifMatch: etag ?? undefined, reason }),
  drainNode: (id: string) => api.post('/runtime/nodes/{id}:drain', { path: { id } }),
  cluster: async (): Promise<ClusterView> => await api.get('/cluster'),
  node: async (id: string): Promise<ClusterNode> => await api.get('/runtime/nodes/{id}', { path: { id } }),
  /** Waits up to `timeout` for every node to run `generation`, then says which still do not. */
  converged: (generation: number, timeout = '10s'): Promise<Convergence> =>
    api.get('/cluster/converged', { query: { config_version: generation, timeout } }),
  slos: async (): Promise<SloStatus[]> => (await api.get('/runtime/slos')).items,
  encryption: (): Promise<EncryptionReport> => api.get('/runtime/encryption'),
  status: () => api.get('/status'),
  policies: () => api.get('/settings/policies'),
  patchPolicies: (spec: Record<string, unknown>, etag: string | undefined) =>
    api.patch('/settings/policies', { body: { spec }, ifMatch: etag }),
  patchRouting: (spec: Record<string, unknown>, etag: string | undefined, reason?: string) =>
    api.patch('/settings/routing', { body: { spec }, ifMatch: etag, reason }),
  routing: () => api.get('/settings/routing'),
  governance: (): Promise<GovernanceSettings> => api.get('/settings/governance'),
  patchGovernance: (spec: Record<string, unknown>, etag: string | undefined, reason?: string) =>
    api.patch('/settings/governance', { body: { spec }, ifMatch: etag, reason }),
  organizations: () => listAll((cursor) => api.get('/organizations', { query: { limit: 200, cursor } })),
  teams: () => listAll((cursor) => api.get('/teams', { query: { limit: 200, cursor } })),
  projects: () => listAll((cursor) => api.get('/projects', { query: { limit: 200, cursor } })),
  keys: () => listAll((cursor) => api.get('/keys', { query: { limit: 200, cursor } })),
  guardrails: (): Promise<GuardrailResource[]> =>
    listAll((cursor) => api.get('/guardrails', { query: { limit: 200, cursor } })),
  createGuardrail: (name: string, spec: GuardrailResource['spec']) =>
    api.post('/guardrails', { body: { name, spec } }),
  deleteGuardrail: (name: string, reason?: string) =>
    api.delete('/guardrails/{name}', { path: { name }, reason }),
  exportOrganization: (name: string): Promise<Job> =>
    api.post('/organizations/{name}:export', { path: { name } }),
  job: (id: string): Promise<Job> => api.get('/jobs/{job_id}', { path: { job_id: id } }),
  scheduleDeletion: (name: string, grace: string, reason?: string) =>
    api.post('/organizations/{name}:schedule_deletion', { path: { name }, body: { grace }, reason }),
  cancelDeletion: (name: string, reason?: string) =>
    api.post('/organizations/{name}:cancel_deletion', { path: { name }, reason }),
  purgeCache: (organization: string | null, reason?: string) =>
    api.post('/cache:invalidate', {
      body: organization ? { level: 'organization', name: organization } : { level: 'gateway' },
      reason,
    }),
  pendingActions: async (): Promise<ChangeRequest[]> =>
    (await api.get('/change_requests', { query: { state: ['open', 'approved'], limit: 200 } })).items.filter(
      (r) => r.kind === 'action',
    ),

  users: (): Promise<UserResource[]> =>
    listAll((cursor) => api.get('/users', { query: { limit: 200, cursor } }), 50),
  roles: async () => (await api.get('/roles')).items,
  samlStatus: (name: string): Promise<SamlStatus> =>
    api.get('/auth/saml/{provider}', { path: { provider: name } }),
  samlResync: (name: string): Promise<SamlStatus> =>
    api.post('/auth/saml/{provider}:resync', { path: { provider: name } }),
  patchSecurity: (spec: Record<string, unknown>, etag: string | undefined, reason?: string) =>
    api.patch('/settings/security', { body: { spec }, ifMatch: etag, reason }),
  smtp: () => api.get('/settings/smtp'),
  patchSmtp: (spec: Record<string, unknown>, etag: string | undefined) =>
    api.patch('/settings/smtp', { body: { spec }, ifMatch: etag }),
  testSmtp: (to: string) => api.post('/settings/smtp:test', { body: { to } }),
  testAuditSink: (name: string): Promise<TestResult> =>
    api.post('/runtime/audit/sinks/{sink}:test', { path: { sink: name } }),
  simulate: (body: S['LimitSimulation']): Promise<LimitSimulationResult> =>
    api.post('/runtime/limits:simulate', { body }),
  models: () => listAll((cursor) => api.get('/models', { query: { limit: 200, cursor } })),
  /** Delivery attempts of the last 7 days: to one webhook or channel, or to all, by result and event. */
  deliveries: async (filter: DeliveryFilter, cursor?: string) =>
    await api.get('/alerts/deliveries', {
      query: {
        ...(filter.target ? { webhook: filter.target } : {}),
        ...(filter.result ? { result: filter.result } : {}),
        ...(filter.eventType ? { event_type: filter.eventType } : {}),
        limit: 50,
        ...(cursor ? { cursor } : {}),
      },
    }),
  redeliver: (eventId: string) =>
    api.post('/alerts/deliveries/{event_id}:redeliver', { path: { event_id: eventId } }),
  /** The newest configuration writes, for "changed by … · 2 h ago". */
  recentWrites: async (): Promise<AuditEntry[]> =>
    (await api.get('/audit', { query: { kind: 'write', outcome: 'success', limit: 200 } })).items,
};
