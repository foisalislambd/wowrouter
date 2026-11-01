import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { emptySlot } from '@/lib/slot';
import { mcpDemoHandlers, mcpDemoState, mergePatch } from '@/mocks/mcp-demo';
import { server } from '@/mocks/node';
import { useUi } from '@/stores/ui';
import { pickOption, signInAs } from '@/test/utils';

import {
  type Access,
  everyKeyPlan,
  gatewayReach,
  grantees,
  type Holder,
  type McpPolicy,
  removalEffect,
  serverReach,
  serversPatch,
  withoutServers,
  withServers,
} from '../access';
import { McpScreen } from '../components/mcp-screen';
import { useMcp } from '../store';

const holder = (level: Holder['level'], name: string, mcp?: McpPolicy): Holder => ({
  level,
  name,
  etag: `"${name || 'gw'}"`,
  mcp,
});

const access = (gateway: McpPolicy | undefined, levels: Holder[], complete = true): Access => ({
  gateway: holder('gateway', '', gateway),
  levels,
  complete,
});

const support = holder('team', 'support', { servers: ['issues', 'docs'] });
const ci = holder('key', 'ci', { servers: ['*'] });

describe('MCP grant arithmetic', () => {
  it('appends the missing servers to a list, and leaves a "*" as it is', () => {
    expect(withServers(['issues'], ['billing', 'issues'])).toEqual(['issues', 'billing']);
    expect(withServers(null, ['billing'])).toEqual(['billing']);
    expect(withServers(['*'], ['billing'])).toEqual(['*']);
  });

  it('takes servers off a list and drops the list once it is empty, never leaving []', () => {
    expect(withoutServers(['issues', 'docs'], ['docs'])).toEqual(['issues']);
    expect(withoutServers(['issues'], ['issues'])).toBeNull();
    expect(withoutServers(['*'], ['billing'])).toBeNull();
    expect(withoutServers(['*', 'docs'], ['billing'])).toEqual(['docs']);
    expect(withoutServers(null, ['billing'])).toBeNull();
  });

  it('appends to a list for every API key that exists, which only widens', () => {
    expect(everyKeyPlan(access({ servers: ['issues'] }, [support]), ['billing'])).toEqual({
      kind: 'append',
      next: ['issues', 'billing'],
    });
    expect(everyKeyPlan(access({ servers: ['*'] }, [support]), ['billing'])).toEqual({ kind: 'granted' });
    expect(everyKeyPlan(access({ servers: ['billing'] }, []), ['billing'])).toEqual({ kind: 'granted' });
  });

  it('creates the list when there is none and no level lists other servers', () => {
    expect(everyKeyPlan(access(undefined, []), ['billing'])).toEqual({ kind: 'create', next: ['billing'] });
    // A level listing only some of these servers isn't narrowed by a list of all of them.
    expect(everyKeyPlan(access(undefined, [support]), ['issues', 'docs', 'billing'])).toEqual({
      kind: 'create',
      next: ['issues', 'docs', 'billing'],
    });
    // A level without a server list (only tools) takes no part.
    const tools = holder('project', 'p', { tools: { issues: ['search_*'] } });
    expect(everyKeyPlan(access(undefined, [tools]), ['billing']).kind).toBe('create');
  });

  it('warns that creating the list would narrow the levels that list other servers', () => {
    const plan = everyKeyPlan(access(undefined, [support, ci, holder('team', 'quiet')]), ['billing']);
    expect(plan.kind).toBe('narrows');
    if (plan.kind !== 'narrows') return;
    expect(plan.next).toEqual(['billing']);
    expect(plan.narrowed.map((h) => h.name)).toEqual(['support', 'ci']);
  });

  it('writes only the server list, so tools, prompts, resources and conditional rules stay', () => {
    const spec = {
      organization: 'acme',
      policies: {
        limits: { rpm: 10 },
        mcp: {
          servers: ['issues'],
          tools: { issues: ['search_*'] },
          prompts: { issues: ['triage'] },
          resources: { issues: ['repo://*'] },
          when: [{ match: [{ attribute: 'tags', operator: 'present' }] }],
        },
      },
    };
    expect(serversPatch(['issues', 'billing'])).toEqual({
      policies: { mcp: { servers: ['issues', 'billing'] } },
    });
    expect(mergePatch(spec, serversPatch(['issues', 'billing']))).toEqual({
      ...spec,
      policies: { ...spec.policies, mcp: { ...spec.policies.mcp, servers: ['issues', 'billing'] } },
    });
    const { servers: _gone, ...rest } = spec.policies.mcp;
    expect(mergePatch(spec, serversPatch(null))).toEqual({
      ...spec,
      policies: { ...spec.policies, mcp: rest },
    });
  });

  it('lists who has access and knows when no key can use a gateway', () => {
    const a = access(undefined, [support, holder('team', 'quiet')]);
    expect(grantees(a, ['issues']).map((g) => [g.holder.name, g.servers])).toEqual([['support', ['issues']]]);
    expect(gatewayReach(a, ['issues'])).toBe('granted');
    expect(gatewayReach(a, ['billing'])).toBe('none');
    expect(grantees(access(undefined, [ci]), ['billing'])[0]?.servers).toBe('*');
    // The list for every API key leaves billing out: what a team grants doesn't reach any key.
    const narrowed = access({ servers: ['issues'] }, [holder('team', 't', { servers: ['billing'] })]);
    expect(serverReach(narrowed, 'billing')).toBe('blocked');
    expect(gatewayReach(narrowed, ['billing'])).toBe('none');
    // Not knowing every level, or conditional rules, is not "no key".
    expect(gatewayReach(access(undefined, [], false), ['billing'])).toBe('unknown');
    expect(gatewayReach(access({ when: [] }, []), ['billing'])).toBe('unknown');
    expect(gatewayReach(null, ['billing'])).toBe('unknown');
  });

  it('says what a removal does, including lifting the limit a list for every key put on the others', () => {
    const a = access({ servers: ['issues'] }, [holder('team', 't', { servers: ['billing'] })]);
    expect(removalEffect(a, holder('gateway', '', { servers: ['issues'] }), ['issues'])).toBe(
      'Every API key loses issues. Without a list for every API key, team t also gets the other servers it lists.',
    );
    expect(removalEffect(a, ci, ['billing'])).toContain(
      "can use every MCP server today; this takes that away, not only this gateway's servers.",
    );
  });
});

