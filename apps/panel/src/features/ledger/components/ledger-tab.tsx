'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { useQueryParam, useScopedHref } from '@/components/layout/url-sync';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Segmented, Select } from '@/components/ui/form';
import { usePermission } from '@/components/ui/gate';
import { FilterBar, Panel } from '@/components/ui/layout';
import { EmptyState, ErrorState, isUnavailable, LoadingRows, UnavailableState } from '@/components/ui/states';
import { ExportCsvButton, Table, Td, Th, Tr } from '@/components/ui/table';
import { type CsvColumn } from '@/lib/csv';
import { formatMoney, plural, shortId } from '@/lib/format';
import { formatClock, formatDate, formatDateTime } from '@/lib/time';
import { Tooltip } from '@/components/ui/tooltip';
import { useUrlFilters } from '@/lib/url-filters';
import { usePreferences } from '@/stores/preferences';
import { scopeOrganization, useScope } from '@/stores/scope';
import { useQueryWindow } from '@/stores/time-range';

import {
  type ChargebackBy,
  isAdjustment,
  type LedgerLine,
  ledgerApi,
  type LedgerQuery,
  lineSubject,
  type SpendSummaryRow,
  spendTotals,
  STATUS_LABEL,
  STATUS_TONE,
  usageSourceWord,
} from '../api';

export const LEDGER_FILTERS = {
  team: '',
  project: '',
  key: '',
  user: '',
  end_user: '',
  model: '',
  deployment: '',
  tag: '',
  status: '',
};

type TextFilter = Exclude<keyof typeof LEDGER_FILTERS, 'status'>;

const MAIN_FILTERS: { key: TextFilter; label: string }[] = [
  { key: 'team', label: 'Team' },
  { key: 'key', label: 'API key' },
  { key: 'end_user', label: 'End user' },
  { key: 'model', label: 'Model' },
];

const MORE_FILTERS: { key: TextFilter; label: string }[] = [
  { key: 'project', label: 'Project' },
  { key: 'user', label: 'Key owner' },
  { key: 'deployment', label: 'Deployment' },
  { key: 'tag', label: 'Tag' },
];

const CSV: CsvColumn<LedgerLine>[] = [
  { header: 'request_id', value: (l) => l.request_id },
  { header: 'line', value: (l) => l.line },
  { header: 'settled_at', value: (l) => l.settled_at },
  { header: 'purpose', value: (l) => l.purpose },
  { header: 'status', value: (l) => l.status },
  { header: 'shadow', value: (l) => (l.shadow ? 'true' : 'false') },
  { header: 'organization', value: (l) => l.organization ?? '' },
  { header: 'team', value: (l) => l.team ?? '' },
  { header: 'project', value: (l) => l.project ?? '' },
  { header: 'key', value: (l) => l.key ?? '' },
  { header: 'user', value: (l) => l.user ?? '' },
  { header: 'end_user', value: (l) => l.end_user ?? '' },
  { header: 'model', value: (l) => l.model ?? '' },
  { header: 'deployment', value: (l) => l.deployment ?? '' },
  { header: 'mcp_server', value: (l) => l.mcp_server ?? '' },
  { header: 'mcp_tool', value: (l) => l.mcp_tool ?? '' },
  { header: 'a2a_agent', value: (l) => l.a2a_agent ?? '' },
  { header: 'usage_source', value: (l) => l.usage_source ?? '' },
  { header: 'cost_usd', value: (l) => l.cost_usd ?? '' },
  { header: 'billed_usd', value: (l) => l.billed_usd },
  { header: 'avoided_cost_usd', value: (l) => l.avoided_cost_usd ?? '' },
  { header: 'price_version', value: (l) => l.price_version ?? '' },
];

/** A text filter that applies on Enter or when it loses focus, so typing doesn't reload the list. */
function FilterInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const [text, setText] = useState<{ from: string; text: string }>({ from: value, text: value });
  const shown = text.from === value ? text.text : value;
  const commit = () => {
    if (shown.trim() !== value) onCommit(shown.trim());
  };
  return (
    <div className="w-40 max-sm:w-[calc(50%-4px)]">
      <Input
        icon="filter"
        aria-label={label}
        placeholder={label}
        value={shown}
        onChange={(e) => setText({ from: value, text: e.target.value })}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </div>
  );
}

