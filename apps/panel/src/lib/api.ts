export type Provider = {
  slug: string
  displayName: string
  protocol: string
  baseUrl: string
  docsUrl: string
  summary: string
  category: string
  free: boolean
  keyOptional: boolean
  hasApiKey: boolean
  apiKeyHint: string
  enabled: boolean
  accountStrategy: string
  accountCount: number
  activeModels: number
  totalModels: number
  updatedAt: string
}

export type ProviderAccount = {
  id: string
  providerSlug: string
  name: string
  hasApiKey: boolean
  apiKeyHint: string
  priority: number
  enabled: boolean
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
}

export type Model = {
  id: string
  providerSlug: string
  upstreamId: string
  displayName: string
  description: string
  contextWindow: number
  maxOutputTokens: number
  inputUsdPerMillion: number
  outputUsdPerMillion: number
  knowledgeCutoff: string
  reasoning: boolean
  kind: string
  inputs: string
  outputs: string
  active: boolean
}

export type RouterKey = {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  monthlyBudgetUsd: number | null
  monthSpendUsd: number
}

export type CreatedKey = RouterKey & { secret: string }

export type ActivityItem = {
  id: number
  createdAt: string
  source: string
  modelId: string
  statusCode: number
  latencyMs: number
  promptTokens: number
  completionTokens: number
  errorMessage: string
  routeNote?: string
}

export type Overview = {
  providers: number
  activeModels: number
  routerKeys: number
  endpoint: string
}

export type DashboardStep = { id: string; label: string; href: string; done: boolean }

export type Dashboard = {
  providers: number
  enabledProviders: number
  activeModels: number
  routerKeys: number
  endpoint: string
  today: { requests: number; errors: number; avgLatencyMs: number; costUsd: number }
  days: UsageDay[]
  topModels: UsageRow[]
  providerHealth: { provider: string; requests: number; errors: number; avgLatencyMs: number }[]
  steps: DashboardStep[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })
  if (response.status === 204) {
    return undefined as T
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) {
    if (response.status === 401 && data.error === "Sign in to use the panel.") {
      window.dispatchEvent(new Event("wowrouter-auth"))
    }
    throw new Error(data.error || response.statusText)
  }
  return data as T
}

export function getOverview() {
  return request<Overview>("/api/overview")
}

export function getDashboard() {
  return request<Dashboard>("/api/dashboard")
}

export function providerHealth(slug: string) {
  return request<{ requests: number; errors: number; avgLatencyMs: number }>(`/api/providers/${slug}/health`)
}

export type ProviderCategory = {
  id: string
  label: string
  total: number
  ready: number
}

export type ProviderPage = {
  providers: Provider[]
  categories: ProviderCategory[]
  total: number
  limit: number
  offset: number
}

export function listProviders(params?: { q?: string; category?: string; state?: string; limit?: number; offset?: number }) {
  const search = new URLSearchParams()
  if (params?.q) search.set("q", params.q)
  if (params?.category && params.category !== "all") search.set("category", params.category)
  if (params?.state && params.state !== "all") search.set("state", params.state)
  if (params?.limit) search.set("limit", String(params.limit))
  if (params?.offset) search.set("offset", String(params.offset))
  const query = search.toString()
  return request<ProviderPage>(`/api/providers${query ? `?${query}` : ""}`)
}

export function getProvider(slug: string) {
  return request<Provider>(`/api/providers/${slug}`)
}

export function updateProvider(
  slug: string,
  body: { apiKey?: string; baseUrl?: string; enabled?: boolean; accountStrategy?: string },
) {
  return request<Provider>(`/api/providers/${slug}`, {
    method: "PUT",
    body: JSON.stringify(body),
  })
}

export function listAccounts(slug: string) {
  return request<{ accounts: ProviderAccount[] }>(`/api/providers/${slug}/accounts`)
}

