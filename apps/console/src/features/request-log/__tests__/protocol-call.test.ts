import { describe, expect, it } from 'vitest';

import type { LogRecord } from '@/lib/api/types';

import { protocolCall } from '../types';

const record = (over: Partial<LogRecord>): LogRecord => ({ mcp: null, a2a: null, ...over }) as LogRecord;

describe('protocolCall', () => {
  it('names an MCP tool call by its server and tool', () => {
    const call = protocolCall(
      record({
        mcp: { server: 'crm', method: 'tools/call', tool: 'search_customers', session_id: 'a1.abc' },
      }),
    );
    expect(call?.kind).toBe('mcp');
    expect(call?.label).toBe('crm · search_customers');
    expect(call?.facts.map((f) => f.label)).toEqual(['Server', 'Method', 'Tool', 'Session']);
  });

  it('names a call without a tool by its method, with the JSON-RPC error of a refusal', () => {
    const call = protocolCall(
      record({ mcp: { server: null, method: 'initialize', tool: null, jsonrpc_error_code: -32011 } }),
    );
    expect(call?.label).toBe('initialize');
    expect(call?.facts).toContainEqual({ label: 'JSON-RPC error', value: '-32011' });
  });

  it('names an A2A call by its agent and method', () => {
    expect(
      protocolCall(record({ a2a: { agent: 'billing', method: 'message/send', task_id: 't1' } }))?.label,
    ).toBe('billing · message/send');
  });

  it('is null for a model request', () => {
    expect(protocolCall(record({ model: 'gpt-4o' }))).toBeNull();
  });
});