function RequestLink({ line }: { line: LedgerLine }) {
  const href = useScopedHref('/request-log/', { request: line.request_id });
  // An adjustment is not a request: there is nothing to open.
  if (isAdjustment(line))
    return <span className="text-muted">{line.user ? `By ${line.user}` : 'No request'}</span>;
  return (
    <Tooltip content={line.request_id}>
      <Link href={href} className="mono text-accent hover:underline">
        {shortId(line.request_id, 14)}
      </Link>
    </Tooltip>
  );
}

type View = 'lines' | ChargebackBy;

const VIEWS: { value: View; label: string }[] = [
  { value: 'lines', label: 'Lines' },
  { value: 'team', label: 'By team' },
  { value: 'project', label: 'By project' },
  { value: 'key', label: 'By key' },
];

const BY_NOUN: Record<ChargebackBy, { label: string; none: string }> = {
  team: { label: 'Team', none: 'No team' },
  project: { label: 'Project', none: 'No project' },
  key: { label: 'API key', none: 'No key' },
};

interface Summary {
  key: string;
  rows: SpendSummaryRow[] | null;
  error: unknown;
}

/**
 * The gateway's sums of the ledger for the same window and filters (`GET /reports/spend/summary`):
 * null while it loads, and for a key that is not the current one.
 */
function useSpendSummary(query: LedgerQuery, key: string, by: ChargebackBy | null, enabled: boolean) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const summaryKey = `${key}|${by ?? ''}`;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    ledgerApi.summary(query, by ?? undefined).then(
      (rows) => {
        if (live) setSummary({ key: summaryKey, rows, error: null });
      },
      (error: unknown) => {
        if (live) setSummary({ key: summaryKey, rows: null, error });
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, query, by, summaryKey]);
  return summary?.key === summaryKey ? summary : null;
}

function groupName(row: SpendSummaryRow, by: ChargebackBy): string | null {
  const v = row.group[by];
  return typeof v === 'string' && v !== '' ? v : null;
}

