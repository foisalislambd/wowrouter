import type { APIRequestContext } from '@playwright/test';

import { ADMIN_URL, expect, openAiUpstream, pickOption, test, TOKEN, unique } from './fixtures';

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

let upstream: Awaited<ReturnType<typeof openAiUpstream>>;
const cleanup: string[] = [];

test.beforeAll(async () => {
  upstream = await openAiUpstream();
});

test.afterAll(async ({ request }) => {
  // Newest first: a Model before its deployment, a deployment before its provider.
  for (const path of cleanup.reverse()) await call(request, 'DELETE', path);
  await upstream.close();
});

async function provider(request: APIRequestContext): Promise<string> {
  const name = unique('flowp');
  await call(request, 'POST', '/providers', {
    name,
    spec: { type: 'openai', base_url: upstream.baseUrl, auth: { api_key: 'sk-flow-0000000001' } },
  });
  cleanup.push(`/providers/${name}`);
  return name;
}

test('a provider is added only after Test connection passes for its current values', async ({
  signedIn: page,
  request,
}) => {
  const name = unique('flowadd');
  await page.goto('providers/');
  await page.getByRole('button', { name: 'Add provider' }).first().click();
  const add = page.getByRole('dialog', { name: 'Add provider' });
  await pickOption(page, add.getByRole('combobox', { name: 'Provider', exact: true }), /^OpenAI$/, 'OpenAI');
  await add.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await add.getByLabel('API key').fill('sk-flow-0000000002');
  await add.getByLabel('Base URL').fill(upstream.baseUrl);
  const save = add.getByRole('button', { name: 'Add provider' });
  await expect(save).toBeDisabled();

  const before = upstream.seen.length;
  await add.getByRole('button', { name: 'Test connection' }).click();
  await expect(add.getByRole('status')).toContainText('Connected · 2 models');
  expect(upstream.seen.slice(before)).toContain('GET /v1/models');
  await expect(save).toBeEnabled();

  // A change after the test needs a new one.
  await add.getByLabel('API key').fill('sk-flow-0000000003');
  await expect(add.getByRole('status')).toContainText('Changed since the last test.');
  await expect(save).toBeDisabled();
  await add.getByRole('button', { name: 'Test connection' }).click();
  await expect(add.getByRole('status')).toContainText('Connected');
  await save.click();
  await expect(add).toBeHidden();
  cleanup.push(`/providers/${name}`);

  await expect(page.getByRole('table', { name: 'Providers' }).getByText(name, { exact: true })).toBeVisible();
  const saved = (await (await call(request, 'GET', `/providers/${name}`)).json()) as {
    spec: { type: string; base_url: string };
  };
  expect(saved.spec).toMatchObject({ type: 'openai', base_url: upstream.baseUrl });
});

test('testing a provider from its row turns Key status to Working', async ({ signedIn: page, request }) => {
  const name = await provider(request);
  await page.goto('providers/');
  const row = page.getByRole('row', { name: `${name}: keys and limits` });
  await expect(row).toContainText('Not tested yet');
  await row.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Test connection' }).click();
  await expect(page.getByText(`${name} answered`)).toBeVisible();
  await expect(row).toContainText('Working');
  // The gateway keeps the test, so the status survives a reload.
  await page.reload();
  await expect(page.getByRole('row', { name: `${name}: keys and limits` })).toContainText('Working');
});

