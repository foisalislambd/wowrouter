import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { signInAs } from '@/test/utils';

import { JwtIssuersCard, jwtForm, jwtSpec } from '../components/jwt-issuers';
import { mergePatch } from '../form-errors';
import { useOrgSettings } from '../store';

const meta = {
  etag: '"6"',
  generation: 6,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  managed_by: 'api',
};

const STORED = {
  issuer: 'https://login.example.com',
  audiences: ['antirion'],
  hmac_secret: '[REDACTED]',
  algorithms: ['HS256' as const],
  mappings: [{ match: { claims: { sub: ['svc-a', 'svc-b'], tenant: 'acme' } }, key: 'svc-jwt' }],
};

describe('JWT issuer form', () => {
  it('keeps a stored secret and the claims a row does not show', () => {
    const form = jwtForm('workforce', STORED);
    expect(form.source).toBe('hmac');
    expect(form.mappings[0]).toMatchObject({ claim: 'sub', values: 'svc-a, svc-b', key: 'svc-jwt' });
    const patch = mergePatch(STORED, jwtSpec(form), ['hmac_secret', 'jwks']);
    expect(patch).not.toHaveProperty('hmac_secret');
    expect(patch).not.toHaveProperty('mappings');
  });

  it('drops the secret when the issuer moves to a public keys address', () => {
    const form = {
      ...jwtForm('workforce', STORED),
      source: 'jwks_uri' as const,
      jwksUri: 'https://login.example.com/jwks',
    };
    expect(mergePatch(STORED, jwtSpec(form), ['hmac_secret', 'jwks'])).toMatchObject({
      hmac_secret: null,
      jwks_uri: 'https://login.example.com/jwks',
    });
  });
});

describe('JWT issuers', () => {
  beforeEach(() => {
    signInAs(['security:read', 'security:write', 'keys:read']);
    useOrgSettings.setState({
      auth: emptySlot(),
      observability: emptySlot(),
      limits: emptySlot(),
      security: emptySlot(),
    });
  });

  it('adds an issuer whose tokens act as a JWT key', async () => {
    const patches: unknown[] = [];
    server.use(
      http.get('*/admin/v1/settings/auth', () => HttpResponse.json({ spec: {}, metadata: meta })),
      http.patch('*/admin/v1/settings/auth', async ({ request }) => {
        patches.push(await request.json());
        return HttpResponse.json({ spec: {}, metadata: meta });
      }),
      http.get('*/admin/v1/settings/observability', () => HttpResponse.json({ spec: {}, metadata: meta })),
      http.get('*/admin/v1/settings/limits', () => HttpResponse.json({ spec: {}, metadata: meta })),
      http.get('*/admin/v1/settings/security', () => HttpResponse.json({ spec: {}, metadata: meta })),
      http.get('*/admin/v1/keys', () =>
        HttpResponse.json({
          items: [
            { name: 'svc-jwt', spec: { project: 'p', kind: 'jwt' }, metadata: meta },
            { name: 'plain', spec: { project: 'p' }, metadata: meta },
          ],
          next_cursor: null,
        }),
      ),
    );
    render(<JwtIssuersCard />);
    expect(await screen.findByText('No JWT issuers')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add issuer' }));
    const drawer = await screen.findByRole('dialog');
    await userEvent.type(within(drawer).getByRole('textbox', { name: /^Name/ }), 'workforce');
    await userEvent.type(
      within(drawer).getByRole('textbox', { name: /^Issuer/ }),
      'https://login.example.com',
    );
    await userEvent.type(within(drawer).getByRole('combobox', { name: /Audiences/ }), 'antirion{Enter}');
    await userEvent.type(
      within(drawer).getByRole('textbox', { name: /Public keys address/ }),
      'https://login.example.com/jwks',
    );
    await userEvent.click(within(drawer).getByRole('button', { name: 'Add issuer' }));
    expect(await within(drawer).findByText(/Add at least one rule/)).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Add rule' }));
    await userEvent.type(within(drawer).getByRole('textbox', { name: 'Is one of' }), 'svc-a');
    const keyPicker = within(drawer).getByRole('combobox', { name: 'Acts as key' });
    await userEvent.click(keyPicker);
    const list = await screen.findByRole('listbox');
    expect(within(list).queryByRole('option', { name: 'plain' })).not.toBeInTheDocument();
    await userEvent.click(within(list).getByRole('option', { name: 'svc-jwt' }));
    await userEvent.click(within(drawer).getByRole('button', { name: 'Add issuer' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({
      spec: {
        jwt: {
          workforce: {
            issuer: 'https://login.example.com',
            audiences: ['antirion'],
            jwks_uri: 'https://login.example.com/jwks',
            mappings: [{ match: { claims: { sub: 'svc-a' } }, key: 'svc-jwt' }],
          },
        },
      },
    });
  });
});