/** Spend billed to each team, project or key for the window and filters, most billed first. */
function Chargeback({
  by,
  summary,
  onPick,
}: {
  by: ChargebackBy;
  summary: Summary | null;
  onPick: (name: string) => void;
}) {
  const rows = useMemo(
    () =>
      [...(summary?.rows ?? [])].sort(
        (a, b) => (Number(b.cost.billed_usd) || 0) - (Number(a.cost.billed_usd) || 0),
      ),
    [summary?.rows],
  );
  const noun = BY_NOUN[by];
  if (!summary) return <LoadingRows rows={5} label="Adding up the ledger" />;
  if (summary.error && isUnavailable(summary.error))
    return <UnavailableState subject="Spend totals" operation="GET /reports/spend/summary" size="sm" />;
  if (summary.error) return <ErrorState error={summary.error} subject="Spend totals" size="sm" />;
  if (rows.length === 0) return <EmptyState size="sm" title="No charges in this time range" />;
  return (
    <Table label={`Billed by ${noun.label.toLowerCase()}`}>
      <thead>
        <tr>
          <Th>{noun.label}</Th>
          <Th numeric>Requests</Th>
          <Th numeric className="max-md:hidden">
            Lines
          </Th>
          <Th numeric className="max-lg:hidden">
            Cost
          </Th>
          <Th numeric className="max-lg:hidden">
            Saved by the cache
          </Th>
          <Th numeric>Billed</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const name = groupName(r, by);
          return (
            <Tr key={name ?? ''}>
              <Td>
                {name ? (
                  <Tooltip content="Show its lines">
                    <button
                      type="button"
                      className="mono text-accent hover:underline"
                      onClick={() => onPick(name)}
                    >
                      {name}
                    </button>
                  </Tooltip>
                ) : (
                  <span className="text-muted">{noun.none}</span>
                )}
              </Td>
              <Td numeric>{r.requests.toLocaleString('en-US')}</Td>
              <Td numeric className="max-md:hidden">
                {r.lines.toLocaleString('en-US')}
              </Td>
              <Td numeric muted className="max-lg:hidden">
                {formatMoney(r.cost.cost_usd)}
              </Td>
              <Td numeric muted className="max-lg:hidden">
                {formatMoney(r.cache_saved_usd ?? 0)}
              </Td>
              <Td numeric>{formatMoney(r.cost.billed_usd)}</Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function chargebackCsv(by: ChargebackBy): CsvColumn<SpendSummaryRow>[] {
  return [
    { header: by, value: (r) => groupName(r, by) ?? '' },
    { header: 'requests', value: (r) => r.requests },
    { header: 'lines', value: (r) => r.lines },
    { header: 'cost_usd', value: (r) => r.cost.cost_usd },
    { header: 'billed_usd', value: (r) => r.cost.billed_usd },
    { header: 'cache_saved_usd', value: (r) => r.cache_saved_usd ?? '' },
  ];
}

interface Loaded {
  key: string;
  lines: LedgerLine[];
  cursor: string | null;
  error: unknown;
  loading: boolean;
}

/**
 * Budgets → Ledger: every charge the gateway recorded in the page's time range, line by line, with
 * the filters of the ledger API in the URL and each line linked to its request.
 */
export function LedgerTab() {
  const canRead = usePermission('analytics:read');
  const range = useQueryWindow();
  const scope = useScope((s) => s.scope);
  const timeZone = usePreferences((s) => s.timeZone);
  const { filters, set, clear, active } = useUrlFilters(LEDGER_FILTERS);
  const query: LedgerQuery = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      organization: scopeOrganization(scope) ?? undefined,
      ...filters,
    }),
    [range.from, range.to, scope, filters],
  );
  const key = JSON.stringify(query) + range.key;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const showMore = moreOpen || MORE_FILTERS.some((f) => filters[f.key] !== '');
  const [byParam, setBy] = useQueryParam('by');
  const by: ChargebackBy | null =
    byParam === 'team' || byParam === 'project' || byParam === 'key' ? byParam : null;
  const totals = useSpendSummary(query, key, null, canRead);
  const groups = useSpendSummary(query, key, by, canRead && by !== null);

  useEffect(() => {
    if (!canRead || by) return;
    let live = true;
    ledgerApi.page(query).then(
      (page) => {
        if (live)
          setLoaded({
            key,
            lines: page.items,
            cursor: page.next_cursor ?? null,
            error: null,
            loading: false,
          });
      },
      (error: unknown) => {
        if (live) setLoaded({ key, lines: [], cursor: null, error, loading: false });
      },
    );
    return () => {
      live = false;
    };
  }, [canRead, by, key, query]);

  const current = loaded?.key === key ? loaded : null;
  if (!canRead)
    return (
      <EmptyState
        title="You can't see the ledger"
        description="It needs the analytics permission."
        className="mx-gutter my-5"
      />
    );

  const lines = current?.lines ?? [];
  // The gateway's totals for the filters; the loaded lines' sum only when it can't say (an older
  // gateway), and then marked as such.
  const exact = totals?.rows ? spendTotals(totals.rows) : null;
  const loadedBilled = lines.reduce((a, l) => a + (Number(l.billed_usd) || 0), 0);

  const more = () => {
    if (!current?.cursor) return;
    setLoaded({ ...current, loading: true });
    ledgerApi.page(query, current.cursor).then(
      (page) =>
        setLoaded({
          ...current,
          lines: [...current.lines, ...page.items],
          cursor: page.next_cursor ?? null,
          loading: false,
        }),
      (error: unknown) => setLoaded({ ...current, error, loading: false }),
    );
  };

  return (
    <div className="flex flex-col">
      <FilterBar>
        <Segmented<View>
          label="Show"
          value={by ?? 'lines'}
          onChange={(v) => setBy(v === 'lines' ? null : v)}
          options={VIEWS}
        />
        {(showMore ? [...MAIN_FILTERS, ...MORE_FILTERS] : MAIN_FILTERS).map((f) => (
          <FilterInput
            key={f.key}
            label={f.label}
            value={filters[f.key]}
            onCommit={(v) => set({ [f.key]: v })}
          />
        ))}
        <div className="w-48 max-sm:w-full">
          <Select
            aria-label="Outcome"
            value={filters.status}
            onChange={(v) => set({ status: v })}
            emptyOption="Any outcome"
            options={(Object.keys(STATUS_LABEL) as LedgerLine['status'][]).map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
            }))}
          />
        </div>
        {showMore ? null : (
          <button
            type="button"
            className="text-ui text-muted hover:text-fg"
            onClick={() => setMoreOpen(true)}
          >
            More filters
          </button>
        )}
        {active ? (
          <button type="button" className="text-ui text-muted hover:text-fg" onClick={clear}>
            Clear filters
          </button>
        ) : null}
        <span className="ml-auto flex items-center gap-3">
          {exact && exact.lines > 0 ? (
            <span className="text-caption text-muted" aria-label="Totals">
              {plural(exact.lines, 'line')} ·{' '}
              <span className="mono text-fg">{formatMoney(exact.billed)}</span> billed
              <span className="max-lg:hidden">
                {' '}
                · <span className="mono">{formatMoney(exact.cost)}</span> cost
                {exact.cacheSaved > 0 ? (
                  <>
                    {' '}
                    · <span className="mono">{formatMoney(exact.cacheSaved)}</span> saved by the cache
                  </>
                ) : null}
              </span>
            </span>
          ) : !exact && totals && lines.length > 0 ? (
            <span className="text-caption text-muted">
              {plural(lines.length, 'line')}
              {current?.cursor ? ' loaded' : ''} ·{' '}
              <span className="mono text-fg">{formatMoney(loadedBilled)}</span> billed
            </span>
          ) : null}
          {by ? (
            <ExportCsvButton
              filename={`ledger-by-${by}`}
              columns={chargebackCsv(by)}
              rows={groups?.rows ?? []}
              label="Export totals (CSV)"
            />
          ) : (
            <ExportCsvButton
              filename="ledger"
              columns={CSV}
              rows={lines}
              label={current?.cursor ? 'Export loaded lines (CSV)' : 'Export lines (CSV)'}
            />
          )}
        </span>
      </FilterBar>
      {by ? (
        <Panel flush>
          <Chargeback
            by={by}
            summary={groups}
            onPick={(name) => {
              setBy(null);
              set({ [by]: name });
            }}
          />
        </Panel>
      ) : null}
      {by ? null : (
        <Panel flush>
          {!current ? <LoadingRows rows={5} label="Loading the ledger" /> : null}
          {current?.error && isUnavailable(current.error) ? (
            <UnavailableState subject="The cost ledger" operation="GET /reports/spend/ledger" size="sm" />
          ) : current?.error ? (
            <ErrorState error={current.error} subject="The ledger" size="sm" />
          ) : null}
          {current && !current.error && lines.length === 0 ? (
            <EmptyState
              size="sm"
              title={active ? 'No lines match these filters' : 'No charges in this time range'}
              description={active ? undefined : 'Pick a longer time range to see older ones.'}
            />
          ) : null}
          {lines.length > 0 ? (
            <Table label="Ledger lines">
              <thead>
                <tr>
                  <Th>Settled</Th>
                  <Th>Request</Th>
                  <Th>For</Th>
                  <Th className="max-md:hidden">Charged to</Th>
                  <Th>Outcome</Th>
                  <Th className="max-lg:hidden">Usage</Th>
                  <Th numeric>Billed</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <Tr key={`${l.request_id}-${l.line}`}>
                    <Td mono muted>
                      <Tooltip content={formatDateTime(l.settled_at, timeZone)}>
                        <span>
                          {formatDate(l.settled_at, timeZone)}, {formatClock(l.settled_at, timeZone)}
                        </span>
                      </Tooltip>
                    </Td>
                    <Td>
                      <RequestLink line={l} />
                      {l.line > 0 ? (
                        <span className="mono text-caption text-muted"> #{l.line + 1}</span>
                      ) : null}
                    </Td>
                    <Td>
                      <span className={isAdjustment(l) ? undefined : 'mono'}>{lineSubject(l)}</span>
                      {isAdjustment(l) ? null : (
                        <span className="text-caption text-muted">
                          {' '}
                          · {l.purpose}
                          {l.shadow ? ', shadow' : ''}
                        </span>
                      )}
                    </Td>
                    <Td muted className="max-md:hidden">
                      {[l.team, l.key].filter(Boolean).join(' · ') || '—'}
                      {l.end_user ? <span className="mono text-caption"> · {l.end_user}</span> : null}
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONE[l.status]} dot>
                        {STATUS_LABEL[l.status]}
                      </Badge>
                    </Td>
                    <Td muted className="max-lg:hidden">
                      {usageSourceWord(l)}
                    </Td>
                    <Td numeric>{formatMoney(l.billed_usd)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          ) : null}
        </Panel>
      )}
      {!by && current?.cursor ? (
        <div className="flex justify-center">
          <Button busy={current.loading} onClick={more}>
            Show more
          </Button>
        </div>
      ) : null}
      <p className="px-gutter py-3 text-caption text-muted max-sm:px-gutter-sm">
        One line per charge: a request&apos;s model call, a retry or a copy that was charged, a priced tool or
        agent call, and spend adjustments entered by hand. Newest first.{' '}
        {exact
          ? 'Totals cover every line that matches the filters in this time range.'
          : 'Totals cover the lines loaded.'}
      </p>
    </div>
  );
}