test('a Model is added by picking the provider’s model, with its list prices filled in', async ({
  signedIn: page,
  request,
}) => {
  const name = await provider(request);
  const model = unique('flowm');
  await page.goto('models/');
  await page.getByRole('button', { name: 'Add model' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Add model' });
  await pickOption(
    page,
    drawer.getByRole('combobox', { name: 'Provider', exact: true }),
    new RegExp(`^${name}`),
    name,
  );
  // The list is the provider's own (the mock's), with the catalog's prices.
  await pickOption(
    page,
    drawer.getByRole('combobox', { name: 'Provider’s model ID' }),
    /^gpt-4o-mini/,
    'gpt-4o-mini',
  );
  await expect(drawer.getByRole('combobox', { name: 'Provider’s model ID' })).toHaveValue('gpt-4o-mini');
  const deployment = `${name}-gpt-4o-mini`;
  await expect(drawer.getByText(`Creates the deployment ${deployment}.`)).toBeVisible();
  const input = drawer.getByLabel('Input price (USD per 1M tokens)');
  const output = drawer.getByLabel('Output price (USD per 1M tokens)');
  await expect(input).toHaveValue(/^\d+(\.\d+)?$/);
  await expect(output).toHaveValue(/^\d+(\.\d+)?$/);
  const prices = [await input.inputValue(), await output.inputValue()].map(Number);
  expect(prices[0]).toBeGreaterThan(0);
  expect(prices[1]).toBeGreaterThan(prices[0] ?? 0);

  await expect(drawer.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('gpt-4o-mini');
  await drawer.getByRole('textbox', { name: 'Name', exact: true }).fill(model);
  await drawer.getByRole('button', { name: 'Add model' }).click();
  await expect(drawer).toBeHidden();

  cleanup.push(`/deployments/${deployment}`, `/models/${model}`);
  const created = (await (await call(request, 'GET', `/models/${model}`)).json()) as {
    spec: { target: unknown };
  };
  expect(JSON.stringify(created.spec.target)).toContain(deployment);
  const dep = (await (await call(request, 'GET', `/deployments/${deployment}`)).json()) as {
    spec: { provider: string; model: string };
  };
  expect(dep.spec).toMatchObject({ provider: name, model: 'gpt-4o-mini' });

  await expect(page.getByRole('heading', { level: 2, name: new RegExp(model) })).toBeVisible();
  const money = (n: number) => `$${n.toFixed(2)}`;
  await expect(
    page
      .getByRole('table', { name: `Deployments of ${model}` })
      .getByRole('row', { name: new RegExp(deployment) }),
  ).toContainText(`${money(prices[0] ?? 0)} / ${money(prices[1] ?? 0)}`);
});

test('a deployment is turned off and on again from its Model', async ({ signedIn: page, request }) => {
  const name = await provider(request);
  const deployment = unique('flowd');
  const model = unique('flowdm');
  await call(request, 'POST', '/deployments', {
    name: deployment,
    spec: { provider: name, model: 'gpt-4o-mini', price: { input: '0.15', output: '0.60' } },
  });
  cleanup.push(`/deployments/${deployment}`);
  await call(request, 'POST', '/models', { name: model, spec: { target: { deployment } } });
  cleanup.push(`/models/${model}`);
  const keyName = unique('flowk');
  const key = await call(request, 'POST', '/keys', { name: keyName, spec: { project: 'default' } });
  cleanup.push(`/keys/${keyName}`);
  const secret = ((await key.json()) as { secret: string }).secret;
  const send = async () => {
    const r = await request.fetch(`${DATA_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      data: { model, messages: [{ role: 'user', content: 'Hello' }] },
    });
    await r.text();
    return r.status();
  };
  expect(await send()).toBe(200);

  await page.goto(`models/?model=${model}`);
  const row = page
    .getByRole('table', { name: `Deployments of ${model}` })
    .getByRole('row', { name: new RegExp(deployment) });
  await expect(row).toContainText('Healthy');

  await row.getByRole('button', { name: `Actions for ${deployment}` }).click();
  await page.getByRole('menuitem', { name: 'Turn off…' }).click();
  const confirm = page.getByRole('alertdialog', { name: `Turn off ${deployment}?` });
  await confirm.getByRole('button', { name: 'Turn off deployment' }).click();
  await expect(page.getByText('Deployment turned off')).toBeVisible();
  await expect(row).toContainText('Turned off');
  // Its only deployment is off, so the Model's requests fail.
  expect(await send()).toBeGreaterThanOrEqual(400);

  await row.getByRole('button', { name: `Actions for ${deployment}` }).click();
  await page.getByRole('menuitem', { name: 'Turn on' }).click();
  await expect(page.getByText('Deployment turned on')).toBeVisible();
  await expect(row).not.toContainText('Turned off');
  expect(await send()).toBe(200);
});
