import { formatLatency, plural } from '@/lib/format';

import type { ProviderTestResult } from './api';

/** "Connected · 38 models · 412 ms". */
export function testSummary(result: ProviderTestResult): string {
  const parts = ['Connected'];
  if (result.models) parts.push(plural(result.models.length, 'model'));
  parts.push(formatLatency(result.latency_ms));
  return parts.join(' · ');
}

/** Why a test failed, in plain words; the provider's own message goes in the details. */
export function testFailure(result: Pick<ProviderTestResult, 'status_code' | 'error'>): string {
  const code = result.status_code;
  if (code === 401) return 'The provider refused the key. Check that it is complete and still active.';
  if (code === 403) return 'The key works, but the provider doesn’t allow it to do this.';
  if (code === 404) return 'The provider’s address was found, but not its API. Check the base URL.';
  if (code === 429) return 'The provider is limiting requests right now. Try again in a minute.';
  if (code !== null && code >= 500) return 'The provider had a problem on its side. Try again in a minute.';
  if (code === null) return 'The gateway couldn’t reach the provider. Check the base URL and the network.';
  return `The provider answered ${String(code)}, so the test didn’t pass.`;
}

/** How the gateway tested: the provider's list of models, or the smallest request it takes. */
export const TEST_METHOD: Record<ProviderTestResult['method'], string> = {
  list_models: 'Asked for the provider’s list of models',
  minimal_call: 'Sent the smallest request the provider takes',
};
