import { describe, expect, it } from 'vitest';

import { blankRun, draftOf, emptyDraft, type GuardrailSpec, METHODS, specOf, TYPE_LABEL } from '../rules';

const NOWHERE = { input: false, output: false };

/** A spec read into the form and written back with nothing changed. */
function roundTrip(spec: GuardrailSpec): GuardrailSpec | null {
  const r = specOf(draftOf('rule', spec, NOWHERE), spec);
  return r.ok ? r.spec : null;
}

describe('every guardrail type has a form', () => {
  it('offers a method for each of the 21 types', () => {
    const types = new Set(METHODS.map((m) => (m.value === 'allowlist' ? 'regex' : m.value)));
    expect([...types].sort()).toEqual(Object.keys(TYPE_LABEL).sort());
  });

  const specs: Record<string, GuardrailSpec> = {
    moderation: {
      type: 'moderation',
      enabled: true,
      action: 'block',
      moderation: { model: 'omni-moderation', thresholds: { hate: 0.5, violence: 0.7 }, max_chars: 4000 },
      categories: { 'self-harm': 'self_harm' },
    },
    moderation_bare: { type: 'moderation', enabled: true, moderation: { model: 'omni-moderation' } },
    llm_judge: {
      type: 'llm_judge',
      enabled: true,
      action: 'flag',
      on_error: 'allow',
      llm_judge: { model: 'judge', prompt: 'Is this medical advice? {{content}}', max_tokens: 64 },
    },
    length: {
      type: 'length',
      enabled: false,
      action: 'block',
      severity: 'low',
      length: { max_chars: 20000, min_words: 2, max_tokens: 8000 },
    },
    tool_permission: {
      type: 'tool_permission',
      enabled: true,
      action: 'redact',
      replacement: 'mask',
      tool_permission: { allow: ['search_*', 'get_weather'], deny: ['delete_*'] },
    },
    tool_permission_deny: {
      type: 'tool_permission',
      enabled: true,
      action: 'block',
      tool_permission: { deny: ['shell'] },
    },
    system_prompt: {
      type: 'system_prompt',
      enabled: true,
      description: 'House style',
      system_prompt: { text: 'Answer in British English.', mode: 'insert_if_absent', role: 'developer' },
    },
    system_prompt_bare: { type: 'system_prompt', enabled: true, system_prompt: { text: 'Be brief.' } },
    bedrock_guardrails: {
      type: 'bedrock_guardrails',
      enabled: true,
      action: 'block',
      bedrock_guardrails: {
        provider: 'aws-main',
        guardrail_id: 'gr-123',
        guardrail_version: '3',
        region: 'eu-west-1',
        base_url: 'https://bedrock.example',
      },
    },
    azure_content_safety: {
      type: 'azure_content_safety',
      enabled: true,
      action: 'block',
      azure_content_safety: {
        endpoint: 'https://cs.example.cognitiveservices.azure.com',
        api_key: '[REDACTED]',
        api_version: '2024-09-01',
        severity_threshold: 2,
      },
    },
    model_armor: {
      type: 'model_armor',
      enabled: true,
      action: 'divert',
      divert_to: 'safe-model',
      model_armor: { provider: 'gcp', template: 'tpl-1', project: 'p', location: 'us-central1' },
    },
    lakera: {
      type: 'lakera',
      enabled: true,
      action: 'flag',
      lakera: { api_key: '${env:LAKERA_KEY}', project_id: 'project-1' },
    },
    webhook: {
      type: 'webhook',
      enabled: true,
      action: 'block',
      webhook: {
        url: 'https://check.example/v1',
        headers: { authorization: '[REDACTED]', 'x-tenant': '${env:TENANT}' },
        signing_secret: '[REDACTED]',
      },
    },
    how_it_runs: {
      type: 'llm_judge',
      enabled: true,
      action: 'flag',
      on_error: 'allow',
      execution: 'async',
      timeout: '5s',
      max_concurrency: 8,
      order: -1,
      scope: { kinds: ['user', 'tool'], messages: 'last_user' },
      include_operator_content: true,
      request_stages: ['input'],
      message: 'Not allowed here',
      notify: { min_severity: 'critical' },
      llm_judge: { model: 'judge', prompt: '{{content}}' },
    },
  };

  for (const [name, spec] of Object.entries(specs))
    it(`reads and writes ${name} unchanged`, () => {
      expect(roundTrip(spec)).toEqual(spec);
    });
});

