import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { APIRequestContext, Page } from '@playwright/test';

import { ADMIN_URL, expect, test, TOKEN, unique } from './fixtures';

/**
 * Cross-feature flows: a gateway feature does its work on real traffic (the response cache, a
 * translated stream, personal data tokenized and restored, legacy completions), and its result
 * shows the same in the API answer, the Request log drawer, Safety and the cache's savings.
 */

const DATA_URL = `http://127.0.0.1:${process.env.ANTIRION_E2E_DATA_PORT ?? '20480'}`;

async function call(request: APIRequestContext, method: string, path: string, body?: unknown) {
  const response = await request.fetch(`${ADMIN_URL}/admin/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { data: body }),
  });
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBeLessThan(300);
  return response;
}

type Body = Record<string, unknown> & {
  stream?: boolean;
  prompt?: string;
  messages?: { role: string; content: unknown }[];
};

/** The text of the last user message (or the prompt) of a request body. */
function lastUser(body: Body): string {
  if (typeof body.prompt === 'string') return body.prompt;
  const m = (body.messages ?? []).filter((x) => x.role === 'user').at(-1);
  if (typeof m?.content === 'string') return m.content;
  return Array.isArray(m?.content)
    ? (m.content as { text?: string }[]).map((p) => p.text ?? '').join(' ')
    : '';
}

const sse = (events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

/**
 * An upstream that answers "Echo: <the prompt>" as OpenAI Chat, legacy Completions and Anthropic
 * Messages, streamed when asked; `seen` keeps every request body it was sent.
 */
function echoUpstream(): Promise<{ server: Server; port: number; seen: string[] }> {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      seen.push(raw);
      const body = (raw ? JSON.parse(raw) : {}) as Body;
      const path = (req.url ?? '').split('?')[0] ?? '';
      const text = `Echo: ${lastUser(body)}`;
      const usage = { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 };
      res.writeHead(200, { 'content-type': body.stream ? 'text/event-stream' : 'application/json' });
      if (path.endsWith('/messages')) {
        const message = { id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-e2e' };
        if (!body.stream) {
          res.end(
            JSON.stringify({
              ...message,
              content: [{ type: 'text', text }],
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: { input_tokens: 7, output_tokens: 3 },
            }),
          );
          return;
        }
        const events = [
          {
            type: 'message_start',
            message: {
              ...message,
              content: [],
              stop_reason: null,
              usage: { input_tokens: 7, output_tokens: 1 },
            },
          },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
          { type: 'message_stop' },
        ];
        res.end(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
        return;
      }
      const base = { id: 'cmpl-e2e', created: 1, model: 'gpt-e2e' };
      if (path.endsWith('/v1/completions')) {
        const choice = { index: 0, text, finish_reason: 'stop' };
        if (!body.stream)
          res.end(JSON.stringify({ ...base, object: 'text_completion', choices: [choice], usage }));
        else
          res.end(
            `${sse([
              { ...base, object: 'text_completion', choices: [choice] },
              { ...base, object: 'text_completion', choices: [], usage },
            ])}data: [DONE]\n\n`,
          );
        return;
      }
      if (!body.stream) {
        res.end(
          JSON.stringify({
            ...base,
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
            usage,
          }),
        );
        return;
      }
      const chunk = (delta: unknown, finish: string | null) => ({
        ...base,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta, finish_reason: finish }],
      });
      res.end(
        `${sse([
          chunk({ role: 'assistant', content: '' }, null),
          chunk({ content: text }, 'stop'),
          { ...base, object: 'chat.completion.chunk', choices: [], usage },
        ])}data: [DONE]\n\n`,
      );
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as AddressInfo).port, seen }),
    ),
  );
}

let upstream: { server: Server; port: number; seen: string[] };
let secret = '';
const gpt = unique('flowgpt');
const claude = unique('flowclaude');
const guarded = unique('flowsafe');
const pii = `flow_pii_${Date.now().toString(36)}`;

test.beforeAll(async ({ request }) => {
  upstream = await echoUpstream();
  const openai = unique('flowoa');
  const anthropic = unique('flowan');
  await call(request, 'POST', '/providers', {
    name: openai,
    spec: { type: 'openai', base_url: `http://127.0.0.1:${upstream.port}/v1`, auth: { api_key: 'sk-e2e' } },
  });
  await call(request, 'POST', '/providers', {
    name: anthropic,
    spec: {
      type: 'anthropic',
      base_url: `http://127.0.0.1:${upstream.port}`,
      auth: { api_key: 'sk-ant-e2e' },
    },
  });
  const price = { input: '1.00', output: '2.00' };
  await call(request, 'POST', '/deployments', {
    name: `${gpt}-dep`,
    spec: { provider: openai, model: 'gpt-e2e', price },
  });
  await call(request, 'POST', '/deployments', {
    name: `${claude}-dep`,
    spec: { provider: anthropic, model: 'claude-e2e', price },
  });
  const cache = { cache: { enabled: true, ttl: '10m' } };
  await call(request, 'POST', '/models', { name: gpt, spec: { target: `${gpt}-dep`, policies: cache } });
  await call(request, 'POST', '/models', {
    name: claude,
    spec: { target: `${claude}-dep`, policies: cache },
  });
  await call(request, 'POST', '/guardrails', {
    name: pii,
    spec: {
      type: 'pii',
      action: 'redact',
      request_stages: ['input', 'output'],
      pii: {
        entities: ['email'],
        reversible: true,
        custom: [{ name: 'cpf', pattern: '\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}', validate: 'cpf' }],
      },
    },
  });
  await call(request, 'POST', '/models', {
    name: guarded,
    spec: { target: `${gpt}-dep`, policies: { guardrails: { input: [pii], output: [pii] } } },
  });
  const key = await call(request, 'POST', '/keys', { name: unique('flowk'), spec: { project: 'default' } });
  secret = ((await key.json()) as { secret: string }).secret;
  await call(request, 'PUT', '/settings/policies', {
    spec: { observability: { content: { enabled: true } } },
  });
});

