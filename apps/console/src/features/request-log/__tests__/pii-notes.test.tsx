import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { LogRecord } from '@/lib/api/types';
import { server } from '@/mocks/node';
import { signInAs } from '@/test/utils';

import { MessagesTab, ResponseTab } from '../components/drawer-content';
import { piiHandling } from '../pii';

const TOKENIZING = {
  type: 'pii',
  action: 'redact',
  pii: {
    entities: ['phone'],
    reversible: true,
    custom: [{ name: 'cpf', pattern: 'x', label: 'tax_id' }],
  },
};

function record(answer: string): LogRecord {
  return {
    id: 'r1',
    started_at: new Date().toISOString(),
    status_code: 200,
    usage: {},
    timing: {},
    stream: false,
    response_headers: {},
    guardrails: [
      {
        name: 'pii_main',
        stage: 'input',
        verdict: 'redact',
        spans: [
          { start: 8, end: 20, entity: 'phone' },
          { start: 30, end: 44, entity: 'tax_id' },
        ],
      },
      { name: 'pii_main', stage: 'output', verdict: 'pass', spans: [] },
    ],
    content: {
      request: {
        body: { messages: [{ role: 'user', content: 'Call me +1 555 0100, CPF 123.456.789-09' }] },
        truncated: false,
        original_bytes: 60,
      },
      response: {
        body: { choices: [{ message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] },
        truncated: false,
        original_bytes: 40,
      },
    },
  } as unknown as LogRecord;
}

function rules(spec: unknown = TOKENIZING) {
  server.use(
    http.get('*/admin/v1/guardrails/:name', ({ params }) =>
      HttpResponse.json({ name: params.name, spec, metadata: {} }),
    ),
  );
}

describe('personal data in the request drawer', () => {
  it('says the provider saw numbered placeholders and the answer got the values back', async () => {
    signInAs(['logs:read', 'logs:read_content', 'policies:read']);
    rules();
    render(<MessagesTab record={record('Calling +1 555 0100 now.')} />);
    expect(
      await screen.findByText('Personal data was tokenized before the provider saw it'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('note')[0]).toHaveTextContent(
      'These are the messages your app sent. pii_main replaced 2 values (phone number, cpf) with numbered placeholders such as [PHONE_1]; the provider saw those, and the answer got the real values back.',
    );
    expect(screen.getByText('Values were put back in the answer')).toBeInTheDocument();
  });

  it('warns on the Response tab when the stored answer still has placeholders', async () => {
    signInAs(['logs:read', 'logs:read_content', 'policies:read']);
    rules();
    render(<ResponseTab record={record('Calling [PHONE_1] now.')} />);
    expect(await screen.findByText('Placeholders were not put back')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('The stored answer still has [PHONE_1]');
  });

  it('does not say the values came back on the Messages tab when the answer still has placeholders', async () => {
    signInAs(['logs:read', 'logs:read_content', 'policies:read']);
    rules();
    const r = record('Calling [PHONE_1] now.');
    // Records name kinds as the rule labels them.
    const [input] = r.guardrails as { spans: { entity: string }[] }[];
    const [first] = input?.spans ?? [];
    if (first) first.entity = 'PHONE';
    render(<MessagesTab record={r} />);
    expect(await screen.findByText('Placeholders were not put back')).toBeInTheDocument();
    expect(screen.getAllByRole('note')[0]).toHaveTextContent(
      'pii_main replaced 2 values (phone number, cpf) with numbered placeholders such as [PHONE_1]; the provider saw those.',
    );
  });

  it('says values were replaced, without restore, for a rule that does not put them back', async () => {
    signInAs(['logs:read', 'logs:read_content', 'policies:read']);
    rules({ type: 'pii', action: 'redact' });
    render(<MessagesTab record={record('Done.')} />);
    expect(
      await screen.findByText('Personal data was replaced before the provider saw it'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Values were put back in the answer')).not.toBeInTheDocument();
  });

  it('reads the record alone where the rules cannot be read', () => {
    const h = piiHandling(record('[PHONE_1]'), {}, '[PHONE_1]');
    expect(h.replaced).toEqual([
      { rule: 'pii_main', counts: { phone: 1, tax_id: 1 }, tokenized: null, spec: null },
    ]);
    expect(h.tokenized).toBe(false);
    expect(h.leftInAnswer).toEqual([]);
  });
});
