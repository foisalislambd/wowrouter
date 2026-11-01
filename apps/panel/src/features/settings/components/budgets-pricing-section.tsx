'use client';

import { useEffect, useState } from 'react';

import { Field, Select, Switch } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { LoadError, LoadingRows } from '@/components/ui/states';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';

import { settingsApi } from '../api';
import { useTraffic } from '../traffic-store';
import { Card } from './parts';
import { CallPricesCard, MarkupsCard } from './pricing-tables';
import { Choice, Hint, lock, SettingsForm } from './settings-form';

type OnUnpriced = 'reject_if_budgeted' | 'zero';
type Catalog = 'bundled' | 'none';

export interface PricingValues {
  onUnpriced: OnUnpriced;
  catalog: Catalog;
  inBody: boolean;
}

export function pricingValues(
  spec: { on_unpriced?: OnUnpriced; catalog?: Catalog; report_in_body?: boolean } | undefined,
): PricingValues {
  return {
    onUnpriced: spec?.on_unpriced ?? SETTINGS_DEFAULTS.pricing.on_unpriced,
    catalog: spec?.catalog ?? SETTINGS_DEFAULTS.pricing.catalog,
    inBody: spec?.report_in_body ?? SETTINGS_DEFAULTS.pricing.report_in_body,
  };
}

const pricingSpec = (v: PricingValues) => ({
  on_unpriced: v.onUnpriced,
  catalog: v.catalog,
  report_in_body: v.inBody,
});

/** How requests to a Model without a price are counted, where prices come from and where cost shows. */
function PricingCard() {
  const pricing = useTraffic((s) => s.pricing);
  const save = useTraffic((s) => s.save);
  const canEdit = useCan('patchPricingSettings');
  return (
    <Card
      title="Prices"
      description="What a request to a Model without a price costs, and where prices come from."
    >
      <LoadError of={pricing} subject="Price settings" size="sm" />
      {pricing.status === 'loading' && !pricing.data ? <LoadingRows rows={3} /> : null}
      {pricing.data ? (
        <SettingsForm
          key={pricing.data.metadata.etag}
          initial={pricingValues(pricing.data.spec)}
          toSpec={pricingSpec}
          save={(patch) => save('pricing', patch)}
          canEdit={canEdit}
          saved="Price settings saved"
          paths={{ 'pricing.on_unpriced': 'onUnpriced', 'pricing.catalog': 'catalog' }}
        >
          {({ values, set, disabled }) => (
            <>
              <Choice<OnUnpriced>
                label="Requests to unpriced models"
                value={values.onUnpriced}
                onChange={(v) => set('onUnpriced', v)}
                options={lock(disabled, [
                  {
                    value: 'reject_if_budgeted',
                    label: 'Refuse them when a budget applies',
                    description:
                      'A request a budget covers is refused, so nothing is spent that the budget cannot count. Requests without a budget still pass.',
                  },
                  {
                    value: 'zero',
                    label: 'Count them as free',
                    description: 'They pass and cost nothing in budgets and reports.',
                  },
                ])}
              />
              <Choice<Catalog>
                label="Prices to use"
                value={values.catalog}
                onChange={(v) => set('catalog', v)}
                options={lock(disabled, [
                  {
                    value: 'bundled',
                    label: 'Built-in prices, then yours',
                    description: 'The prices that ship with the gateway, with the ones you set taking over.',
                  },
                  {
                    value: 'none',
                    label: 'Only the prices you set',
                    description: 'Any other Model is unpriced.',
                  },
                ])}
              />
              <div className="flex flex-col gap-1">
                <Switch
                  label="Add the cost to each answer's usage"
                  checked={values.inBody}
                  disabled={disabled}
                  onChange={(v) => set('inBody', v)}
                />
                <Hint>
                  Complete answers get the cost next to their token counts. The cost header is sent either
                  way.
                </Hint>
              </div>
            </>
          )}
        </SettingsForm>
      ) : null}
    </Card>
  );
}

type OnStore = 'fail_closed' | 'local_share';

export interface BudgetValues {
  onStore: OnStore;
  headers: boolean;
  auxiliary: boolean;
  sink: string;
}

const NO_SINK = '';

export function budgetValues(
  spec:
    | {
        on_store_unavailable?: OnStore;
        expose_headers?: boolean;
        charge_auxiliary?: boolean;
        alerts?: { sink?: string };
      }
    | undefined,
): BudgetValues {
  return {
    onStore: spec?.on_store_unavailable ?? SETTINGS_DEFAULTS.budgets.on_store_unavailable,
    headers: spec?.expose_headers ?? SETTINGS_DEFAULTS.budgets.expose_headers,
    auxiliary: spec?.charge_auxiliary ?? SETTINGS_DEFAULTS.budgets.charge_auxiliary,
    sink: spec?.alerts?.sink ?? NO_SINK,
  };
}