test.afterAll(async ({ request }) => {
  await call(request, 'PUT', '/settings/policies', { spec: {} });
  await new Promise((resolve) => upstream.server.close(resolve));
});

/** Sends a data-plane request; returns the answer's text and its request id. */
async function send(request: APIRequestContext, path: string, body: Body) {
  const response = await request.fetch(`${DATA_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    data: body,
  });
  const text = await response.text();
  expect(response.status(), text).toBe(200);
  return {
    text,
    requestId: response.headers()['x-request-id'] ?? '',
    cache: response.headers()['x-antirion-cache'],
  };
}

interface LogItem {
  id: string;
  usage: { input: number | null; output: number | null };
  cache: { status: string | null };
  content: { response: { body: unknown } | null } | null;
}

/** The request log's record of a request, once written. */
async function recordOf(request: APIRequestContext, requestId: string): Promise<LogItem> {
  for (let i = 0; i < 100; i++) {
    const r = await call(request, 'GET', `/logs?request_id=${requestId}`);
    const item = ((await r.json()) as { items: LogItem[] }).items[0];
    if (item) return item;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no record for ${requestId}`);
}

/** Opens a record's drawer from its link. */
async function drawerOf(page: Page, id: string) {
  await page.goto(`request-log/?range=1h&request=${id}`);
  const drawer = page.getByRole('dialog').filter({ has: page.getByRole('tab', { name: /Messages/ }) });
  await expect(drawer).toBeVisible();
  return drawer;
}

