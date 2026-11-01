'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { useSettingsHref } from '@/components/layout/url-sync';
import { useCan } from '@/components/ui/gate';
import { Section } from '@/components/ui/layout';
import { CopyButton } from '@/components/ui/misc';
import { LoadError, LoadingRows } from '@/components/ui/states';
import { formatCount } from '@/lib/format';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';

import { useOrgSettings } from '../store';
import { Facts } from './parts';
import { prometheusValues } from './prometheus-drawer';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {});

const TENANT: Record<string, string> = { organization: 'Organization', team: 'Team', project: 'Project' };

/** The scrape address: the console's own origin (the admin listener) and the metrics path. */
export function scrapeAddress(path: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}${path}`;
}

/**
 * The Prometheus endpoint as an operator reads it on Status: where to scrape, whether a token is
 * needed, and what the series carry. The endpoint is edited from its Notifications tile, which this
 * links to, so there is one form for it.
 */
export function MetricsCard() {
  const canRead = useCan('getObservabilitySettings');
  const observability = useOrgSettings((s) => s.observability);
  const notificationsHref = useSettingsHref('notifications');
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    if (canRead && observability.status === 'idle') void useOrgSettings.getState().loadObservability();
  }, [canRead, observability.status]);
  useEffect(() => {
    // The page's origin is known only in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);
  if (!canRead) return null;
  const metrics = obj(obj(observability.data?.spec).metrics);
  const v = prometheusValues(metrics);
  const d = SETTINGS_DEFAULTS.observability.metrics;
  const custom = Object.keys(obj(metrics.custom_labels));
  const excluded = Array.isArray(metrics.exclude_families) ? (metrics.exclude_families as string[]) : [];
  const perFamily =
    typeof metrics.max_series_per_family === 'number'
      ? metrics.max_series_per_family
      : d.max_series_per_family;
  const address = scrapeAddress(v.path, origin);
  return (
    <Section
      title="Metrics"
      subtitle="What Prometheus scrapes from the admin listener."
      actions={
        <Link href={notificationsHref} className="text-ui text-accent hover:underline">
          Change in Notifications
        </Link>
      }
    >
      {observability.status === 'loading' && !observability.data ? <LoadingRows rows={3} /> : null}
      <LoadError of={observability} subject="Metrics settings" size="sm" />
      {observability.data ? (
        <Facts
          items={[
            {
              label: 'Prometheus endpoint',
              value: v.enabled ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="mono break-all">{address}</span>
                  {origin ? <CopyButton value={address} label="Copy the scrape address" /> : null}
                </span>
              ) : (
                <Badge>Off</Badge>
              ),
            },
            ...(v.enabled
              ? [
                  {
                    label: 'Scraping needs',
                    value: v.token ? (
                      'An admin token whose role can read metrics'
                    ) : (
                      <span className="text-warn">Nothing: anyone who can reach the admin listener</span>
                    ),
                  },
                  {
                    label: 'Series broken down by',
                    value:
                      v.tenantLabels.length || custom.length
                        ? [
                            ...v.tenantLabels.map((t) => TENANT[t] ?? t),
                            ...custom.map((c) => `${c} (from request metadata)`),
                          ].join(', ')
                        : 'Nothing: gateway totals only',
                  },
                  {
                    label: 'Most series per metric',
                    value: formatCount(perFamily),
                    hint: 'Past it, new label values are counted under one overflow series.',
                  },
                  ...(excluded.length
                    ? [
                        {
                          label: 'Metrics left out',
                          value: <span className="mono">{excluded.join(', ')}</span>,
                        },
                      ]
                    : []),
                ]
              : []),
          ]}
        />
      ) : null}
    </Section>
  );
}
