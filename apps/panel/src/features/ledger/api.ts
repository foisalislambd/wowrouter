import { api, listAll } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';

type S = components['schemas'];
export type LedgerLine = S['LedgerLine'];
export type SpendSummaryRow = S['SpendSummaryRow'];

/** What the ledger's spend can be broken down by: who is billed for it. */
export type ChargebackBy = 'team' | 'project' | 'key';

/** Exact totals of the lines a filter matches, however many of them were loaded. */
export interface SpendTotals {
  requests: number;
  lines: number;
  billed: number;
  cost: number;
  cacheSaved: number;
}

export interface LedgerQuery {
  from: string;
  to: string;
  organization?: string | undefined;
  team?: string | undefined;
  project?: string | undefined;
  key?: string | undefined;
  user?: string | undefined;
  end_user?: string | undefined;
  model?: string | undefined;
  deployment?: string | undefined;
  tag?: string | undefined;
  status?: string | undefined;
}

export const PAGE = 100;

/** The cost ledger: one request's lines, and pages of lines over a window. */
export const ledgerApi = {
  /** `id` is the request's log id, which ledger lines carry as `request_id`. */
  request: (id: string): Promise<LedgerLine[]> =>
    listAll((cursor) =>
      api.get('/reports/spend/requests/{request_id}', {
        path: { request_id: id },
        query: { limit: 200, cursor },
      }),
    ),
  page: (query: LedgerQuery, cursor?: string) =>
    api.get('/reports/spend/ledger', { query: { ...defined(query), limit: PAGE, cursor } }),
  /**
   * The spend of every line the ledger lists for the same window and filters, summed by the gateway:
   * one row, or one per group with `by`.
   */
  summary: (query: LedgerQuery, by?: ChargebackBy): Promise<SpendSummaryRow[]> =>
    listAll((cursor) =>
      api.get('/reports/spend/summary', {
        query: { ...defined(query), ...(by ? { group_by: [by] } : {}), limit: 200, cursor },
      }),
    ),
};

/** The filters that are set; an empty one is no filter. */
function defined(query: LedgerQuery): LedgerQuery {
  return Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== ''),
  ) as unknown as LedgerQuery;
}

/** Summary rows added up: the totals of a filter, or of every group. */
export function spendTotals(rows: SpendSummaryRow[]): SpendTotals {
  return rows.reduce<SpendTotals>(
    (t, r) => ({
      requests: t.requests + r.requests,
      lines: t.lines + r.lines,
      billed: t.billed + (Number(r.cost.billed_usd) || 0),
      cost: t.cost + (Number(r.cost.cost_usd) || 0),
      cacheSaved: t.cacheSaved + (Number(r.cache_saved_usd) || 0),
    }),
    { requests: 0, lines: 0, billed: 0, cost: 0, cacheSaved: 0 },
  );
}

export const STATUS_LABEL: Record<LedgerLine['status'], string> = {
  success: 'Succeeded',
  failed: 'Failed, not charged',
  failed_with_usage: 'Failed, charged its usage',
  cancelled: 'Cancelled',
  expired: 'Expired',
  cache_hit: 'Cache hit',
  adjustment: 'Adjustment',
};

export const STATUS_TONE: Record<LedgerLine['status'], 'success' | 'warn' | 'error' | 'neutral' | 'info'> = {
  success: 'success',
  failed: 'neutral',
  failed_with_usage: 'warn',
  cancelled: 'neutral',
  expired: 'warn',
  cache_hit: 'info',
  adjustment: 'info',
};

export const SOURCE_LABEL: Record<string, string> = {
  upstream: 'Reported by the provider',
  estimated: 'Estimated',
  cache: 'From the cache',
};

/** A spend adjustment entered by hand (`:adjust`), not a request's charge. */
export function isAdjustment(l: LedgerLine): boolean {
  return l.status === 'adjustment';
}

/** Where a line's usage came from, in words; an adjustment has no usage. */
export function usageSourceWord(l: LedgerLine): string {
  if (isAdjustment(l)) return 'Entered by hand';
  return SOURCE_LABEL[l.usage_source ?? ''] ?? '—';
}

/** What a line paid for, in words: the Model call, a tool or an agent. */
export function lineSubject(l: LedgerLine): string {
  if (isAdjustment(l)) return 'Spend adjustment';
  if (l.mcp_tool) return `Tool ${l.mcp_server ? `${l.mcp_server}__` : ''}${l.mcp_tool}`;
  if (l.a2a_agent) return `Agent ${l.a2a_agent}`;
  return l.model ?? l.deployment ?? '—';
}

/** The budgets a line charged, by their name or owner as the gateway lists them. */
export function budgetNames(l: LedgerLine): string[] {
  return (l.budgets ?? []).map((b) => {
    const name = typeof b.name === 'string' ? b.name : null;
    const level = typeof b.level === 'string' ? b.level : null;
    const owner = typeof b.owner === 'string' ? b.owner : null;
    return [level, owner, name].filter(Boolean).join('/') || JSON.stringify(b);
  });
}
