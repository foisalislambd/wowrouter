import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '@/mocks/node';
import { signInAs } from '@/test/utils';

import { RuleEditor } from '../components/rule-editor';
import { PII_ENTITIES } from '../rules';
import { addCpf, CPF, rule, seed, WRITER, writes } from './pii-helpers';

describe('kinds of personal data of a rule’s own', () => {
  it('adds a CPF in the editor: a checkbox beside the built-ins, written to the rule', async () => {
    signInAs(WRITER);
    seed([]);
    const box = writes();
    render(<RuleEditor target={{ kind: 'new', method: 'pii' }} onClose={() => undefined} />);
    const user = userEvent.setup();
    const drawer = await screen.findByRole('dialog', { name: 'New rule' });
    await user.type(within(drawer).getByLabelText('Name'), 'brazil_pii');
    await addCpf(drawer);
    expect(within(drawer).getByRole('checkbox', { name: 'cpf' })).toBeChecked();
    expect(within(drawer).getByRole('list', { name: 'Kinds of your own' })).toHaveTextContent('cpf');
    expect(drawer).toHaveTextContent('[CPF] · Your pattern and CPF check digits');
    await user.click(within(drawer).getByRole('checkbox', { name: /Put the values back/ }));
    expect(drawer).toHaveTextContent('[CPF_1] · Your pattern and CPF check digits');
    await user.click(within(drawer).getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(box.created).not.toBeNull());
    expect(box.created).toEqual({
      name: 'brazil_pii',
      spec: {
        type: 'pii',
        enabled: true,
        action: 'redact',
        pii: { entities: PII_ENTITIES, custom: [CPF], reversible: true },
      },
    });
  });

  it('refuses a kind named like a built-in one', async () => {
    signInAs(WRITER);
    seed([]);
    writes();
    render(<RuleEditor target={{ kind: 'new', method: 'pii' }} onClose={() => undefined} />);
    const user = userEvent.setup();
    const drawer = await screen.findByRole('dialog', { name: 'New rule' });
    await user.click(within(drawer).getByRole('button', { name: 'Add a kind of personal data' }));
    const form = within(drawer).getByRole('group', { name: 'A kind of personal data' });
    await user.type(within(form).getByLabelText('Kind name'), 'email');
    await user.type(within(form).getByLabelText('Pattern'), 'x@y');
    await user.click(within(form).getByRole('button', { name: 'Add kind' }));
    expect(form).toHaveTextContent('email is a built-in kind: tick it instead');
    expect(within(drawer).queryByRole('list', { name: 'Kinds of your own' })).not.toBeInTheDocument();
  });
});

describe('testing a rule from the editor', () => {
  it('tests a new rule with the form’s values, before it is created, and shows what restore gives back', async () => {
    signInAs(WRITER);
    seed([]);
    const box = writes();
    render(<RuleEditor target={{ kind: 'new', method: 'pii' }} onClose={() => undefined} />);
    const user = userEvent.setup();
    const drawer = await screen.findByRole('dialog', { name: 'New rule' });
    await addCpf(drawer);
    await user.click(within(drawer).getByRole('checkbox', { name: /Put the values back/ }));
    const test = within(drawer).getByRole('region', { name: 'Test this rule' });
    await user.type(within(test).getByLabelText('Sample text'), 'CPF 123.456.789-09 ok');
    await user.click(within(test).getByRole('button', { name: 'Run test' }));
    const status = await within(test).findByRole('status');
    expect(box.tested).toEqual({
      spec: {
        type: 'pii',
        enabled: true,
        action: 'redact',
        pii: { entities: PII_ENTITIES, custom: [CPF], reversible: true },
      },
      input: { stage: 'input', text: 'CPF 123.456.789-09 ok' },
    });
    expect(box.created).toBeNull();
    expect(status).toHaveTextContent('Redact');
    expect(within(status).getByRole('list', { name: 'What each match became' })).toHaveTextContent(
      '123.456.789-09 → [CPF_1]',
    );
    expect(status).toHaveTextContent('What the provider getsCPF [CPF_1] ok');
    expect(status).toHaveTextContent('What restore gives backCPF 123.456.789-09 ok');
  });

  it('tests a saved rule’s unsaved changes, and an unchanged one by name', async () => {
    signInAs(WRITER);
    seed([rule('pii_main', { pii: { entities: ['email'] } })]);
    const box = writes();
    render(<RuleEditor target={{ kind: 'edit', name: 'pii_main' }} onClose={() => undefined} />);
    const user = userEvent.setup();
    const drawer = await screen.findByRole('dialog', { name: 'pii_main' });
    const test = within(drawer).getByRole('region', { name: 'Test this rule' });
    await user.type(within(test).getByLabelText('Sample text'), 'call 555 0100');
    await user.click(within(test).getByRole('button', { name: 'Run test' }));
    await within(test).findByRole('status');
    expect(box.testedByName).toEqual({ stage: 'input', text: 'call 555 0100' });
    expect(box.tested).toBeNull();
    await user.click(within(drawer).getByRole('checkbox', { name: 'Phone number' }));
    await user.click(within(test).getByRole('button', { name: 'Run test' }));
    await waitFor(() => expect(box.tested).not.toBeNull());
    expect(box.tested).toMatchObject({ name: 'pii_main', spec: { pii: { entities: ['email', 'phone'] } } });
    expect(box.put).toBeNull();
  });

  it('says to create the rule first where the gateway tests saved rules only', async () => {
    signInAs(WRITER);
    seed([]);
    writes();
    server.use(
      http.post(/\/admin\/v1\/guardrails:test$/, () =>
        HttpResponse.json(
          { error: { code: 'not_found', message: 'The resource does not exist.' } },
          { status: 404 },
        ),
      ),
    );
    render(<RuleEditor target={{ kind: 'new', method: 'pii' }} onClose={() => undefined} />);
    const user = userEvent.setup();
    const drawer = await screen.findByRole('dialog', { name: 'New rule' });
    const test = within(drawer).getByRole('region', { name: 'Test this rule' });
    await user.type(within(test).getByLabelText('Sample text'), 'a@b.co');
    await user.click(within(test).getByRole('button', { name: 'Run test' }));
    expect(await within(test).findByText(/Create the rule, then test it/)).toBeInTheDocument();
  });
});