const budgetSpec = (v: BudgetValues) => ({
  on_store_unavailable: v.onStore,
  expose_headers: v.headers,
  charge_auxiliary: v.auxiliary,
  alerts: v.sink ? { sink: v.sink } : {},
});

/** The alert webhooks budget thresholds can go to, when the observability settings can be read. */
function useWebhooks(): string[] | null {
  const canRead = useCan('getObservabilitySettings');
  const [names, setNames] = useState<string[] | null>(null);
  useEffect(() => {
    if (!canRead) return;
    settingsApi.observabilitySettings().then(
      (o) => {
        const hooks = (o.spec.alerts as { webhooks?: Record<string, unknown> } | undefined)?.webhooks;
        setNames(Object.keys(hooks ?? {}));
      },
      () => setNames(null),
    );
  }, [canRead]);
  return names;
}

/** What budgets do when their store is down, the headers apps get and where threshold alerts go. */
function BudgetsCard() {
  const budgets = useTraffic((s) => s.budgets);
  const save = useTraffic((s) => s.save);
  const canEdit = useCan('patchBudgetsSettings');
  const webhooks = useWebhooks();
  return (
    <Card
      title="Budgets"
      description="How budgets behave for every organization. The budgets themselves are set in Budgets."
    >
      <LoadError of={budgets} subject="Budget settings" size="sm" />
      {budgets.status === 'loading' && !budgets.data ? <LoadingRows rows={3} /> : null}
      {budgets.data ? (
        <SettingsForm
          key={budgets.data.metadata.etag}
          initial={budgetValues(budgets.data.spec)}
          toSpec={budgetSpec}
          save={(patch) => save('budgets', patch)}
          canEdit={canEdit}
          saved="Budget settings saved"
          paths={{ 'budgets.alerts.sink': 'sink', 'budgets.on_store_unavailable': 'onStore' }}
        >
          {({ values, set, errors, disabled }) => {
            const sinks = [...new Set([...(webhooks ?? []), ...(values.sink ? [values.sink] : [])])];
            return (
              <>
                <Field
                  label="If the budget store can't be reached"
                  error={errors.onStore}
                  hint="The store keeps the spend every node counts."
                >
                  <Select
                    value={values.onStore}
                    disabled={disabled}
                    onChange={(v) => set('onStore', v as OnStore)}
                    options={[
                      { value: 'fail_closed', label: 'Refuse requests a budget covers' },
                      { value: 'local_share', label: 'Keep going, each node with its share of the budget' },
                    ]}
                  />
                </Field>
                <div className="flex flex-col gap-1">
                  <Switch
                    label="Tell apps what is left of their budget"
                    checked={values.headers}
                    disabled={disabled}
                    onChange={(v) => set('headers', v)}
                  />
                  <Hint>Answers carry the remaining budget and when it resets, in response headers.</Hint>
                </div>
                <div className="flex flex-col gap-1">
                  <Switch
                    label="Charge side calls to the request's budgets"
                    checked={values.auxiliary}
                    disabled={disabled}
                    onChange={(v) => set('auxiliary', v)}
                  />
                  <Hint>
                    Calls the gateway makes for a request, such as guardrail checks, routing decisions and
                    cache lookups. Off, they count only toward gateway-wide budgets.
                  </Hint>
                </div>
                <Field
                  label="Send threshold alerts to"
                  error={errors.sink}
                  hint={
                    webhooks?.length === 0
                      ? 'Add an event webhook in Webhooks & audit copies first.'
                      : 'An event webhook, besides the alert rules that watch budgets.'
                  }
                >
                  <Select
                    value={values.sink}
                    disabled={disabled || (sinks.length === 0 && !values.sink)}
                    onChange={(v) => set('sink', v)}
                    options={[
                      { value: NO_SINK, label: 'Alert rules only' },
                      ...sinks.map((n) => ({ value: n, label: n })),
                    ]}
                  />
                </Field>
              </>
            );
          }}
        </SettingsForm>
      ) : null}
    </Card>
  );
}

/** Budgets & pricing: gateway-wide budget behaviour and how unpriced requests are counted. */
export function BudgetsPricingSection() {
  const load = useTraffic((s) => s.load);
  const canPricing = useCan('getPricingSettings');
  const canBudgets = useCan('getBudgetsSettings');
  useEffect(() => {
    void load([...(canPricing ? (['pricing'] as const) : []), ...(canBudgets ? (['budgets'] as const) : [])]);
  }, [load, canPricing, canBudgets]);
  return (
    <>
      {canPricing ? (
        <>
          <PricingCard />
          <MarkupsCard />
          <CallPricesCard />
        </>
      ) : null}
      {canBudgets ? <BudgetsCard /> : null}
    </>
  );
}
