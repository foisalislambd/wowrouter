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
}

export type Overview = {
  providers: number
  activeModels: number
  routerKeys: number
  endpoint: string
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
    throw new Error(data.error || response.statusText)
  }
  return data as T
}

export function getOverview() {
  return request<Overview>("/api/overview")
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

export function listProviders(params?: { q?: string; category?: string; limit?: number; offset?: number }) {
  const search = new URLSearchParams()
  if (params?.q) search.set("q", params.q)
  if (params?.category && params.category !== "all") search.set("category", params.category)
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

export function testProvider(slug: string, body: { apiKey?: string; baseUrl?: string; accountId?: string }) {
  return request<{ ok: boolean; upstreamModels: number }>(`/api/providers/${slug}/test`, {
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

export function createKey(name: string) {
  return request<CreatedKey>("/api/keys", {
    method: "POST",
    body: JSON.stringify({ name }),
  })
}

export function deleteKey(id: string) {
  return request<void>(`/api/keys/${id}`, { method: "DELETE" })
}

export function listActivity() {
  return request<{ activity: ActivityItem[] }>("/api/activity")
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

export function getUsage() {
  return request<{
    rows: UsageRow[]
    totals: { requests: number; errors: number; promptTokens: number; completionTokens: number; costUsd: number }
  }>("/api/usage")
}

export function getSettings() {
  return request<{ dataDir: string; address: string; logCount: number }>("/api/settings")
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
  models: string[]
  createdAt: string
}

export function listFallbacks() {
  return request<{ fallbacks: FallbackChain[] }>("/api/fallbacks")
}

export function saveFallback(name: string, models: string[]) {
  return request<FallbackChain>("/api/fallbacks", {
    method: "POST",
    body: JSON.stringify({ name, models }),
  })
}

export function deleteFallback(id: string) {
  return request<void>(`/api/fallbacks/${id}`, { method: "DELETE" })
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
