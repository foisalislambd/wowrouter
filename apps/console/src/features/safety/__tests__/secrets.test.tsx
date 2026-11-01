import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { GuardrailResource } from '@/lib/api/types';
import { server } from '@/mocks/node';
import { useUi } from '@/stores/ui';
import { pickOption, signInAs } from '@/test/utils';

import { PiiPanel } from '../components/pii-panel';
import { type GuardrailSpec, SECRET_DETECTORS } from '../rules';
import { META, seed, WRITER, writes } from './pii-helpers';

function secretsRule(name: string, spec: Omit<GuardrailSpec, 'type'> = {}): GuardrailResource {
  return { name, spec: { type: 'secrets', action: 'redact', enabled: true, ...spec }, metadata: META };
}

function panel() {
  const edits: unknown[] = [];
  render(<PiiPanel onFilter={() => undefined} onEdit={(t) => edits.push(t)} />);
  return edits;
}

/** The section a panel heading opens. */
function section(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  const el = heading.closest('section');
  if (!el) throw new Error(`No section for ${title}`);
  return el;
}

const cards = () => screen.getByRole('list', { name: 'Kinds of secrets' });

describe('the Secrets section', () => {
  it('without a rule, adds one with every kind on every prompt and answer in one step', async () => {
    signInAs(WRITER);
    seed([]);
    const box = writes();
    const edits = panel();
    const rules = section('Secrets rule');
    expect(within(rules).getByText('No rule checks secrets')).toBeInTheDocument();
    expect(within(cards()).getAllByText('Not checked')).toHaveLength(SECRET_DETECTORS.length);
    expect(within(cards()).queryByRole('switch')).not.toBeInTheDocument();

    await userEvent.click(within(rules).getByRole('button', { name: 'Set it up yourself' }));
    expect(edits).toEqual([{ kind: 'new', method: 'secrets' }]);

    await userEvent.click(within(rules).getByRole('button', { name: 'Turn on secret checks' }));
    await waitFor(() => expect(box.attached).not.toBeNull());
    expect(box.created).toEqual({
      name: 'secrets',
      spec: {
        type: 'secrets',
        enabled: true,
        action: 'redact',
        description: 'Replaces keys and tokens with labels before a provider sees them.',
        secrets: {
          detectors: [
            'openai_key',
            'anthropic_key',
            'aws_access_key',
            'github_token',
            'slack_token',
            'google_api_key',
            'stripe_key',
            'jwt',
            'pem_private_key',
          ],
        },
      },
    });
    expect(box.attached).toEqual({ spec: { guardrails: { input: ['secrets'], output: ['secrets'] } } });
  });

  it('with one rule, names it, says what it does and which kinds it checks', () => {
    signInAs(WRITER);
    seed([secretsRule('sec_main', { secrets: { detectors: ['openai_key', 'github_token'] } })], ['sec_main']);
    panel();
    const rules = section('Secrets rule');
    expect(within(rules).getByText('sec_main')).toBeInTheDocument();
    expect(within(rules).queryByRole('combobox', { name: 'Rule' })).not.toBeInTheDocument();
    expect(within(rules).getByRole('button', { name: 'Edit rule' })).toBeInTheDocument();
    expect(within(rules).getByText('Every prompt')).toBeInTheDocument();
    expect(within(rules).getByText('Replaced with a label')).toBeInTheDocument();
    // Secrets are never put back, so that fact is left out.
    expect(within(rules).queryByText('Values in the answer')).not.toBeInTheDocument();
    expect(within(cards()).getByRole('button', { name: /^OpenAI key/ })).toHaveTextContent(
      '[OPENAI_KEY]Checked by sec_mainKnown prefix',
    );
    expect(within(cards()).getByRole('button', { name: /^Stripe key/ })).toHaveTextContent('Not checked');
    expect(within(cards()).getByRole('switch', { name: 'Look for OpenAI key with sec_main' })).toBeChecked();
    expect(
      within(cards()).getByRole('switch', { name: 'Look for Stripe key with sec_main' }),
    ).not.toBeChecked();
  });

  it('a rule that lists no kinds checks every one', () => {
    signInAs(WRITER);
    seed([secretsRule('sec_all', { action: 'block' })], ['sec_all']);
    panel();
    expect(within(cards()).getAllByText('Checked by sec_all')).toHaveLength(SECRET_DETECTORS.length);
    expect(within(cards()).getAllByText('Request refused')).toHaveLength(SECRET_DETECTORS.length);
  });

  it('with two rules, lets one be chosen; the cards and switches follow it', async () => {
    signInAs(WRITER);
    seed(
      [
        secretsRule('sec_main', { secrets: { detectors: ['openai_key'] } }),
        secretsRule('sec_cloud', { secrets: { detectors: ['aws_access_key'] } }),
      ],
      ['sec_main'],
    );
    panel();
    const rules = section('Secrets rules');
    expect(
      within(rules).getByText('2 rules find secrets · the cards change the one chosen'),
    ).toBeInTheDocument();
    expect(within(cards()).getByRole('button', { name: /^AWS access key/ })).toHaveTextContent(
      'Checked by sec_cloud',
    );
    expect(within(cards()).getByRole('button', { name: /^OpenAI key/ })).toHaveTextContent(
      'Checked by sec_main',
    );
    expect(
      within(cards()).getByRole('switch', { name: 'Look for AWS access key with sec_main' }),
    ).not.toBeChecked();
    await pickOption(within(rules).getByRole('combobox', { name: 'Rule' }), 'sec_cloud');
    expect(
      within(cards()).getByRole('switch', { name: 'Look for AWS access key with sec_cloud' }),
    ).toBeChecked();
  });

  it('turns a kind on from its card with the ETag, and Undo turns it off again', async () => {
    signInAs(WRITER);
    let current = secretsRule('sec_main', { secrets: { detectors: ['openai_key'] } });
    seed([current], ['sec_main']);
    const puts: { body: unknown; ifMatch: string | null }[] = [];
    server.use(
      http.put('*/admin/v1/guardrails/:name', async ({ request }) => {
        const body = (await request.json()) as { spec: GuardrailSpec };
        puts.push({ body, ifMatch: request.headers.get('if-match') });
        current = {
          ...current,
          spec: body.spec,
          metadata: { ...META, etag: `"g${7 + puts.length}"` },
        };
        return HttpResponse.json(current);
      }),
      http.get('*/admin/v1/guardrails', () => HttpResponse.json({ items: [current], next_cursor: null })),
    );
    panel();
    expect(within(cards()).getByRole('switch', { name: 'Look for OpenAI key with sec_main' })).toBeDisabled();
    await userEvent.click(within(cards()).getByRole('switch', { name: 'Look for Stripe key with sec_main' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      body: {
        spec: {
          type: 'secrets',
          action: 'redact',
          enabled: true,
          secrets: { detectors: ['openai_key', 'stripe_key'] },
        },
      },
      ifMatch: '"g7"',
    });
    await waitFor(() =>
      expect(
        within(cards()).getByRole('switch', { name: 'Look for Stripe key with sec_main' }),
      ).toBeChecked(),
    );

    const toast = useUi.getState().toasts.find((t) => t.title === 'sec_main looks for Stripe key');
    expect(toast?.action?.label).toBe('Undo');
    toast?.action?.onClick();
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]).toEqual({
      body: {
        spec: { type: 'secrets', action: 'redact', enabled: true, secrets: { detectors: ['openai_key'] } },
      },
      ifMatch: '"g8"',
    });
  });
});
