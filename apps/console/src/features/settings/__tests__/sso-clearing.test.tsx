import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { signInAs } from '@/test/utils';

import { ProviderDrawer } from '../components/provider-drawer';
import { mergePatch } from '../form-errors';
import { providerForm, providerRows, providerSpec, type Sso } from '../sso';
import { useOrgSettings } from '../store';

const meta = {
  etag: '"3"',
  generation: 3,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  managed_by: 'api',
};

const SSO: Sso = {
  saml: {
    corp: {
      display_name: 'Corp',
      idp: { metadata_url: 'https://idp.example/metadata', metadata_refresh: '24h' },
      sp_entity_id: 'https://gateway.example/saml',
      email_attribute: 'mail',
      allowed_email_domains: ['example.com'],
    },
  },
  oauth: {
    github: {
      type: 'github',
      client_id: 'g',
      client_secret: '[REDACTED]',
      api_base_url: 'https://github.example/api/v3',
    },
  },
  oidc: {
    okta: {
      issuer: 'https://okta.example',
      client_id: 'c',
      allowed_email_domains: ['example.com', 'example.org'],
    },
  },
};

/** The patch the drawer sends for a provider whose form was edited by `edit`. */
function patchFor(
  protocol: 'oidc' | 'saml' | 'oauth',
  name: string,
  edit: (f: ReturnType<typeof providerForm>) => void,
) {
  const row = providerRows(SSO).find((r) => r.protocol === protocol && r.name === name);
  if (!row) throw new Error(name);
  const form = providerForm(protocol, name, row.spec);
  edit(form);
  return mergePatch(row.spec, providerSpec(form), ['client_secret']);
}

describe('clearing a single sign-on provider field', () => {
  it('sends null for each field emptied, so the gateway removes it', () => {
    expect(
      patchFor('saml', 'corp', (f) => {
        f.domains = [];
        f.spEntityId = '';
        f.emailAttribute = '';
        f.displayName = '';
      }),
    ).toMatchObject({
      display_name: null,
      sp_entity_id: null,
      email_attribute: null,
      allowed_email_domains: null,
    });
    expect(patchFor('oauth', 'github', (f) => (f.apiBase = '  '))).toMatchObject({ api_base_url: null });
    expect(patchFor('oidc', 'okta', (f) => (f.domains = []))).toMatchObject({ allowed_email_domains: null });
  });

  it('sends null even when the copy the form opened from lacks the field', () => {
    // Opened before someone else set the gateway entity ID; this person leaves it empty.
    const { sp_entity_id: _, ...opened } = SSO.saml?.corp ?? { idp: {} };
    const form = providerForm('saml', 'corp', opened);
    expect(mergePatch(opened, providerSpec(form))).toMatchObject({ sp_entity_id: null });
  });

  it('drops the old identity provider source when the details change source', () => {
    expect(
      patchFor('saml', 'corp', (f) => {
        f.idpSource = 'metadata';
        f.metadata = '<EntityDescriptor/>';
      }),
    ).toMatchObject({ idp: { metadata: '<EntityDescriptor/>', metadata_url: null, metadata_refresh: null } });
  });
});

describe('provider drawer', () => {
  const list = () => HttpResponse.json({ items: [], next_cursor: null });
  let patches: unknown[] = [];

  beforeEach(() => {
    signInAs(['security:read', 'security:write']);
    useOrgSettings.setState({
      auth: { data: { spec: { admin: { sso: SSO } }, metadata: meta }, status: 'ready', error: null, at: 1 },
      observability: emptySlot(),
      limits: emptySlot(),
      security: emptySlot(),
    });
    patches = [];
    server.use(
      http.patch('*/admin/v1/settings/auth', async ({ request }) => {
        patches.push(await request.json());
        return HttpResponse.json({ spec: {}, metadata: meta });
      }),
      http.get('*/admin/v1/settings/auth', () => HttpResponse.json({ spec: {}, metadata: meta })),
      http.get('*/admin/v1/roles', list),
      http.get('*/admin/v1/organizations', list),
      http.get('*/admin/v1/teams', list),
      http.get('*/admin/v1/projects', list),
    );
  });

  function open(name: string) {
    const row = providerRows(SSO).find((r) => r.name === name);
    if (!row) throw new Error(name);
    render(<ProviderDrawer open row={row} taken={[name]} onClose={() => undefined} />);
  }

  it('removes the allowed domains once the last one is cleared', async () => {
    open('okta');
    await userEvent.click(screen.getByRole('button', { name: 'Remove domain example.com' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove domain example.org' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({
      spec: { admin: { sso: { oidc: { okta: { allowed_email_domains: null } } } } },
    });
  });

  it('removes the GitHub API address once it is cleared', async () => {
    open('github');
    await userEvent.clear(screen.getByRole('textbox', { name: /GitHub API address/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({
      spec: { admin: { sso: { oauth: { github: { api_base_url: null } } } } },
    });
  });
});

describe('advanced provider fields', () => {
  it('writes a SAML clock difference and OIDC insecure discovery only when set', () => {
    const saml = providerForm('saml', 'okta', {
      idp: { metadata_url: 'https://idp.example.com/m' },
      clock_skew: '2m',
    });
    expect(saml.clockSkew).toBe('2m');
    expect(providerSpec(saml).clock_skew).toBe('2m');
    expect(providerSpec({ ...saml, clockSkew: '60s' }).clock_skew).toBeNull();
    const oidc = providerForm('oidc', 'okta', { issuer: 'https://i', client_id: 'c' });
    expect(oidc.insecureDiscovery).toBe(false);
    expect(providerSpec(oidc).allow_insecure_discovery).toBeNull();
    expect(providerSpec({ ...oidc, insecureDiscovery: true }).allow_insecure_discovery).toBe(true);
  });
});
