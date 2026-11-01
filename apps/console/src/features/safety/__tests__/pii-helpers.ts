import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import type { GuardrailResource } from '@/lib/api/types';
import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { pickOption } from '@/test/utils';

import type { GuardrailSpec } from '../rules';
import { useSafety } from '../store';

/** Shared by the rule editor's and the Personal data tab's tests. */
export const WRITER = ['policies:read', 'policies:write'];
export const META = {
  etag: '"g7"',
  generation: 7,
  created_at: '',
  updated_at: '',
  managed_by: 'api' as const,
};
export const ready = <T>(data: T) => ({ data, status: 'ready' as const, error: null, at: Date.now() });
export const POLICIES_META = {
  etag: '"p1"',
  generation: 3,
  created_at: '',
  updated_at: '',
  managed_by: 'api' as const,
};

export const CPF = { name: 'cpf', pattern: '\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}', validate: 'cpf' as const };

export function rule(name: string, spec: Omit<GuardrailSpec, 'type'> = {}): GuardrailResource {
  return { name, spec: { type: 'pii', action: 'redact', enabled: true, ...spec }, metadata: META };
}

export function seed(guardrails: GuardrailResource[], input: string[] = []) {
  useSafety.setState({
    guardrails: ready(guardrails),
    policies: ready({ spec: { guardrails: { input, output: [] } }, metadata: POLICIES_META }),
    byEntity: ready({ phone: 4, cpf: 2 }),
    models: ready([]),
    runtime: emptySlot(),
  });
}

/** Records guardrail and policy writes; a read after a write answers `after`. */
export function writes(after: () => GuardrailResource[] = () => []) {
  const box: {
    created: unknown;
    put: { name: string; body: unknown; ifMatch: string | null } | null;
    attached: unknown;
    tested: unknown;
    testedByName: unknown;
  } = { created: null, put: null, attached: null, tested: null, testedByName: null };
  server.use(
    http.post('*/admin/v1/guardrails', async ({ request }) => {
      box.created = await request.json();
      return HttpResponse.json({}, { status: 201 });
    }),
    http.put('*/admin/v1/guardrails/:name', async ({ request, params }) => {
      box.put = {
        name: String(params.name),
        body: await request.json(),
        ifMatch: request.headers.get('if-match'),
      };
      return HttpResponse.json({});
    }),
    http.get('*/admin/v1/guardrails', () => HttpResponse.json({ items: after(), next_cursor: null })),
    http.get('*/admin/v1/settings/policies', () =>
      HttpResponse.json({ spec: { guardrails: { input: [], output: [] } }, metadata: POLICIES_META }),
    ),
    http.patch('*/admin/v1/settings/policies', async ({ request }) => {
      box.attached = await request.json();
      return HttpResponse.json({ spec: {}, metadata: POLICIES_META });
    }),
    http.post(/\/admin\/v1\/guardrails:test$/, async ({ request }) => {
      box.tested = await request.json();
      return HttpResponse.json({
        verdict: 'redact',
        category: 'pii',
        spans: [{ start: 4, end: 18, entity: 'cpf', replacement: '[CPF_1]' }],
        redacted: 'CPF [CPF_1] ok',
        restored: 'CPF 123.456.789-09 ok',
      });
    }),
    http.post('*/admin/v1/guardrails/:name\\:test', async ({ request }) => {
      box.testedByName = await request.json();
      return HttpResponse.json({ verdict: 'pass', category: null, spans: [], redacted: null });
    }),
  );
  return box;
}

export async function addCpf(drawer: HTMLElement) {
  const user = userEvent.setup();
  await user.click(within(drawer).getByRole('button', { name: 'Add a kind of personal data' }));
  const form = within(drawer).getByRole('group', { name: 'A kind of personal data' });
  await user.type(within(form).getByLabelText('Kind name'), 'cpf');
  // Braces are typed doubled: user-event reads one as a key name.
  await user.type(within(form).getByLabelText('Pattern'), '\\d{{3}\\.\\d{{3}\\.\\d{{3}-\\d{{2}');
  await pickOption(within(form).getByLabelText('Extra check'), 'CPF check digits (Brazil)');
  await user.click(within(form).getByRole('button', { name: 'Add kind' }));
}
