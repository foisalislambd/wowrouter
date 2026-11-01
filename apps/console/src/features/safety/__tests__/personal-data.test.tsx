import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { pickOption, signInAs } from '@/test/utils';

import { PiiPanel } from '../components/pii-panel';
import { PII_ENTITIES } from '../rules';
import { CPF, META, rule, seed, WRITER, writes } from './pii-helpers';

function panel() {
  const edits: unknown[] = [];
  render(<PiiPanel onFilter={() => undefined} onEdit={(t) => edits.push(t)} />);
  return edits;
}

describe('the Personal data tab', () => {
  it('without a rule, creates one with the balanced preset on every prompt and answer in one step', async () => {
    signInAs(WRITER);
    seed([]);
    const box = writes();
    panel();
    expect(screen.getByText('No rule checks personal data')).toBeInTheDocument();
    const cards = screen.getByRole('list', { name: 'Kinds of personal data' });
    expect(within(cards).getAllByText('Not checked')).toHaveLength(PII_ENTITIES.length);
    expect(within(cards).queryByRole('switch')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn on personal data checks' }));
    await waitFor(() => expect(box.attached).not.toBeNull());
    expect(box.created).toEqual({
      name: 'personal_data',
      spec: {
        type: 'pii',
        enabled: true,
        action: 'redact',
        description: 'Replaces personal data with labels before a provider sees it.',
        pii: {
          entities: ['email', 'phone', 'credit_card', 'us_ssn', 'iban', 'ca_sin'],
          preserve: [],
        },
      },
    });
    expect(box.attached).toEqual({
      spec: { guardrails: { input: ['personal_data'], output: ['personal_data'] } },
    });
  });

  it('with one rule, says what it does and which kinds it checks, its own kinds included', () => {
    signInAs(WRITER);
    seed(
      [
        rule('pii_main', { pii: { entities: ['email'], reversible: true, custom: [CPF] } }),
        {
          name: 'entity_customer_id',
          spec: { type: 'regex', action: 'redact', regex: { deny: ['C-\\d+'], label: 'CUSTOMER_ID' } },
          metadata: META,
        },
      ],
      ['pii_main'],
    );
    panel();
    expect(screen.queryByRole('combobox', { name: 'Rule' })).not.toBeInTheDocument();
    expect(screen.getByText('Every prompt')).toBeInTheDocument();
    expect(screen.getByText('Put back')).toBeInTheDocument();
    const cards = screen.getByRole('list', { name: 'Kinds of personal data' });
    const cpf = within(cards).getByRole('button', { name: /^cpf/ });
    expect(cpf).toHaveTextContent(
      '2matches, 24 h[CPF_1]Checked by pii_mainYour pattern and CPF check digits',
    );
    expect(within(cards).getByRole('button', { name: /^CUSTOMER_ID/ })).toHaveTextContent(
      '[CUSTOMER_ID]Checked by entity_customer_idPattern rule, from Settings › Data & privacy',
    );
    expect(cpf).toHaveTextContent('2matches, 24 h[CPF_1]Checked by pii_mainYour pattern');
    expect(within(cards).getByRole('button', { name: /^Phone number/ })).toHaveTextContent('Not checked');
  });

  it('with two rules, lets one be chosen; the cards and switches follow it', async () => {
    signInAs(WRITER);
    seed(
      [
        rule('pii_main', { pii: { entities: ['email'] } }),
        rule('pii_strict', { pii: { entities: ['phone'] } }),
      ],
      ['pii_main'],
    );
    panel();
    expect(screen.getByText(/2 rules find personal data/)).toBeInTheDocument();
    const cards = screen.getByRole('list', { name: 'Kinds of personal data' });
    expect(within(cards).getByRole('button', { name: /^Phone number/ })).toHaveTextContent(
      'Checked by pii_strict',
    );
    expect(
      within(cards).getByRole('switch', { name: 'Look for phone number with pii_main' }),
    ).not.toBeChecked();
    await pickOption(screen.getByRole('combobox', { name: 'Rule' }), 'pii_strict');
    expect(
      within(cards).getByRole('switch', { name: 'Look for phone number with pii_strict' }),
    ).toBeChecked();
    expect(screen.getByText(/A preset sets which built-in kinds/)).toHaveTextContent('pii_strict');
  });

  it('turns a kind on from its card, writing the chosen rule with its ETag', async () => {
    signInAs(WRITER);
    seed([rule('pii_main', { pii: { entities: ['email'] } })], ['pii_main']);
    const box = writes(() => [rule('pii_main', { pii: { entities: ['email', 'phone'] } })]);
    panel();
    const cards = screen.getByRole('list', { name: 'Kinds of personal data' });
    expect(
      within(cards).getByRole('switch', { name: 'Look for email address with pii_main' }),
    ).toBeDisabled();
    await userEvent.click(within(cards).getByRole('switch', { name: 'Look for phone number with pii_main' }));
    await waitFor(() => expect(box.put).not.toBeNull());
    expect(box.put).toEqual({
      name: 'pii_main',
      body: { spec: { type: 'pii', action: 'redact', enabled: true, pii: { entities: ['email', 'phone'] } } },
      ifMatch: '"g7"',
    });
    await waitFor(() =>
      expect(
        within(cards).getByRole('switch', { name: 'Look for phone number with pii_main' }),
      ).toBeChecked(),
    );
  });

  it('turning a kind of the rule’s own off asks, then removes it from the rule', async () => {
    signInAs(WRITER);
    seed([rule('pii_main', { pii: { entities: ['email'], custom: [CPF] } })], ['pii_main']);
    const box = writes(() => [rule('pii_main', { pii: { entities: ['email'] } })]);
    panel();
    const cards = screen.getByRole('list', { name: 'Kinds of personal data' });
    await userEvent.click(within(cards).getByRole('switch', { name: 'Look for cpf with pii_main' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Stop looking for cpf with pii_main?' });
    expect(box.put).toBeNull();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Stop looking for it' }));
    await waitFor(() => expect(box.put).not.toBeNull());
    expect(box.put?.body).toEqual({
      spec: { type: 'pii', action: 'redact', enabled: true, pii: { entities: ['email'] } },
    });
  });
});
