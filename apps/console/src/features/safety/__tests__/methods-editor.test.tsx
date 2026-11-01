import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { GuardrailResource } from '@/lib/api/types';
import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { pickOption, signInAs } from '@/test/utils';

import { RuleEditor } from '../components/rule-editor';
import type { GuardrailSpec } from '../rules';
import { useSafety } from '../store';

const META = { etag: '"g7"', generation: 7, created_at: '', updated_at: '', managed_by: 'api' as const };
const ready = <T,>(data: T) => ({ data, status: 'ready' as const, error: null, at: Date.now() });

function seed(guardrails: GuardrailResource[]) {
  useSafety.setState({
    guardrails: ready(guardrails),
    policies: emptySlot(),
    models: ready([]),
  });
}

/** Records guardrail writes; reads after a write answer the same list. */
function writes() {
  const box: { created: unknown; put: unknown; ifMatch: string | null } = {
    created: null,
    put: null,
    ifMatch: null,
  };
  server.use(
    http.post('*/admin/v1/guardrails', async ({ request }) => {
      box.created = await request.json();
      return HttpResponse.json({}, { status: 201 });
    }),
    http.put('*/admin/v1/guardrails/:name', async ({ request }) => {
      box.put = await request.json();
      box.ifMatch = request.headers.get('if-match');
      return HttpResponse.json({});
    }),
    http.get('*/admin/v1/guardrails', () => HttpResponse.json({ items: [], next_cursor: null })),
    http.get('*/admin/v1/providers', () =>
      HttpResponse.json({
        items: [
          { name: 'aws-main', spec: { type: 'bedrock' }, metadata: META },
          { name: 'openai', spec: { type: 'openai' }, metadata: META },
        ],
        next_cursor: null,
      }),
    ),
  );
  return box;
}

describe('the rule editor’s new methods', () => {
  it('creates a webhook rule that authenticates, with a header and a signing secret', async () => {
    signInAs(['policies:read', 'policies:write']);
    seed([]);
    const box = writes();
    render(<RuleEditor target={{ kind: 'new', method: 'webhook' }} onClose={() => undefined} />);
    const user = userEvent.setup();
    const drawer = await screen.findByRole('dialog', { name: 'New rule' });
    await user.type(within(drawer).getByLabelText('Name'), 'names_check');
    await user.type(within(drawer).getByLabelText('Service address'), 'https://check.example/v1');
    await user.click(within(drawer).getByRole('button', { name: 'Add header' }));
    await user.type(within(drawer).getByLabelText('Header 1 name'), 'authorization');
    await user.type(within(drawer).getByLabelText('Header 1 value'), 'Bearer abc');
    await user.type(within(drawer).getByLabelText(/Signing secret/), 'whsec_1');
    await user.click(within(drawer).getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(box.created).not.toBeNull());
    expect(box.created).toEqual({
      name: 'names_check',
      spec: {
        type: 'webhook',
        enabled: true,
        action: 'block',
        webhook: {
          url: 'https://check.example/v1',
          headers: { authorization: 'Bearer abc' },
          signing_secret: 'whsec_1',
        },
      },
    });
  });

  it('creates a Bedrock guardrail from a provider of the right type', async () => {
    signInAs(['policies:read', 'policies:write', 'providers:read']);
    seed([]);
    const box = writes();
    render(<RuleEditor target={{ kind: 'new', method: 'bedrock_guardrails' }} onClose={() => undefined} />);
    const user = userEvent.setup();
    const drawer = await screen.findByRole('dialog', { name: 'New rule' });
    await user.type(within(drawer).getByLabelText('Name'), 'aws_check');
    await pickOption(await within(drawer).findByRole('combobox', { name: /Provider/ }), 'aws-main');
    await user.type(within(drawer).getByLabelText('Guardrail id'), 'gr-9');
    await user.click(within(drawer).getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(box.created).not.toBeNull());
    expect(box.created).toEqual({
      name: 'aws_check',
      spec: {
        type: 'bedrock_guardrails',
        enabled: true,
        action: 'block',
        bedrock_guardrails: { provider: 'aws-main', guardrail_id: 'gr-9' },
      },
    });
  });

  const stored: [string, GuardrailSpec][] = [
    [
      'lakera_guard',
      {
        type: 'lakera',
        enabled: true,
        action: 'flag',
        on_error: 'allow',
        lakera: { api_key: '[REDACTED]', project_id: 'p-1' },
      },
    ],
    [
      'max_length',
      { type: 'length', enabled: true, action: 'block', length: { max_tokens: 8000 }, timeout: '1s' },
    ],
    [
      'house_style',
      { type: 'system_prompt', enabled: true, system_prompt: { text: 'Be brief.', mode: 'append' } },
    ],
  ];
  for (const [name, spec] of stored)
    it(`saves ${spec.type} unchanged, with a stored secret kept hidden`, async () => {
      signInAs(['policies:read', 'policies:write']);
      seed([{ name, spec, metadata: META }]);
      const box = writes();
      render(<RuleEditor target={{ kind: 'edit', name }} onClose={() => undefined} />);
      const user = userEvent.setup();
      const drawer = await screen.findByRole('dialog', { name });
      expect(drawer).not.toHaveTextContent('is set in the configuration');
      if (spec.type === 'lakera')
        expect(within(drawer).getByLabelText(/API key/)).toHaveAttribute(
          'placeholder',
          'Stored, hidden. Type to replace',
        );
      await user.click(within(drawer).getByRole('button', { name: 'Save rule' }));
      await waitFor(() => expect(box.put).not.toBeNull());
      expect(box.put).toEqual({ spec });
      expect(box.ifMatch).toBe('"g7"');
    });
});