export function createAccount(
  slug: string,
  body: { name?: string; apiKey: string; priority?: number; enabled?: boolean },
) {
  return request<ProviderAccount>(`/api/providers/${slug}/accounts`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export function updateAccount(
  slug: string,
  id: string,
  body: { name?: string; apiKey?: string; priority?: number; enabled?: boolean },
) {
  return request<ProviderAccount>(`/api/providers/${slug}/accounts/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  })
}

export function deleteAccount(slug: string, id: string) {
  return request<void>(`/api/providers/${slug}/accounts/${id}`, { method: "DELETE" })
}

export function startDeviceLogin(slug: string, clientId: string) {
  return request<{ userCode: string; verificationUri: string; interval: number }>(`/api/providers/${slug}/oauth/device`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  })
}

export function pollDeviceLogin(slug: string) {
  return request<{ pending: boolean; saved?: boolean }>(`/api/providers/${slug}/oauth/poll`, {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export function testProvider(slug: string, body: { apiKey?: string; baseUrl?: string; accountId?: string }) {
  return request<{ ok: boolean; upstreamModels?: number; status?: number }>(`/api/providers/${slug}/test`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export function loadProviderModels(slug: string, body: { apiKey?: string; baseUrl?: string }) {
  return request<{ models: number }>(`/api/providers/${slug}/models/load`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export type ModelPage = {
  models: Model[]
  total: number
  limit: number
  offset: number
}

export function listProviderModels(slug: string, params?: { q?: string; limit?: number; offset?: number }) {
  const search = new URLSearchParams()
  if (params?.q) search.set("q", params.q)
  if (params?.limit) search.set("limit", String(params.limit))
  if (params?.offset) search.set("offset", String(params.offset))
  const query = search.toString()
  return request<ModelPage>(`/api/providers/${slug}/models${query ? `?${query}` : ""}`)
}

export function listActiveModels() {
  return request<{ models: Model[] }>("/api/models")
}

export function setModelActive(slug: string, upstreamId: string, active: boolean) {
  const modelPath = upstreamId.split("/").map(encodeURIComponent).join("/")
  return request<Model>(`/api/providers/${slug}/models/${modelPath}`, {
    method: "PUT",
    body: JSON.stringify({ active }),
  })
}

export function listKeys() {
  return request<{ keys: RouterKey[] }>("/api/keys")
}

export function createKey(name: string, monthlyBudgetUsd?: number) {
  return request<CreatedKey>("/api/keys", {
    method: "POST",
    body: JSON.stringify({ name, monthlyBudgetUsd: monthlyBudgetUsd && monthlyBudgetUsd > 0 ? monthlyBudgetUsd : undefined }),
  })
}

export function deleteKey(id: string) {
  return request<void>(`/api/keys/${id}`, { method: "DELETE" })
}

export function listActivity(params?: { q?: string; status?: string; limit?: number; offset?: number }) {
  const search = new URLSearchParams()
  if (params?.q) search.set("q", params.q)
  if (params?.status && params.status !== "all") search.set("status", params.status)
  if (params?.limit) search.set("limit", String(params.limit))
  if (params?.offset) search.set("offset", String(params.offset))
  const query = search.toString()
  return request<{ activity: ActivityItem[]; total: number }>(`/api/activity${query ? `?${query}` : ""}`)
}

export function getActivity(id: string) {
  return request<ActivityItem & { requestJson?: string }>(`/api/activity/${id}`)
}

export function clearActivity() {
  return request<void>("/api/activity", { method: "DELETE" })
}

export type UsageRow = {
  modelId: string
  requests: number
  errors: number
  promptTokens: number
  completionTokens: number
  costUsd: number
}

export type UsageDay = {
  day: string
  requests: number
  promptTokens: number
  completionTokens: number
  costUsd: number
}

export function getUsage(days = 14) {
  return request<{
    rows: UsageRow[]
    days: UsageDay[]
    totals: { requests: number; errors: number; promptTokens: number; completionTokens: number; costUsd: number }
  }>(`/api/usage?days=${days}`)
}

export type PanelSession = {
  authRequired: boolean
  authenticated: boolean
  password?: boolean
  oidc?: boolean
}

export function getSession() {
  return request<PanelSession>("/api/session")
}

export function login(password: string) {
  return request<PanelSession>("/api/session", {
    method: "POST",
    body: JSON.stringify({ password }),
  })
}

export function savePanelAuth(body: { enabled: boolean; password?: string; currentPassword?: string }) {
  return request<{ authRequired: boolean; signedOut: boolean }>("/api/settings/auth", {
    method: "PUT",
    body: JSON.stringify(body),
  })
}

export type ClientSnippet = {
  id: string
  name: string
  summary: string
  config: string
}

export function getClients() {
  return request<{ baseUrl: string; panelUrl: string; clients: ClientSnippet[] }>("/api/clients")
}

export type Features = {
  compression: string
  cache: boolean
  cacheTtl: number
  memory: boolean
}

export type OIDCSettings = {
  enabled: boolean
  issuer: string
  clientId: string
  hasSecret: boolean
}

export function getSettings() {
  return request<{
    dataDir: string
    address: string
    logCount: number
    features: Features
    oidc: OIDCSettings
    redirectUrl: string
  }>("/api/settings")
}

export function saveFeatures(body: Features) {
  return request<Features>("/api/settings/features", { method: "PUT", body: JSON.stringify(body) })
}

export function saveOIDC(body: { enabled: boolean; issuer: string; clientId: string; clientSecret?: string }) {
  return request<OIDCSettings & { redirectUrl: string }>("/api/settings/oidc", {
    method: "PUT",
    body: JSON.stringify(body),
  })
}

export type MemoryNote = { id: string; body: string; createdAt: string }

export function listMemories() {
  return request<{ memories: MemoryNote[] }>("/api/memories")
}

export function addMemory(body: string) {
  return request<MemoryNote>("/api/memories", { method: "POST", body: JSON.stringify({ body }) })
}

export function deleteMemory(id: string) {
  return request<void>(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" })
}

export type ClientTarget = { id: string; name: string; path: string; exists: boolean; summary: string }

export function listClientTargets() {
  return request<{ clients: ClientTarget[] }>("/api/clients/setup")
}

export function writeClientConfig(client: string, routerKey: string, confirm: boolean) {
  return request<{ client: string; path: string; backup: string }>("/api/clients/setup", {
    method: "POST",
    body: JSON.stringify({ client, routerKey, confirm }),
  })
}

export function restoreClientConfig(client: string, confirm: boolean) {
  return request<{ client: string; path: string; backup: string }>("/api/clients/setup/restore", {
    method: "POST",
    body: JSON.stringify({ client, confirm }),
  })
}

export function getDesktop() {
  return request<{ os: string; startWithWindows: boolean }>("/api/desktop")
}

export function saveDesktop(startWithWindows: boolean) {
  return request<void>("/api/desktop", { method: "PUT", body: JSON.stringify({ startWithWindows }) })
}

export type FallbackChain = {
  id: string
  name: string
  modelId: string
  strategy: string
  models: string[]
  weights: number[]
  createdAt: string
}

export function listFallbacks() {
  return request<{ fallbacks: FallbackChain[] }>("/api/fallbacks")
}

export function saveFallback(name: string, models: string[], strategy: string, weights: number[]) {
  return request<FallbackChain>("/api/fallbacks", {
    method: "POST",
    body: JSON.stringify({ name, models, strategy, weights }),
  })
}

export function deleteFallback(id: string) {
  return request<void>(`/api/fallbacks/${id}`, { method: "DELETE" })
}

export function catalogModels(params?: { q?: string; kind?: string; sort?: string; limit?: number; offset?: number; priced?: boolean }) {
  const search = new URLSearchParams()
  if (params?.q) search.set("q", params.q)
  if (params?.kind) search.set("kind", params.kind)
  if (params?.sort) search.set("sort", params.sort)
  if (params?.limit) search.set("limit", String(params.limit))
  if (params?.offset) search.set("offset", String(params.offset))
  if (params?.priced) search.set("priced", "1")
  const query = search.toString()
  return request<{ models: CatalogModel[]; total: number }>(`/api/catalog/models${query ? `?${query}` : ""}`)
}

export type CatalogModel = {
  id: string
  provider: string
  upstreamId: string
  displayName: string
  kind: string
  inputUsdPerMillion: number
  outputUsdPerMillion: number
  active: boolean
}

export function freeProviders() {
  return request<{ providers: { slug: string; name: string; category: string; summary: string }[] }>("/api/catalog/free")
}

export function quotaSlots() {
  return request<{ slots: { slot: string; remaining: number; limit: number; resetUnix: number; cooldownUntil: number; updatedAt: string }[] }>("/api/quota")
}

export function cacheStats() {
  return request<{ entries: number; oldest: string; enabled: boolean; ttl: number }>("/api/cache")
}

export function clearCache() {
  return request<void>("/api/cache", { method: "DELETE" })
}

export function endpointList() {
  return request<{ base: string; routes: { method: string; path: string; use: string }[] }>("/api/endpoints")
}

export function healthDetail() {
  return request<{ status: string; uptimeSec: number; go: string; dataDir: string; addr: string; allocMb: number; logs: number; providers: number; activeModels: number; keys: number; providersStats: { provider: string; requests: number; errors: number }[] }>("/api/health/detail")
}

export function costReport() {
  return request<{ totalUsd: number; byModel: { modelId: string; requests: number; costUsd: number }[]; prices: CatalogModel[] }>("/api/costs")
}

export function listWebhooks() {
  return request<{ webhooks: { id: string; url: string; hint: string; enabled: boolean }[] }>("/api/webhooks")
}

export function addWebhook(url: string, secret: string) {
  return request<{ id: string }>("/api/webhooks", { method: "POST", body: JSON.stringify({ url, secret }) })
}

export function deleteWebhook(id: string) {
  return request<void>(`/api/webhooks/${id}`, { method: "DELETE" })
}

export function listSkills() {
  return request<{ skills: { id: string; name: string; instruction: string }[] }>("/api/skills")
}

export function addSkill(name: string, instruction: string) {
  return request<{ id: string }>("/api/skills", { method: "POST", body: JSON.stringify({ name, instruction }) })
}

export function deleteSkill(id: string) {
  return request<void>(`/api/skills/${id}`, { method: "DELETE" })
}

export function listEvals() {
  return request<{ evals: { id: string; name: string; modelId: string; prompt: string; expect: string; lastStatus: string }[] }>("/api/evals")
}

export function addEval(body: { name: string; modelId: string; prompt: string; expect: string }) {
  return request<{ id: string }>("/api/evals", { method: "POST", body: JSON.stringify(body) })
}

export function runEval(id: string) {
  return request<{ status: string; http: number; body: string }>(`/api/evals/${id}/run`, { method: "POST", body: "{}" })
}

export function deleteEval(id: string) {
  return request<void>(`/api/evals/${id}`, { method: "DELETE" })
}

export function listTeams() {
  return request<{ teams: { id: string; name: string; monthlyBudgetUsd: number | null; keyIds: string[] }[] }>("/api/teams")
}

export function addTeam(name: string, monthlyBudgetUsd: number | null, keyIds: string[]) {
  return request<{ id: string }>("/api/teams", { method: "POST", body: JSON.stringify({ name, monthlyBudgetUsd, keyIds }) })
}

export function deleteTeam(id: string) {
  return request<void>(`/api/teams/${id}`, { method: "DELETE" })
}

export function listBookmarks() {
  return request<{ bookmarks: { id: string; name: string; url: string }[] }>("/api/bookmarks")
}

export function addBookmark(name: string, url: string) {
  return request<{ id: string }>("/api/bookmarks", { method: "POST", body: JSON.stringify({ name, url }) })
}

export function deleteBookmark(id: string) {
  return request<void>(`/api/bookmarks/${id}`, { method: "DELETE" })
}

export function listAgentNotes() {
  return request<{ agents: { id: string; name: string; kind: string; detail: string }[]; recent: { id: number; modelId: string; source: string; statusCode: number }[] }>("/api/agents")
}

export function addAgentNote(name: string, kind: string, detail: string) {
  return request<{ id: string }>("/api/agents", { method: "POST", body: JSON.stringify({ name, kind, detail }) })
}

export function deleteAgentNote(id: string) {
  return request<void>(`/api/agents/${id}`, { method: "DELETE" })
}

export type Guards = { chaos: boolean; chaosFailPercent: number; chaosDelayMs: number; rpm: number; upstreamProxy: string }

export function getGuards() {
  return request<Guards>("/api/guards")
}

export function saveGuards(body: Guards) {
  return request<Guards>("/api/guards", { method: "PUT", body: JSON.stringify(body) })
}

export function previewCompression(mode: string, text: string) {
  return request<{ text: string; before: number; after: number }>("/api/compression/preview", { method: "POST", body: JSON.stringify({ mode, text }) })
}

export function translateBody(direction: string, body: unknown) {
  return request<{ body: unknown }>("/api/translate", { method: "POST", body: JSON.stringify({ direction, body }) })
}

export function auditLogs(source: string) {
  return request<{ logs: { id: number; createdAt: string; source: string; modelId: string; statusCode: number; errorMessage: string }[] }>(`/api/audit?source=${encodeURIComponent(source)}`)
}

export function changelogText() {
  return request<{ markdown: string }>("/api/changelog")
}

export function onboardingSteps() {
  return request<{ steps: { id: string; label: string; done: boolean }[] }>("/api/onboarding")
}

export function localFiles() {
  return request<{ files: { id: string; filename: string; bytes: number; purpose: string }[] }>("/api/files/local")
}

export function localBatches() {
  return request<{ batches: { id: string; status: string; endpoint: string; created_at: string }[] }>("/api/batches/local")
}

export function consoleLines() {
  return request<{ lines: string[] }>("/api/console")
}

export function formatTokens(value: number) {
  if (!value) return "—"
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${Number(millions.toFixed(2))}M`
  }
  return `${Math.round(value / 1000)}K`
}

export function formatPrice(value: number) {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: value < 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}