test('a cached answer opens in the Request log with the response it served, streamed or not', async ({
  signedIn: page,
  request,
}) => {
  for (const stream of [false, true]) {
    const prompt = `Cache me ${unique('p')}`;
    const body = { model: gpt, stream, messages: [{ role: 'user', content: prompt }] };
    const miss = await send(request, '/v1/chat/completions', body);
    expect(miss.cache).toBe('miss');
    const hit = await send(request, '/v1/chat/completions', body);
    expect(hit.cache).toBe('hit');
    expect(hit.text).toContain(`Echo: ${prompt}`);

    const record = await recordOf(request, hit.requestId);
    expect(record.cache.status).toBe('hit');
    const drawer = await drawerOf(page, record.id);
    await drawer.getByRole('tab', { name: 'Response', exact: true }).click();
    await expect(drawer.getByText('No response was stored')).toBeHidden();
    await expect(drawer.getByText(`Echo: ${prompt}`)).toBeVisible();
    await drawer.getByRole('tab', { name: /Messages/ }).click();
    await expect(drawer.getByText(`Echo: ${prompt}`)).toBeVisible();
    await drawer.getByRole('tab', { name: 'Overview', exact: true }).click();
    await expect(drawer.getByText('Hit · exact layer')).toBeVisible();
  }
});

test('a translated stream and its cache hit carry the same answer and usage', async ({
  signedIn: page,
  request,
}) => {
  const prompt = `Translate me ${unique('p')}`;
  const body = { model: claude, stream: true, messages: [{ role: 'user', content: prompt }] };
  const miss = await send(request, '/v1/chat/completions', body);
  expect(miss.text).toContain('chat.completion.chunk');
  const hit = await send(request, '/v1/chat/completions', body);
  expect(hit.cache).toBe('hit');
  const [first, second] = [await recordOf(request, miss.requestId), await recordOf(request, hit.requestId)];
  expect(second.usage).toMatchObject({ input: first.usage.input, output: first.usage.output });
  expect(second.usage.output).toBe(3);

  const drawer = await drawerOf(page, second.id);
  await drawer.getByRole('tab', { name: 'Response', exact: true }).click();
  await expect(drawer.getByText('3 output tokens')).toBeVisible();
  await expect(drawer.getByText(`Echo: ${prompt}`)).toBeVisible();
});

test('personal data reaches the provider as tokens and the client as it was sent; the drawer and Safety show it', async ({
  signedIn: page,
  request,
}) => {
  const email = `${unique('ada')}@example.com`;
  const prompt = `Repeat ${email} and 529.982.247-25`;
  const sent = await send(request, '/v1/chat/completions', {
    model: guarded,
    messages: [{ role: 'user', content: prompt }],
  });
  const upstreamSaw = upstream.seen.at(-1) ?? '';
  expect(upstreamSaw).not.toContain(email);
  expect(upstreamSaw).toContain('[EMAIL_1]');
  expect(upstreamSaw).toContain('[CPF_1]');
  expect(sent.text).toContain(email);
  expect(sent.text).toContain('529.982.247-25');

  const record = await recordOf(request, sent.requestId);
  const drawer = await drawerOf(page, record.id);
  await drawer.getByRole('tab', { name: /^Guardrails/ }).click();
  await expect(drawer.getByText(pii).first()).toBeVisible();
  await expect(drawer.getByText(/redact/i).first()).toBeVisible();
  await drawer.getByRole('tab', { name: 'Response', exact: true }).click();
  await expect(drawer.getByText(new RegExp(email.replace(/[.]/g, '\\.'))).first()).toBeVisible();

  const events = await call(request, 'GET', `/guardrails/events?guardrail=${pii}`);
  const items = ((await events.json()) as { items: { request_id: string; action: string }[] }).items;
  expect(items.filter((e) => e.request_id === sent.requestId).map((e) => e.action)).toContain('redact');
});

test('a streamed legacy completion shows its text in the drawer', async ({ signedIn: page, request }) => {
  const prompt = `Complete me ${unique('p')}`;
  const sent = await send(request, '/v1/completions', { model: gpt, stream: true, prompt });
  expect(sent.text).toContain(`Echo: ${prompt}`);
  const record = await recordOf(request, sent.requestId);
  const drawer = await drawerOf(page, record.id);
  await drawer.getByRole('tab', { name: 'Response', exact: true }).click();
  await expect(drawer.getByText(`Echo: ${prompt}`)).toBeVisible();
  await expect(drawer.getByText(/Finished: stop/)).toBeVisible();
});
