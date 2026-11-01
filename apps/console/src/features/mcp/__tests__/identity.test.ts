import { describe, expect, it } from 'vitest';

import { agentErrors, agentForm, agentSpec } from '@/features/agents/form';
import type { AgentResource } from '@/features/agents/api';

import type { McpGatewayResource, McpServerResource } from '../api';
import { identityErrors, identityMap, identityRows, identityText, REDACTED } from '../fields';
import { gatewayErrors, gatewayForm, gatewaySpec, serverErrors, serverForm, serverSpec } from '../form';

const meta = {
  etag: '"e1"',
  generation: 1,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  managed_by: 'api' as const,
};

describe('identity headers', () => {
  const map = { 'x-team': 'team', 'x-sub': 'jwt.sub', 'x-key': 'key_name' };

  it('reads a map into rows and writes the same map back', () => {
    const rows = identityRows(map);
    expect(rows).toEqual([
      { name: 'x-team', source: 'team', claim: '' },
      { name: 'x-sub', source: 'jwt', claim: 'sub' },
      { name: 'x-key', source: 'key_name', claim: '' },
    ]);
    expect(identityMap(rows)).toEqual(map);
    expect(identityMap([])).toBeUndefined();
    expect(identityText(map)).toBe('x-team: team, x-sub: claim sub, x-key: api key name');
  });

  it('checks names, repeats and claims', () => {
    expect(identityErrors([{ name: 'x team', source: 'team', claim: '' }])).toBe(
      "“x team” isn't a header name",
    );
    expect(
      identityErrors([
        { name: 'X-Team', source: 'team', claim: '' },
        { name: 'x-team', source: 'project', claim: '' },
      ]),
    ).toBe('x-team is listed twice');
    expect(identityErrors([{ name: 'x-sub', source: 'jwt', claim: ' ' }])).toBe(
      'Name the claim x-sub carries',
    );
    expect(identityErrors([{ name: '', source: 'team', claim: '' }])).toBeUndefined();
  });

  it('round-trips a server’s identity headers and token request details', () => {
    const server: McpServerResource = {
      name: 'issues',
      spec: {
        transport: 'streamable_http',
        url: 'https://issues.example.com/mcp',
        identity_headers: map,
        auth: {
          type: 'token_exchange',
          token_url: 'https://idp.example.com/token',
          client_id: 'gw',
          client_secret: REDACTED,
          resource: null,
          subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          requested_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        },
      },
      metadata: meta,
    };
    expect(serverSpec(serverForm(server), server)).toEqual(server.spec);
    const f = {
      ...serverForm(server),
      identityHeaders: [{ name: 'x-org', source: 'organization' as const, claim: '' }],
      noResource: false,
      resource: 'https://issues.example.com',
      subjectTokenType: '',
    };
    expect(serverSpec(f, server)).toEqual({
      ...server.spec,
      identity_headers: { 'x-org': 'organization' },
      auth: {
        type: 'token_exchange',
        token_url: 'https://idp.example.com/token',
        client_id: 'gw',
        client_secret: REDACTED,
        resource: 'https://issues.example.com',
        requested_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      },
    });
    expect(serverErrors({ ...f, resource: 'ftp://x' }, [], false).resource).toBeTruthy();
  });

  it('round-trips an agent’s identity headers', () => {
    const agent: AgentResource = {
      name: 'planner',
      spec: { card_url: 'https://planner.example.com/card', identity_headers: { 'x-user': 'user' } },
      metadata: meta,
    };
    expect(agentSpec(agentForm(agent), agent)).toEqual(agent.spec);
    const f = { ...agentForm(agent), identityHeaders: [] };
    expect(agentSpec(f, agent)).toEqual({ card_url: 'https://planner.example.com/card' });
    expect(
      agentErrors({ ...f, identityHeaders: [{ name: 'x-sub', source: 'jwt', claim: '' }] }, [], false)
        .identityHeaders,
    ).toBe('Name the claim x-sub carries');
  });

  it('writes a gateway’s client caching and bridging, and keeps an explicit off', () => {
    const gw: McpGatewayResource = {
      name: 'main',
      spec: { servers: ['issues'], client_cache_max_ttl: '5m', modern_bridge: false },
      metadata: meta,
    };
    expect(gatewaySpec(gatewayForm(gw), gw)).toEqual(gw.spec);
    expect(gatewaySpec({ ...gatewayForm(gw), clientCacheMaxTtl: '', modernBridge: true }, gw)).toEqual({
      servers: ['issues'],
      modern_bridge: true,
    });
    expect(
      gatewayErrors({ ...gatewayForm(gw), clientCacheMaxTtl: '5 min' }, [], false).clientCacheMaxTtl,
    ).toBeTruthy();
  });
});
