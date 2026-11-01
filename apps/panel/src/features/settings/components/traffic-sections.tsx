'use client';

import { BudgetsPricingSection } from './budgets-pricing-section';
import { CacheSection } from './cache-section';
import { CatalogSection } from './catalog-section';
import { GuardrailsSection } from './guardrails-section';
import { RoutingResilienceSection } from './routing-resilience-section';
import type { Section } from './sections';

/**
 * Gateway-wide settings of the traffic itself: what requests cost, what is cached, what guardrails
 * do and how requests are routed and retried. The feature pages edit the parts that belong to one
 * Model, budget or guardrail; these are the defaults and switches behind them.
 */
export const TRAFFIC_SECTIONS: Section[] = [
  {
    id: 'budgets-pricing',
    permission: ['pricing:read', 'policies:read'],
    label: 'Budgets & pricing',
    icon: 'wallet',
    description:
      'How unpriced requests are counted, markups and tool prices, and how budgets behave for every organization.',
    aliases: ['pricing', 'budgets'],
    render: () => <BudgetsPricingSection />,
  },
  {
    id: 'catalog',
    permission: 'models:read',
    label: 'Model catalog',
    icon: 'book',
    description:
      'Prices and capabilities the gateway knows for each Model, your own entries, and models.dev data.',
    render: () => <CatalogSection />,
  },
  {
    id: 'cache',
    permission: 'policies:read',
    label: 'Cache',
    icon: 'cache',
    description: 'Whether answers are cached by default, and where cached answers are kept.',
    render: () => <CacheSection />,
  },
  {
    id: 'guardrails',
    permission: 'policies:read',
    label: 'Guardrails',
    icon: 'shield',
    description: 'What guardrails do with what they can’t read, on tool calls and on streamed answers.',
    render: () => <GuardrailsSection />,
  },
  {
    id: 'routing-resilience',
    permission: ['policies:read', 'models:read', 'config:read'],
    label: 'Routing & resilience',
    icon: 'route',
    description:
      'Unhealthy deployments, retries and timeouts, routing behaviour, headers and translation, and admission.',
    aliases: ['routing', 'resilience'],
    render: () => <RoutingResilienceSection />,
  },
];
