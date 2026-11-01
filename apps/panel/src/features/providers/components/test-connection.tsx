'use client';

import { Dot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { describeError } from '@/lib/api/client';

import type { ProviderTestResult } from '../api';
import { TEST_METHOD, testFailure, testSummary } from '../test-result';

export interface TestState {
  /** What the values were when tested (a fingerprint), to tell a result that still holds. */
  of: string;
  result: ProviderTestResult | null;
  /** The gateway refused the test itself (values it doesn't accept). */
  error: unknown;
}

/** Whether a test of exactly these values passed. */
export function passed(test: TestState | null, of: string): boolean {
  return test !== null && test.of === of && test.result?.ok === true;
}

/** Why a save waits for a test, or nothing when it can go ahead. */
export function testGateReason(test: TestState | null, of: string, what: string): string | undefined {
  if (passed(test, of)) return undefined;
  if (test === null) return `Test the connection before you ${what}.`;
  if (test.of !== of) return `You changed the details since the test. Test again before you ${what}.`;
  return `The test didn’t pass. Fix the details and test again before you ${what}.`;
}

/**
 * "Test connection" and its outcome, under the fields it tests: "Connected · 38 models · 412 ms",
 * or why it failed in plain words with the provider's answer behind "Details".
 */
export function TestConnection({
  test,
  of,
  busy,
  disabled,
  onTest,
  label = 'Test connection',
}: {
  test: TestState | null;
  of: string;
  busy: boolean;
  disabled?: boolean;
  onTest: () => void;
  label?: string;
}) {
  const current = test !== null && test.of === of ? test : null;
  const result = current?.result ?? null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button icon="play" size="sm" busy={busy} disabled={disabled} onClick={onTest}>
          {label}
        </Button>
        <div role="status" aria-live="polite" className="min-w-0 text-ui">
          {busy ? <span className="text-muted">Testing…</span> : null}
          {!busy && result?.ok ? (
            <span className="flex items-center gap-1.5 text-fg">
              <Dot tone="success" />
              {testSummary(result)}
            </span>
          ) : null}
          {!busy && test !== null && current === null ? (
            <span className="text-muted">Changed since the last test.</span>
          ) : null}
        </div>
      </div>
      {!busy && result && !result.ok ? (
        <div className="flex flex-col gap-1.5">
          <p role="alert" className="flex items-start gap-1.5 text-ui text-error">
            <Icon name="alertCircle" size={16} className="mt-px shrink-0" />
            {testFailure(result)}
          </p>
          <details className="group">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-xs text-caption text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
              <Icon name="chevronRight" size={12} className="transition-transform group-open:rotate-90" />
              Details
            </summary>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-caption">
              <dt className="text-muted">Answer</dt>
              <dd className="mono text-fg">
                {result.status_code === null ? 'No answer' : String(result.status_code)}
              </dd>
              <dt className="text-muted">Test</dt>
              <dd className="text-fg">{TEST_METHOD[result.method]}</dd>
              {result.upstream_request_id ? (
                <>
                  <dt className="text-muted">Provider’s request ID</dt>
                  <dd className="mono break-all text-fg">{result.upstream_request_id}</dd>
                </>
              ) : null}
              {result.error ? (
                <>
                  <dt className="text-muted">Message</dt>
                  <dd className="mono break-words whitespace-pre-wrap text-fg">{result.error}</dd>
                </>
              ) : null}
            </dl>
          </details>
        </div>
      ) : null}
      {!busy && current?.error ? (
        <p role="alert" className="flex items-start gap-1.5 text-ui text-error">
          <Icon name="alertCircle" size={16} className="mt-px shrink-0" />
          {describeError(current.error)}
        </p>
      ) : null}
    </div>
  );
}