const PERMISSIONS = [
  'mcp:read',
  'mcp:write',
  'policies:read',
  'policies:write',
  'organizations:read',
  'organizations:update',
  'teams:read',
  'teams:update',
  'projects:read',
  'projects:update',
  'keys:read',
  'keys:update',
];

function open(search: string) {
  server.use(...mcpDemoHandlers());
  signInAs(PERMISSIONS);
  window.history.replaceState(null, '', `/mcp/${search}`);
  render(<McpScreen />);
}

describe('who can use an MCP gateway', () => {
  beforeEach(() => {
    useMcp.setState({
      servers: emptySlot(),
      statuses: {},
      gateways: emptySlot(),
      sessions: emptySlot(),
      settings: emptySlot(),
      access: emptySlot(),
    });
  });

  it('warns on the gateway no key can use, and opens its "Who can use it" from the row', async () => {
    open('?tab=gateways');
    const table = await screen.findByRole('table', { name: 'MCP gateways' });
    const finance = await within(table).findByRole('row', { name: 'finance: details' });
    await waitFor(() => expect(finance).toHaveTextContent('No API key can use this gateway yet'));
    expect(within(table).getByRole('row', { name: 'default: details' })).not.toHaveTextContent(
      'No API key can use',
    );
    await userEvent.click(within(finance).getByRole('button', { name: 'Choose who can use it' }));
    const drawer = await screen.findByRole('dialog', { name: 'finance' });
    expect(window.location.search).toContain('section=access');
    expect(within(drawer).getByText('No API key can use this gateway yet')).toBeInTheDocument();
    expect(within(drawer).getByText('No API key can use it yet')).toBeInTheDocument();
  });

  it('shows who can use the servers in a server drawer, without changing them there', async () => {
    open('?server=issues');
    const drawer = await screen.findByRole('dialog', { name: 'issues' });
    const list = await within(drawer).findByRole('list', { name: 'Levels that grant access' });
    expect(list).toHaveTextContent('Teamsupport-ai');
    expect(list).toHaveTextContent('Projecthelpdesk');
    expect(list).toHaveTextContent('API keyci-bot');
    expect(within(list).queryByRole('button')).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('group', { name: 'Grant access' })).not.toBeInTheDocument();
  });

  it('grants every server to every API key rather than narrowing the levels that grant others', async () => {
    open('?tab=gateways&gateway=finance');
    const drawer = await screen.findByRole('dialog', { name: 'finance' });
    const form = await within(drawer).findByRole('group', { name: 'Grant access' });
    await pickOption(within(form).getByLabelText('Grant to'), 'Every API key');
    expect(within(form).getByText('A list for every API key narrows the others')).toBeInTheDocument();
    expect(form).toHaveTextContent(
      'Team support-ai, project helpdesk and key ci-bot grant other MCP servers',
    );
    const choice = within(form).getByRole('radiogroup', { name: 'What every API key gets' });
    expect(within(choice).getByRole('radio', { name: /Every MCP server/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Grant access' }));
    await waitFor(() => expect(mcpDemoState().policies.spec.mcp?.servers).toEqual(['*']));
    const list = within(drawer).getByRole('list', { name: 'Levels that grant access' });
    await waitFor(() => expect(list).toHaveTextContent('Every API keyEvery server'));
    expect(within(drawer).queryByText('No API key can use this gateway yet')).not.toBeInTheDocument();
  });

  it('can still create the narrowing list when that is the choice', async () => {
    open('?tab=gateways&gateway=finance');
    const drawer = await screen.findByRole('dialog', { name: 'finance' });
    const form = await within(drawer).findByRole('group', { name: 'Grant access' });
    await pickOption(within(form).getByLabelText('Grant to'), 'Every API key');
    await userEvent.click(within(form).getByRole('radio', { name: /Only billing/ }));
    await userEvent.click(within(form).getByRole('button', { name: 'Grant access' }));
    await waitFor(() => expect(mcpDemoState().policies.spec.mcp?.servers).toEqual(['billing']));
  });

  it('grants to chosen teams and takes a grant away, keeping the rest of their policies', async () => {
    open('?tab=gateways&gateway=default');
    const drawer = await screen.findByRole('dialog', { name: 'default' });
    const form = await within(drawer).findByRole('group', { name: 'Grant access' });
    await pickOption(within(form).getByLabelText('Grant to'), 'Team');
    await pickOption(within(form).getByLabelText('Which ones'), 'platform');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(form).getByRole('button', { name: 'Grant access' }));
    await waitFor(() =>
      expect(mcpDemoState().teams.find((t) => t.name === 'platform')?.spec.policies).toEqual({
        mcp: { servers: ['issues', 'docs'] },
      }),
    );
    const list = within(drawer).getByRole('list', { name: 'Levels that grant access' });
    await waitFor(() => expect(list).toHaveTextContent('Teamplatform'));

    await userEvent.click(within(list).getByRole('button', { name: 'Remove access for team support-ai' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove access for team support-ai?' });
    expect(confirm).toHaveTextContent('Team support-ai loses issues and docs.');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove access' }));
    await waitFor(() =>
      // The emptied list is dropped, not left as [] (which would deny every server), and the tool list stays.
      expect(mcpDemoState().teams.find((t) => t.name === 'support-ai')?.spec.policies).toEqual({
        mcp: { tools: { issues: ['search_*', 'comment'] } },
      }),
    );
    await waitFor(() => expect(list).not.toHaveTextContent('support-ai'));
  });

  it('sends the ETag it showed, so a level changed meanwhile is not overwritten', async () => {
    open('?tab=gateways&gateway=finance');
    const drawer = await screen.findByRole('dialog', { name: 'finance' });
    const form = await within(drawer).findByRole('group', { name: 'Grant access' });
    mcpDemoState().policies.metadata.etag = '"changed-elsewhere"';
    await pickOption(within(form).getByLabelText('Grant to'), 'Every API key');
    await userEvent.click(within(form).getByRole('button', { name: 'Grant access' }));
    await waitFor(() =>
      expect(useUi.getState().toasts.some((t) => t.title === "Couldn't grant access")).toBe(true),
    );
    expect(mcpDemoState().policies.spec.mcp).toBeUndefined();
  });
});