describe('new methods from the form', () => {
  it('writes each new method with the gateway’s defaults left out', () => {
    const make = (patch: Partial<ReturnType<typeof emptyDraft>>, method: Parameters<typeof emptyDraft>[0]) =>
      specOf({ ...emptyDraft(method), name: 'r', ...patch }, null);
    expect(make({ model: 'mod', thresholds: 'hate = 0.4' }, 'moderation')).toEqual({
      ok: true,
      spec: {
        type: 'moderation',
        enabled: true,
        action: 'block',
        moderation: { model: 'mod', thresholds: { hate: 0.4 } },
      },
    });
    expect(make({ bounds: { ...emptyDraft('length').bounds, max_tokens: '4000' } }, 'length')).toEqual({
      ok: true,
      spec: { type: 'length', enabled: true, action: 'block', length: { max_tokens: 4000 } },
    });
    expect(make({ systemText: 'Be kind.' }, 'system_prompt')).toEqual({
      ok: true,
      spec: { type: 'system_prompt', enabled: true, system_prompt: { text: 'Be kind.' } },
    });
    expect(
      make({ apiKey: { value: 'lk-secret', stored: false }, lakeraProject: 'p1' }, 'lakera'),
    ).toMatchObject({ ok: true, spec: { lakera: { api_key: 'lk-secret', project_id: 'p1' } } });
  });

  it('says what each new method still needs', () => {
    const errors = (method: Parameters<typeof emptyDraft>[0], patch = {}) => {
      const r = specOf({ ...emptyDraft(method), name: 'r', ...patch }, null);
      return r.ok ? {} : r.errors;
    };
    expect(errors('moderation').model).toBeTruthy();
    expect(Object.keys(errors('llm_judge')).sort()).toEqual(['model', 'prompt']);
    expect(errors('length').bounds).toBe('Set at least one bound');
    expect(
      errors('length', { bounds: { ...emptyDraft('length').bounds, min_words: '10', max_words: '5' } })
        .bounds,
    ).toBe('The least words is above the most');
    expect(errors('tool_permission').toolsAllow).toBeTruthy();
    expect(errors('system_prompt').systemText).toBeTruthy();
    expect(Object.keys(errors('bedrock_guardrails')).sort()).toEqual(['guardrailId', 'provider']);
    expect(errors('azure_content_safety').endpoint).toBe('Enter the https:// address');
    expect(errors('azure_content_safety').apiKey).toBe('Enter the API key');
    expect(errors('model_armor', { provider: 'gcp', baseUrl: 'http://x' })).toEqual({
      armorTemplate: 'The template’s id',
      baseUrl: 'An address starting with https://',
    });
    expect(errors('lakera').apiKey).toBe('Enter the API key');
  });

  it('keeps a stored secret unless a new one is typed, and removes it when asked', () => {
    const spec: GuardrailSpec = {
      type: 'webhook',
      enabled: true,
      action: 'block',
      webhook: {
        url: 'https://check.example',
        headers: { authorization: '[REDACTED]' },
        signing_secret: '[REDACTED]',
      },
    };
    const draft = draftOf('hook', spec, NOWHERE);
    expect(draft.signingSecret).toEqual({ value: '', stored: true });
    expect(draft.headers).toEqual([{ name: 'authorization', value: '', stored: true }]);
    const replaced = specOf(
      {
        ...draft,
        signingSecret: { value: 'whsec_new', stored: true },
        headers: [...draft.headers, { name: 'x-team', value: 'safety', stored: false }],
      },
      spec,
    );
    expect(replaced.ok && replaced.spec.webhook).toEqual({
      url: 'https://check.example',
      headers: { authorization: '[REDACTED]', 'x-team': 'safety' },
      signing_secret: 'whsec_new',
    });
    const removed = specOf({ ...draft, signingSecret: { value: '', stored: false }, headers: [] }, spec);
    expect(removed.ok && removed.spec.webhook).toEqual({ url: 'https://check.example' });
    const bad = specOf({ ...draft, headers: [{ name: 'bad header', value: 'x', stored: false }] }, spec);
    expect(!bad.ok && bad.errors.headers).toBe("“bad header” isn't a header name");
  });

  it('writes how a rule runs, and refuses what the gateway would', () => {
    const base: GuardrailSpec = {
      type: 'keywords',
      enabled: true,
      action: 'block',
      keywords: { words: ['x'] },
    };
    const draft = draftOf('k', base, NOWHERE);
    const run = {
      ...(draft.run ?? blankRun()),
      timeout: '750ms',
      scopeKinds: ['user' as const],
      message: 'Nope',
    };
    expect(specOf({ ...draft, run }, base)).toMatchObject({
      ok: true,
      spec: { timeout: '750ms', scope: { kinds: ['user'] }, message: 'Nope' },
    });
    const errors = (patch: Partial<typeof run>, action = draft.action) => {
      const r = specOf({ ...draft, action, run: { ...run, ...patch } }, base);
      return r.ok ? undefined : r.errors.run;
    };
    expect(errors({ timeout: '2m' })).toBe('Time limit: from 10ms to 60s, e.g. 2s');
    expect(errors({ execution: 'async' })).toMatch(/only flags/);
    expect(errors({ execution: 'async' }, 'flag')).toBeUndefined();
    expect(errors({ maxConcurrency: '0' })).toMatch(/at least 1/);
  });
});
