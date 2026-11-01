import { api } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';

export type Anomaly = components['schemas']['Anomaly'];
export type AnomalyKind = Anomaly['kind'];

export interface AnomalyFilter {
  key?: string;
  /** Open or dismissed; empty for both. */
  state?: Anomaly['state'] | '';
  kind?: AnomalyKind | '';
}

/** Unusual key activity the gateway flagged: one flag, a filtered history, and a dismissal. */
export const anomaliesApi = {
  get: (id: string): Promise<Anomaly> => api.get('/anomalies/{anomaly_id}', { path: { anomaly_id: id } }),
  list: (filter: AnomalyFilter, cursor?: string) =>
    api.get('/anomalies', {
      query: {
        ...(filter.key ? { key: filter.key } : {}),
        ...(filter.state ? { state: filter.state } : {}),
        ...(filter.kind ? { kind: [filter.kind] } : {}),
        limit: 50,
        ...(cursor ? { cursor } : {}),
      },
    }),
  dismiss: (id: string): Promise<Anomaly> =>
    api.post('/anomalies/{anomaly_id}:dismiss', { path: { anomaly_id: id } }),
};

export const ANOMALY_KINDS: { value: AnomalyKind; label: string }[] = [
  { value: 'spike', label: 'Sudden spike in requests' },
  { value: 'network', label: 'Used from a new network' },
  { value: 'country', label: 'Used from a new country' },
  { value: 'user_agent', label: 'Used by an unfamiliar client' },
  { value: 'exposed', label: 'May have been exposed publicly' },
];

export function anomalyKindWords(kind: string): string {
  return ANOMALY_KINDS.find((k) => k.value === kind)?.label ?? kind.replace(/_/g, ' ');
}

const DETAIL_LABEL: Record<string, string> = {
  network: 'Network',
  client_ip: 'Client IP',
  country: 'Country',
  user_agent_family: 'Client',
  hour: 'Hour',
  requests: 'Requests that hour',
  baseline_hourly_mean: 'Usual requests per hour',
  spike_factor: 'Spike threshold',
};

/** What the gateway recorded about a flag ("Country: BR", "Usual requests per hour: 12"), in its order. */
export function anomalyDetail(a: Anomaly): { label: string; value: string }[] {
  return Object.entries(a.detail ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => ({
      label: DETAIL_LABEL[k] ?? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '),
      value:
        k === 'spike_factor' && typeof v === 'number'
          ? `${v}× the usual`
          : typeof v === 'object'
            ? JSON.stringify(v)
            : String(v as string | number | boolean),
    }));
}
