import type { components } from '@/lib/api/schema';
import type { SafetyEvent } from '@/lib/api/types';

import { type HeaderRow, headerErrors, headerMap, headerRows } from '@/features/mcp/fields';
import { badPattern, type EntityCheck } from '@/features/settings/custom-entities';

export type GuardrailSpec = components['schemas']['Guardrail'];
export type GuardrailType = GuardrailSpec['type'];
export type GuardrailAction = NonNullable<GuardrailSpec['action']>;
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type PiiEntity = NonNullable<NonNullable<GuardrailSpec['pii']>['entities']>[number];
export type PiiPreserve = NonNullable<NonNullable<GuardrailSpec['pii']>['preserve']>[number];
export type SecretDetector = NonNullable<NonNullable<GuardrailSpec['secrets']>['detectors']>[number];
export type Category = NonNullable<GuardrailSpec['categories']>[string];

export const PII_ENTITIES: PiiEntity[] = [
  'email',
  'phone',
  'credit_card',
  'us_ssn',
  'iban',
  'ip_address',
  'ca_sin',
];
export const PII_PRESERVE: PiiPreserve[] = ['email_domain', 'ip_subnet', 'last4', 'country'];
export const SECRET_DETECTORS: SecretDetector[] = [
  'openai_key',
  'anthropic_key',
  'aws_access_key',
  'github_token',
  'slack_token',
  'google_api_key',
  'stripe_key',
  'jwt',
  'pem_private_key',
];
export const CATEGORIES: Category[] = [
  'deny_pattern',
  'allow_pattern',
  'keyword',
  'pii',
  'secret',
  'hate',
  'harassment',
  'violence',
  'sexual',
  'self_harm',
  'illicit',
  'prompt_injection',
  'off_topic',
  'invalid_json',
  'schema_violation',
  'tool_not_allowed',
  'length',
  'uninspectable',
  'custom',
];

export const ENTITY_NAME: Record<string, string> = {
  email: 'Email address',
  phone: 'Phone number',
  credit_card: 'Card number',
  us_ssn: 'US social security number',
  iban: 'IBAN',
  ip_address: 'IP address',
  ca_sin: 'Canadian social insurance number',
  openai_key: 'OpenAI key',
  anthropic_key: 'Anthropic key',
  aws_access_key: 'AWS access key',
  github_token: 'GitHub token',
  slack_token: 'Slack token',
  google_api_key: 'Google API key',
  stripe_key: 'Stripe key',
  jwt: 'JSON web token',
  pem_private_key: 'Private key (PEM)',
};

/**
 * What a test match is, in words: the detector's entity, or "match" for a pattern, whose entity is
 * the label it would be redacted to (`redacted` by default) even when the rule only flags.
 */
export function matchWord(entity: string | null | undefined): string {
  if (!entity || entity === 'redacted') return 'match';
  return ENTITY_NAME[entity] ?? entity;
}

/** A name in running text: lower case, except names and acronyms ("US social security number"). */
export function inText(name: string): string {
  return /^([A-Z]{2}|Canadian|OpenAI|Anthropic|GitHub|Slack|Google|Stripe)/.test(name)
    ? name
    : name.charAt(0).toLowerCase() + name.slice(1);
}

/**
 * A kind of personal data a rule defines itself (`pii.custom`), found beside the built-in ones:
 * its name (the id, `cpf`), one pattern, an optional check a match must pass and the label its
 * placeholder shows (`[CPF]`, `[CPF_1]`; the name in upper case when empty). A rule looks for
 * every kind it lists; the form keeps one unticked until it saves, then drops it.
 */
export type CustomKind = Required<Omit<PiiCustom, 'label'>> & { label: string };
type PiiCustom = components['schemas']['PiiCustomEntity'];

/** The label a kind's placeholders show: the written one, else its name, in upper case. */
export function kindLabel(kind: Pick<CustomKind, 'name' | 'label'>): string {
  return (kind.label.trim() || kind.name).toUpperCase();
}

/** The entity events, reports and tests name a kind of a rule's own with: its label, lower case. */
export function kindEntity(kind: Pick<CustomKind, 'name' | 'label'>): string {
  return kindLabel(kind).toLowerCase();
}

export function kindId(kind: Pick<CustomKind, 'name'>): string {
  return kind.name;
}

/** The kinds a personal data rule defines itself. */
export function customKindsOf(spec: Pick<GuardrailSpec, 'pii'>): CustomKind[] {
  return (spec.pii?.custom ?? []).map((k) => ({
    name: k.name,
    pattern: k.pattern,
    validate: k.validate ?? 'none',
    label: k.label ?? '',
  }));
}

/** The kinds a personal data rule looks for: the built-ins it names (all by default) and its own. */
export function checkedKinds(spec: Pick<GuardrailSpec, 'pii'>): string[] {
  return [...(spec.pii?.entities ?? PII_ENTITIES), ...customKindsOf(spec).map(kindId)];
}

/** Every kind a rule can look for: the built-ins, then its own. */
export function allKinds(kinds: CustomKind[]): string[] {
  return [...PII_ENTITIES, ...kinds.map(kindId)];
}

function isBuiltIn(id: string): id is PiiEntity {
  return (PII_ENTITIES as string[]).includes(id);
}

/** A kind's name: a built-in's in words, a rule's own by its name. */
export function kindName(id: string, kinds: CustomKind[] = []): string {
  return ENTITY_NAME[id] ?? kinds.find((k) => k.name === id || kindEntity(k) === id)?.name ?? id;
}

/** A kind's name in running text: a built-in's in lower case, a rule's own as it was written. */
export function kindInText(id: string, kinds: CustomKind[] = []): string {
  const builtIn = ENTITY_NAME[id];
  return builtIn ? inText(builtIn) : kindName(id, kinds);
}

function customWire(k: CustomKind): PiiCustom {
  return {
    name: k.name.trim(),
    pattern: k.pattern,
    ...(k.validate !== 'none' ? { validate: k.validate } : {}),
    ...(k.label.trim() ? { label: k.label.trim() } : {}),
  };
}

/** The rule's personal data block with these built-in kinds and kinds of its own. */
function withPii(spec: GuardrailSpec, entities: PiiEntity[], custom: CustomKind[]): GuardrailSpec {
  const { custom: _old, ...rest } = spec.pii ?? {};
  return {
    ...spec,
    pii: { ...rest, entities, ...(custom.length > 0 ? { custom: custom.map(customWire) } : {}) },
  };
}

/**
 * The rule with one built-in kind looked for or not, or one of its own removed (`on` false); null
 * when it would look for nothing. A kind of its own is added with `withCustomKind`.
 */
export function withKind(spec: GuardrailSpec, id: string, on: boolean): GuardrailSpec | null {
  const builtIns = PII_ENTITIES.filter((e) => checkedKinds(spec).includes(e));
  const own = customKindsOf(spec);
  const entities = isBuiltIn(id)
    ? PII_ENTITIES.filter((e) => (e === id ? on : builtIns.includes(e)))
    : builtIns;
  const custom = isBuiltIn(id) || on ? own : own.filter((k) => k.name !== id);
  if (entities.length + custom.length === 0) return null;
  return withPii(spec, entities, custom);
}

/** The kinds of secret a secrets rule looks for: the ones it lists, every one when it lists none. */
export function checkedSecrets(spec: Pick<GuardrailSpec, 'secrets'>): SecretDetector[] {
  return spec.secrets?.detectors ?? [...SECRET_DETECTORS];
}

/**
 * The secrets rule with one kind looked for or not, its kinds kept in the catalogue's order; null
 * when it would look for nothing (a rule lists at least one).
 */
export function withSecret(spec: GuardrailSpec, id: string, on: boolean): GuardrailSpec | null {
  const checked = checkedSecrets(spec);
  const detectors = SECRET_DETECTORS.filter((d) => (d === id ? on : checked.includes(d)));
  if (detectors.length === 0) return null;
  return { ...spec, secrets: { ...spec.secrets, detectors } };
}

/** The kinds a rule looks for, a personal data rule's or a secrets rule's. */
export function kindsOf(spec: GuardrailSpec): string[] {
  return spec.type === 'secrets' ? checkedSecrets(spec) : checkedKinds(spec);
}

/** The rule with one more kind of its own (or one replaced, by name). */
export function withCustomKind(spec: GuardrailSpec, kind: CustomKind): GuardrailSpec {
  const builtIns = PII_ENTITIES.filter((e) => checkedKinds(spec).includes(e));
  const own = customKindsOf(spec);
  const at = own.findIndex((k) => k.name === kind.name);
  return withPii(spec, builtIns, at >= 0 ? own.map((k, i) => (i === at ? kind : k)) : [...own, kind]);
}

export type CustomKindErrors = Partial<Record<'name' | 'label' | 'pattern', string>>;

/** What to fix in a kind of the rule's own, beside its other kinds (`others`, without it). */
export function customKindErrors(kind: CustomKind, others: CustomKind[]): CustomKindErrors {
  const errors: CustomKindErrors = {};
  const name = kind.name.trim();
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name))
    errors.name = 'Use lowercase letters, digits and underscores, starting with a letter, such as cpf';
  else if (isBuiltIn(name)) errors.name = `${name} is a built-in kind: tick it instead`;
  else if (others.some((k) => k.name === name)) errors.name = `Another kind is already named ${name}`;
  const label = kind.label.trim();
  if (label && !/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(label))
    errors.label = 'Use letters, digits and _, starting with a letter';
  if (!kind.pattern.trim()) errors.pattern = 'Enter the regular expression a value matches';
  else if (kind.pattern.length > 1000) errors.pattern = 'Keep the pattern under 1,000 characters';
  else if (badPattern([kind.pattern]) !== null) errors.pattern = 'This is not a valid regular expression';
  return errors;
}

/** The placeholder a value becomes under a label: numbered (`[CPF_1]`) where values are put back. */
export function placeholder(label: string, numbered: boolean): string {
  const upper = label.trim().toUpperCase() || 'REDACTED';
  return numbered ? `[${upper}_1]` : `[${upper}]`;
}

/**
 * A pattern rule's placeholder: its label, else `REDACTED`; numbered where values are put back,
 * where a rule without a label takes its own name.
 */
export function patternPlaceholder(label: string, name: string, reversible: boolean): string {
  return reversible ? placeholder(label.trim() || name, true) : placeholder(label, false);
}

export const PRESERVE_NAME: Record<PiiPreserve, string> = {
  email_domain: 'Email domain',
  ip_subnet: 'IP subnet',
  last4: 'Last four digits',
  country: 'Phone country code',
};

/**
 * The methods the rule editor offers, in the order of its picker; `allowlist` is a pattern rule
 * whose patterns are the only text allowed.
 */
export type Method =
  | 'regex'
  | 'allowlist'
  | 'keywords'
  | 'pii'
  | 'secrets'
  | 'classifier'
  | 'webhook'
  | 'topic'
  | 'llm_rewrite'
  | 'json_schema'
  | 'json_repair'
  | 'template'
  | 'decorator'
  | 'moderation'
  | 'llm_judge'
  | 'length'
  | 'tool_permission'
  | 'system_prompt'
  | 'bedrock_guardrails'
  | 'azure_content_safety'
  | 'model_armor'
  | 'lakera';

export const METHODS: { value: Method; label: string; description: string }[] = [
  {
    value: 'regex',
    label: 'Pattern',
    description: 'Regular expressions, with an optional checksum (Luhn or IBAN).',
  },
  {
    value: 'allowlist',
    label: 'Allow-list',
    description: 'Only text matching one of the patterns may pass.',
  },
  { value: 'keywords', label: 'Keywords', description: 'Words or phrases, matched whole or anywhere.' },
  {
    value: 'pii',
    label: 'Personal data',
    description: 'Emails, phone and card numbers, IBANs, ID numbers, addresses.',
  },
  {
    value: 'secrets',
    label: 'Secrets',
    description: 'API keys, tokens and private keys, with an optional entropy floor.',
  },
  {
    value: 'classifier',
    label: 'Classifier',
    description: 'A text-classification endpoint scoring each label.',
  },
  {
    value: 'webhook',
    label: 'Webhook',
    description: 'Your own service decides, for names, code or copyright checks.',
  },
  {
    value: 'topic',
    label: 'Topic restriction',
    description: 'Keep requests on allowed topics, or away from denied ones.',
  },
  {
    value: 'llm_rewrite',
    label: 'Rewrite',
    description: 'A Model rewrites the text before it goes on.',
  },
  {
    value: 'json_schema',
    label: 'JSON schema',
    description: 'Answers must match a schema; ask again when they don’t.',
  },
  {
    value: 'json_repair',
    label: 'JSON repair',
    description: 'Fix almost-valid JSON in answers.',
  },
  {
    value: 'template',
    label: 'Prompt templates',
    description: 'Named prompts filled from the request’s variables.',
  },
  {
    value: 'decorator',
    label: 'Prefix and suffix',
    description: 'Text added before and after the last user message.',
  },
  {
    value: 'moderation',
    label: 'Moderation',
    description: 'A moderation Model scores hate, harassment, violence, sexual content and self-harm.',
  },
  {
    value: 'llm_judge',
    label: 'Model judge',
    description: 'A Model reads the text with your instructions and decides.',
  },
  { value: 'length', label: 'Length', description: 'Bounds on characters, words or estimated tokens.' },
  {
    value: 'tool_permission',
    label: 'Tool permissions',
    description: 'Which tools a request may declare and an answer may call, by name or * pattern.',
  },
  {
    value: 'system_prompt',
    label: 'System prompt',
    description: 'Adds a system message, or replaces the one the request has.',
  },
  {
    value: 'bedrock_guardrails',
    label: 'Bedrock guardrail',
    description: 'A guardrail of your AWS account, called with a Bedrock provider’s credentials.',
  },
  {
    value: 'azure_content_safety',
    label: 'Azure content safety',
    description: 'Azure AI Content Safety rates the text by severity.',
  },
  {
    value: 'model_armor',
    label: 'Model Armor',
    description: 'A Model Armor template, called with a Vertex provider’s Google Cloud credentials.',
  },
  {
    value: 'lakera',
    label: 'Lakera Guard',
    description: 'Lakera Guard checks for prompt injection and other threats.',
  },
];

/** Methods whose findings carry labels the rule can file under its own categories. */
export const LABELLED: Method[] = [
  'classifier',
  'webhook',
  'moderation',
  'llm_judge',
  'bedrock_guardrails',
  'azure_content_safety',
  'model_armor',
  'lakera',
];

/** Methods whose redaction can label, mask or hash what it replaces. */
export const REPLACEABLE: Method[] = [
  'regex',
  'allowlist',
  'keywords',
  'pii',
  'secrets',
  'webhook',
  'tool_permission',
  'bedrock_guardrails',
  'azure_content_safety',
  'model_armor',
  'lakera',
];

export const LENGTH_BOUNDS = [
  'min_chars',
  'max_chars',
  'min_words',
  'max_words',
  'min_tokens',
  'max_tokens',
] as const;
export type LengthBound = (typeof LENGTH_BOUNDS)[number];

/** A secret the gateway reads back hidden: typed in, or kept as stored when left empty. */
export interface SecretDraft {
  value: string;
  stored: boolean;
}

export type ScopeKind = 'system' | 'user' | 'assistant' | 'tool' | 'tool_definition';
export const SCOPE_KINDS: ScopeKind[] = ['system', 'user', 'assistant', 'tool', 'tool_definition'];

/**
 * How a guardrail runs: in the request's path or beside it, its time and concurrency bounds, its
 * order, what of a prompt it reads, and what happens when the check itself fails. Empty values
 * leave the gateway's defaults.
 */
export interface RunDraft {
  execution: '' | 'blocking' | 'async' | 'parallel_with_call';
  timeout: string;
  maxConcurrency: string;
  order: string;
  /** Message kinds of a prompt it reads; empty for every kind. */
  scopeKinds: ScopeKind[];
  scopeMessages: '' | 'all' | 'last_user';
  includeOperatorContent: boolean;
  onError: '' | 'block' | 'allow';
  /** Stages a request that picks this guardrail adds it to. */
  requestStages: ('input' | 'output')[];
  /** The message a blocked request gets back. */
  message: string;
}

export function blankRun(): RunDraft {
  return {
    execution: '',
    timeout: '',
    maxConcurrency: '',
    order: '',
    scopeKinds: [],
    scopeMessages: '',
    includeOperatorContent: false,
    onError: '',
    requestStages: [],
    message: '',
  };
}

export function runOf(spec: GuardrailSpec): RunDraft {
  return {
    execution: spec.execution ?? '',
    timeout: spec.timeout ?? '',
    maxConcurrency: spec.max_concurrency != null ? String(spec.max_concurrency) : '',
    order: spec.order != null ? String(spec.order) : '',
    scopeKinds: spec.scope?.kinds ?? [],
    scopeMessages: spec.scope?.messages ?? '',
    includeOperatorContent: spec.include_operator_content ?? false,
    onError: spec.on_error ?? '',
    requestStages: spec.request_stages ?? [],
    message: spec.message ?? '',
  };
}

/** Methods that change requests instead of judging them: no action, error policy or severity. */
export const TRANSFORMS: GuardrailType[] = ['system_prompt', 'decorator', 'template', 'json_repair'];

/** Methods whose findings may replace the matched text. */
const REDACTABLE: GuardrailType[] = [
  'regex',
  'keywords',
  'pii',
  'secrets',
  'webhook',
  'tool_permission',
  'bedrock_guardrails',
  'azure_content_safety',
  'model_armor',
  'lakera',
  'llm_rewrite',
];

/** The harmful-content family: what "output moderation" counts. */
export const MODERATION_TYPES: GuardrailType[] = [
  'moderation',
  'classifier',
  'llm_judge',
  'bedrock_guardrails',
  'azure_content_safety',
  'model_armor',
  'lakera',
];

export const TYPE_LABEL: Record<GuardrailType, string> = {
  regex: 'Pattern',
  keywords: 'Keywords',
  pii: 'Personal data',
  secrets: 'Secrets',
  moderation: 'Moderation',
  webhook: 'Webhook',
  system_prompt: 'System prompt',
  decorator: 'Prefix and suffix',
  llm_judge: 'Model judge',
  json_schema: 'JSON schema',
  tool_permission: 'Tool permissions',
  length: 'Length',
  classifier: 'Classifier',
  bedrock_guardrails: 'Bedrock guardrail',
  azure_content_safety: 'Azure content safety',
  model_armor: 'Model Armor',
  lakera: 'Lakera Guard',
  template: 'Prompt templates',
  llm_rewrite: 'Rewrite',
  json_repair: 'JSON repair',
  topic: 'Topic restriction',
};

/** The category a method reports, when it does not map its own labels. */
export function impliedCategory(spec: Pick<GuardrailSpec, 'type' | 'regex'>): Category | null {
  switch (spec.type) {
    case 'regex':
      return (spec.regex?.allow?.length ?? 0) > 0 ? 'allow_pattern' : 'deny_pattern';
    case 'keywords':
      return 'keyword';
    case 'pii':
      return 'pii';
    case 'secrets':
      return 'secret';
    case 'topic':
      return 'off_topic';
    case 'json_schema':
      return 'schema_violation';
    case 'tool_permission':
      return 'tool_not_allowed';
    case 'length':
      return 'length';
    case 'llm_judge':
      return 'custom';
    default:
      return null;
  }
}

export function methodOf(spec: Pick<GuardrailSpec, 'type' | 'regex' | 'decorator'>): Method | null {
  if (spec.type === 'regex') return (spec.regex?.allow?.length ?? 0) > 0 ? 'allowlist' : 'regex';
  if (spec.type === 'decorator') return 'decorator';
  return METHODS.some((m) => m.value === spec.type) ? spec.type : null;
}

/** The stages a guardrail may run at: transforms, rewrites, topics and diverts read prompts only. */
export function stagesFor(
  type: GuardrailType,
  action: GuardrailAction | '' | undefined,
  execution?: GuardrailSpec['execution'],
): { input: boolean; output: boolean } {
  if (type === 'json_schema' || type === 'json_repair') return { input: false, output: true };
  if (
    ['system_prompt', 'decorator', 'template', 'llm_rewrite', 'topic'].includes(type) ||
    action === 'divert' ||
    execution === 'parallel_with_call'
  )
    return { input: true, output: false };
  return { input: true, output: true };
}

/** The action the gateway takes when a guardrail names none. */
export function defaultAction(type: GuardrailType): GuardrailAction {
  return type === 'pii' || type === 'secrets' || type === 'llm_rewrite' ? 'redact' : 'block';
}

export function actionsFor(method: Method | null, type: GuardrailType): GuardrailAction[] {
  if (TRANSFORMS.includes(type)) return [];
  if (method === 'allowlist') return ['block', 'flag'];
  if (type === 'llm_rewrite') return ['redact'];
  const base: GuardrailAction[] = REDACTABLE.includes(type) ? ['block', 'redact', 'flag'] : ['block', 'flag'];
  return type === 'json_schema' ? base : [...base, 'divert'];
}

/** A form's view of a guardrail; lists are one entry per line, numbers are text until saved. */
export interface RuleDraft {
  name: string;
  method: Method | null;
  type: GuardrailType;
  enabled: boolean;
  action: GuardrailAction | '';
  /** Whether the rule names its action; one that doesn't does what the gateway does by default. */
  actionNamed: boolean;
  severity: Severity | '';
  description: string;
  divertTo: string;
  patterns: string;
  validate: 'none' | 'luhn' | 'iban_mod97' | 'cpf' | 'cnpj';
  label: string;
  words: string;
  match: 'word' | 'substring';
  /** The kinds looked for: built-in ids and the labels, in lower case, of the rule's own. */
  entities: string[];
  /** Kinds of personal data the rule defines itself. */
  customKinds: CustomKind[];
  preserve: PiiPreserve[];
  replacement: 'label' | 'mask' | 'hash';
  reversible: boolean;
  detectors: SecretDetector[];
  minEntropy: string;
  url: string;
  webhookMode: 'segments' | 'body';
  thresholds: string;
  categories: string;
  model: string;
  prompt: string;
  allowedTopics: string;
  deniedTopics: string;
  threshold: string;
  schema: string;
  useRequestSchema: boolean;
  reask: string;
  templates: string;
  templateRequired: boolean;
  userPrefix: string;
  userSuffix: string;
  /** A Model judge's longest answer, in tokens. */
  judgeMaxTokens: string;
  systemText: string;
  systemMode: '' | 'replace' | 'prepend' | 'append' | 'insert_if_absent';
  systemRole: 'system' | 'developer';
  /** Tool-name patterns, one per line. */
  toolsAllow: string;
  toolsDeny: string;
  bounds: Record<LengthBound, string>;
  /** The provider whose credentials sign a Bedrock or Model Armor call. */
  provider: string;
  guardrailId: string;
  guardrailVersion: string;
  region: string;
  baseUrl: string;
  endpoint: string;
  apiVersion: string;
  severityThreshold: string;
  armorTemplate: string;
  gcpProject: string;
  gcpLocation: string;
  lakeraProject: string;
  apiKey: SecretDraft;
  /** A webhook's request headers; stored values read back hidden. */
  headers: HeaderRow[];
  signingSecret: SecretDraft;
  /** How it runs; null keeps what is written (a new rule: the defaults). */
  run: RunDraft | null;
  /** Run on prompts and on answers, at the gateway level (`policies.guardrails` input and output). */
  onInput: boolean;
  onOutput: boolean;
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

function pairs(record: Record<string, unknown> | undefined): string {
  return Object.entries(record ?? {})
    .map(([k, v]) => `${k} = ${String(v)}`)
    .join('\n');
}

export function emptyDraft(method: Method = 'regex'): RuleDraft {
  return {
    name: '',
    method,
    type: method === 'allowlist' ? 'regex' : method,
    enabled: true,
    action:
      method === 'pii'
        ? 'redact'
        : method === 'llm_rewrite'
          ? 'redact'
          : ['json_repair', 'template', 'decorator', 'system_prompt'].includes(method)
            ? ''
            : 'block',
    actionNamed: true,
    severity: '',
    description: '',
    divertTo: '',
    patterns: '',
    validate: 'none',
    label: '',
    words: '',
    match: 'word',
    entities: [...PII_ENTITIES],
    customKinds: [],
    preserve: [],
    replacement: 'label',
    reversible: false,
    detectors: [...SECRET_DETECTORS],
    minEntropy: '',
    url: '',
    webhookMode: 'segments',
    thresholds: '',
    categories: '',
    model: '',
    prompt: '',
    allowedTopics: '',
    deniedTopics: '',
    threshold: '0.5',
    schema: '',
    useRequestSchema: false,
    reask: '0',
    templates: '',
    templateRequired: false,
    userPrefix: '',
    userSuffix: '',
    judgeMaxTokens: '',
    systemText: '',
    systemMode: '',
    systemRole: 'system',
    toolsAllow: '',
    toolsDeny: '',
    bounds: { min_chars: '', max_chars: '', min_words: '', max_words: '', min_tokens: '', max_tokens: '' },
    provider: '',
    guardrailId: '',
    guardrailVersion: '',
    region: '',
    baseUrl: '',
    endpoint: '',
    apiVersion: '',
    severityThreshold: '',
    armorTemplate: '',
    gcpProject: '',
    gcpLocation: '',
    lakeraProject: '',
    apiKey: { value: '', stored: false },
    headers: [],
    signingSecret: { value: '', stored: false },
    run: null,
    onInput: !['json_schema', 'json_repair'].includes(method),
    // New rules check answers too; methods that only run on prompts drop it through `stagesFor`.
    onOutput: true,
  };
}

/** The form for an existing guardrail. */
export function draftOf(
  name: string,
  spec: GuardrailSpec,
  attached: { input: boolean; output: boolean },
): RuleDraft {
  const method = methodOf(spec);
  const d = emptyDraft(method ?? 'regex');
  const template = spec.template;
  const num = (v: number | null | undefined) => (v != null ? String(v) : '');
  const bounds = Object.fromEntries(LENGTH_BOUNDS.map((k) => [k, num(spec.length?.[k])])) as Record<
    LengthBound,
    string
  >;
  const secret = (v: string | null | undefined): SecretDraft => ({ value: '', stored: Boolean(v) });
  const vendorKey = spec.azure_content_safety?.api_key ?? spec.lakera?.api_key;
  return {
    ...d,
    name,
    method,
    type: spec.type,
    enabled: spec.enabled !== false,
    action: spec.action ?? (TRANSFORMS.includes(spec.type) ? '' : defaultAction(spec.type)),
    actionNamed: spec.action !== undefined,
    severity: spec.severity ?? '',
    description: spec.description ?? '',
    divertTo: spec.divert_to ?? '',
    patterns: ((method === 'allowlist' ? spec.regex?.allow : spec.regex?.deny) ?? []).join('\n'),
    validate: spec.regex?.validate ?? 'none',
    label: spec.regex?.label ?? '',
    words: (spec.keywords?.words ?? []).join('\n'),
    match: spec.keywords?.match ?? 'word',
    entities: checkedKinds(spec),
    customKinds: customKindsOf(spec),
    preserve: spec.pii?.preserve ?? [],
    replacement: spec.replacement ?? 'label',
    reversible: spec.pii?.reversible ?? spec.regex?.reversible ?? false,
    detectors: spec.secrets?.detectors ?? [...SECRET_DETECTORS],
    minEntropy: spec.secrets?.min_entropy != null ? String(spec.secrets.min_entropy) : '',
    url: spec.classifier?.url ?? spec.webhook?.url ?? '',
    webhookMode: spec.webhook?.mode ?? 'segments',
    thresholds: pairs(spec.classifier?.thresholds ?? spec.moderation?.thresholds),
    categories: pairs(spec.categories),
    model:
      spec.llm_rewrite?.model ??
      spec.topic?.embedding_model ??
      spec.moderation?.model ??
      spec.llm_judge?.model ??
      '',
    prompt: spec.llm_rewrite?.prompt ?? spec.llm_judge?.prompt ?? '',
    allowedTopics: (spec.topic?.allowed ?? []).join('\n'),
    deniedTopics: (spec.topic?.denied ?? []).join('\n'),
    threshold: spec.topic?.threshold != null ? String(spec.topic.threshold) : '0.5',
    schema: spec.json_schema?.schema !== undefined ? JSON.stringify(spec.json_schema.schema, null, 2) : '',
    useRequestSchema: spec.json_schema?.use_request_schema ?? false,
    reask: String(spec.json_schema?.reask ?? 0),
    templates: template ? JSON.stringify(template.templates, null, 2) : '',
    templateRequired: template?.required ?? false,
    userPrefix: spec.decorator?.user_prefix ?? '',
    userSuffix: spec.decorator?.user_suffix ?? '',
    judgeMaxTokens: num(spec.llm_judge?.max_tokens),
    systemText: spec.system_prompt?.text ?? '',
    systemMode: spec.system_prompt?.mode ?? '',
    systemRole: spec.system_prompt?.role ?? 'system',
    toolsAllow: (spec.tool_permission?.allow ?? []).join('\n'),
    toolsDeny: (spec.tool_permission?.deny ?? []).join('\n'),
    bounds,
    provider: spec.bedrock_guardrails?.provider ?? spec.model_armor?.provider ?? '',
    guardrailId: spec.bedrock_guardrails?.guardrail_id ?? '',
    guardrailVersion: spec.bedrock_guardrails?.guardrail_version ?? '',
    region: spec.bedrock_guardrails?.region ?? '',
    baseUrl: spec.bedrock_guardrails?.base_url ?? spec.model_armor?.base_url ?? spec.lakera?.base_url ?? '',
    endpoint: spec.azure_content_safety?.endpoint ?? '',
    apiVersion: spec.azure_content_safety?.api_version ?? '',
    severityThreshold: num(spec.azure_content_safety?.severity_threshold),
    armorTemplate: spec.model_armor?.template ?? '',
    gcpProject: spec.model_armor?.project ?? '',
    gcpLocation: spec.model_armor?.location ?? '',
    lakeraProject: spec.lakera?.project_id ?? '',
    apiKey: secret(vendorKey),
    headers: headerRows(spec.webhook?.headers),
    signingSecret: secret(spec.webhook?.signing_secret),
    run: runOf(spec),
    onInput: attached.input,
    onOutput: attached.output,
  };
}

export type DraftErrors = Partial<Record<keyof RuleDraft, string>>;

function parsePairs(
  text: string,
  value: (v: string) => unknown,
): { ok: true; map: Record<string, unknown> } | { ok: false; line: string } {
  const map: Record<string, unknown> = {};
  for (const line of lines(text)) {
    const m = /^([^=:]+)\s*[=:]\s*(.+)$/.exec(line);
    const parsed = m?.[2] !== undefined ? value(m[2].trim()) : undefined;
    if (!m?.[1] || parsed === undefined) return { ok: false, line };
    map[m[1].trim()] = parsed;
  }
  return { ok: true, map };
}

function ratio(v: string): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
}

function category(v: string): Category | undefined {
  return CATEGORIES.find((c) => c === v);
}

function validRegex(p: string): boolean {
  try {
    new RegExp(p);
    return true;
  } catch {
    return false;
  }
}

/** The blocks of each type, which a known method writes whole. */
const TYPE_BLOCKS = [
  'regex',
  'keywords',
  'pii',
  'secrets',
  'moderation',
  'webhook',
  'system_prompt',
  'decorator',
  'llm_judge',
  'json_schema',
  'tool_permission',
  'length',
  'classifier',
  'bedrock_guardrails',
  'azure_content_safety',
  'model_armor',
  'lakera',
  'template',
  'llm_rewrite',
  'json_repair',
  'topic',
];

/** The settings "How it runs" writes when the form holds them. */
const RUN_KEYS = [
  'execution',
  'timeout',
  'max_concurrency',
  'order',
  'scope',
  'include_operator_content',
  'on_error',
  'request_stages',
  'message',
];

const DURATION = /^([0-9]+(?:\.[0-9]+)?)(ms|s|m|h|d)$/;
const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function durationMs(v: string): number | null {
  const m = DURATION.exec(v.trim());
  return m ? Number(m[1]) * (UNIT_MS[m[2] ?? 's'] ?? 0) : null;
}

const HTTPS = /^https:\/\/[^\s/]+/i;

/** Sets or removes `key` of `obj`. */
function put<T extends object>(obj: T, key: keyof T, value: unknown): void {
  if (value === undefined || value === '') Reflect.deleteProperty(obj, key);
  else (obj as Record<keyof T, unknown>)[key] = value;
}

/** A secret to write: the new value, else the stored one as it was read (kept), else none. */
function secretOf(d: SecretDraft, stored: string | null | undefined): string | undefined {
  const v = d.value.trim();
  if (v) return v;
  return d.stored && stored ? stored : undefined;
}

/** The "How it runs" settings written onto `spec`; errors go into `errors`. */
function applyRun(
  spec: GuardrailSpec,
  run: RunDraft,
  draft: RuleDraft,
  base: GuardrailSpec | null,
  errors: DraftErrors,
): void {
  const transform = TRANSFORMS.includes(draft.type);
  if (!transform) put(spec, 'execution', run.execution || undefined);
  const t = run.timeout.trim();
  if (t) {
    const ms = durationMs(t);
    if (ms === null || ms < 10 || ms > 60_000) errors.run = 'Time limit: from 10ms to 60s, e.g. 2s';
    else spec.timeout = t;
  } else delete spec.timeout;
  const conc = run.maxConcurrency.trim();
  if (conc && !(/^\d+$/.test(conc) && Number(conc) >= 1))
    errors.run = 'Checks at once: a whole number of at least 1';
  put(spec, 'max_concurrency', conc ? Number(conc) : undefined);
  const order = run.order.trim();
  if (order && !/^-?\d+$/.test(order)) errors.run = 'Order: a whole number';
  put(spec, 'order', order ? Number(order) : undefined);
  const scope = {
    ...(run.scopeKinds.length > 0 ? { kinds: run.scopeKinds } : {}),
    ...(run.scopeMessages ? { messages: run.scopeMessages } : {}),
  };
  put(spec, 'scope', Object.keys(scope).length > 0 ? scope : undefined);
  put(
    spec,
    'include_operator_content',
    run.includeOperatorContent ? true : base?.include_operator_content === false ? false : undefined,
  );
  if (!transform) put(spec, 'on_error', run.onError || undefined);
  put(spec, 'request_stages', run.requestStages.length > 0 ? run.requestStages : undefined);
  const message = run.message.trim();
  if (message.length > 500) errors.run = 'The message is at most 500 characters';
  put(spec, 'message', message ? message : base?.message === null ? null : undefined);
  if (run.execution === 'async' && draft.action !== 'flag')
    errors.run = 'Checking in the background only flags: choose the Flag only action';
  if (run.execution && run.execution !== 'blocking' && draft.action === 'divert')
    errors.run = 'A divert decides before the call: run it in the request’s path';
}

/**
 * The guardrail a form describes, or what to fix. Settings the form does not show (notifications,
 * and "How it runs" when the form does not hold it) are kept from `base`.
 */
export function specOf(
  draft: RuleDraft,
  base: GuardrailSpec | null,
): { ok: true; spec: GuardrailSpec } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const type = draft.type;
  const known = draft.method !== null;
  const owned = new Set([
    ...TYPE_BLOCKS,
    'divert_to',
    'replacement',
    ...(draft.method && LABELLED.includes(draft.method) ? ['categories'] : []),
    ...(draft.run ? RUN_KEYS : []),
  ]);
  const keep = Object.fromEntries(
    Object.entries(base ?? {}).filter(([k]) => !(known && owned.has(k))),
  ) as Partial<GuardrailSpec>;
  const spec: GuardrailSpec = { ...keep, type, enabled: draft.enabled };
  if (base === null && !/^[a-z][a-z0-9_]{0,62}$/.test(draft.name))
    errors.name = 'Use lowercase letters, digits and underscores, starting with a letter';
  const transform = TRANSFORMS.includes(type);
  if (draft.run) applyRun(spec, draft.run, draft, base, errors);
  if (transform) {
    delete spec.action;
    delete spec.on_error;
    delete spec.execution;
  } else if (draft.action) {
    // A rule that named no action keeps naming none while it does what the gateway does without one.
    if (draft.actionNamed || draft.action !== defaultAction(type)) spec.action = draft.action;
    // A flagging rule never blocks on its own failure: a new one says so, a written one is corrected.
    if (draft.action === 'flag' && (draft.run === null || spec.on_error !== undefined))
      spec.on_error = 'allow';
  }
  if (draft.severity) spec.severity = draft.severity;
  else delete spec.severity;
  if (draft.description.trim()) spec.description = draft.description.trim();
  else delete spec.description;
  if (draft.action === 'divert') {
    if (!draft.divertTo.trim()) errors.divertTo = 'Choose the Model that answers instead';
    else spec.divert_to = draft.divertTo.trim();
  }
  if (
    draft.method &&
    REPLACEABLE.includes(draft.method) &&
    draft.action === 'redact' &&
    draft.replacement !== 'label'
  )
    spec.replacement = draft.replacement;
  if (draft.method && LABELLED.includes(draft.method)) {
    const cats = parsePairs(draft.categories, category);
    if (!cats.ok) errors.categories = `Write each line as label = category from the list (${cats.line})`;
    else if (Object.keys(cats.map).length > 0) spec.categories = cats.map as Record<string, Category>;
  }
  const vendorUrl = (key: 'baseUrl' | 'endpoint', required: boolean) => {
    const v = draft[key].trim();
    if (!v) {
      if (required) errors[key] = 'Enter the https:// address';
      return undefined;
    }
    if (!HTTPS.test(v)) errors[key] = 'An address starting with https://';
    return v;
  };
  switch (draft.method) {
    case 'regex':
    case 'allowlist': {
      const list = lines(draft.patterns);
      if (list.length === 0) errors.patterns = 'Enter at least one pattern, one per line';
      else if (list.some((p) => !validRegex(p)))
        errors.patterns = `Fix this pattern: ${list.find((p) => !validRegex(p)) ?? ''}`;
      const reversible = draft.method === 'regex' && draft.reversible;
      spec.regex = {
        ...(draft.method === 'allowlist' ? { allow: list } : { deny: list }),
        ...(draft.label.trim() ? { label: draft.label.trim() } : {}),
        ...(draft.validate !== 'none' ? { validate: draft.validate } : {}),
        ...(reversible ? { reversible: true } : {}),
      };
      if (reversible && (draft.action !== 'redact' || draft.replacement !== 'label'))
        errors.reversible = 'Putting values back needs the redact action and labels';
      break;
    }
    case 'keywords': {
      const words = lines(draft.words);
      if (words.length === 0) errors.words = 'Enter at least one word or phrase, one per line';
      spec.keywords = { words, match: draft.match };
      break;
    }
    case 'pii': {
      const entities = PII_ENTITIES.filter((e) => draft.entities.includes(e));
      const custom = draft.customKinds.filter((k) => draft.entities.includes(k.name));
      if (entities.length + custom.length === 0)
        errors.entities = 'Choose at least one kind of personal data';
      const wrong = custom.find(
        (k) =>
          Object.keys(
            customKindErrors(
              k,
              custom.filter((o) => o !== k),
            ),
          ).length > 0,
      );
      if (wrong) errors.customKinds = `Fix the kind ${wrong.name}`;
      spec.pii = {
        entities,
        ...(custom.length > 0 ? { custom: custom.map(customWire) } : {}),
        ...(draft.preserve.length > 0 ? { preserve: draft.preserve } : {}),
        ...(draft.reversible ? { reversible: true } : {}),
      };
      if (draft.replacement !== 'label') spec.replacement = draft.replacement;
      if (
        draft.reversible &&
        (draft.action !== 'redact' || draft.replacement !== 'label' || draft.preserve.length > 0)
      )
        errors.reversible = 'Reversible redaction needs the redact action, labels and nothing kept';
      break;
    }
    case 'secrets': {
      if (draft.detectors.length === 0) errors.detectors = 'Choose at least one kind of secret';
      const entropy = draft.minEntropy.trim() === '' ? null : Number(draft.minEntropy);
      if (entropy !== null && !(Number.isFinite(entropy) && entropy >= 0 && entropy <= 8))
        errors.minEntropy = 'Enter a number from 0 to 8, or leave it empty';
      spec.secrets = { detectors: draft.detectors, ...(entropy !== null ? { min_entropy: entropy } : {}) };
      break;
    }
    case 'classifier': {
      if (!draft.url.trim().startsWith('https://')) errors.url = 'Enter the endpoint’s https:// address';
      const thresholds = parsePairs(draft.thresholds, ratio);
      if (!thresholds.ok)
        errors.thresholds = `Write each line as label = a score from 0 to 1 (${thresholds.line})`;
      else if (Object.keys(thresholds.map).length === 0)
        errors.thresholds = 'Enter at least one label = score';
      spec.classifier = {
        ...(base?.classifier ?? {}),
        url: draft.url.trim(),
        thresholds: thresholds.ok ? (thresholds.map as Record<string, number>) : {},
      };
      break;
    }
    case 'webhook': {
      if (!draft.url.trim().startsWith('https://')) errors.url = 'Enter the service’s https:// address';
      const headerError = headerErrors(draft.headers);
      if (headerError) errors.headers = headerError;
      const headers = headerMap(draft.headers);
      const signing = secretOf(draft.signingSecret, base?.webhook?.signing_secret);
      spec.webhook = {
        url: draft.url.trim(),
        ...(draft.webhookMode !== 'segments' || base?.webhook?.mode ? { mode: draft.webhookMode } : {}),
        ...(headers ? { headers } : {}),
        ...(signing ? { signing_secret: signing } : {}),
      };
      break;
    }
    case 'topic': {
      if (!draft.model.trim()) errors.model = 'Choose the embeddings Model that compares topics';
      const allowed = lines(draft.allowedTopics);
      const denied = lines(draft.deniedTopics);
      if (allowed.length + denied.length === 0)
        errors.allowedTopics = 'Describe at least one allowed or denied topic, one per line';
      const t = ratio(draft.threshold);
      if (t === undefined) errors.threshold = 'Enter a similarity from 0 to 1';
      spec.topic = { embedding_model: draft.model.trim(), allowed, denied, threshold: t ?? 0.5 };
      break;
    }
    case 'llm_rewrite':
      if (!draft.model.trim()) errors.model = 'Choose the Model that rewrites';
      if (!draft.prompt.trim()) errors.prompt = 'Tell the Model how to rewrite the text';
      spec.llm_rewrite = {
        ...(base?.llm_rewrite ?? {}),
        model: draft.model.trim(),
        prompt: draft.prompt.trim(),
      };
      spec.action = 'redact';
      spec.execution = 'blocking';
      break;
    case 'json_schema': {
      const reask = Number(draft.reask);
      if (!Number.isInteger(reask) || reask < 0 || reask > 5)
        errors.reask = 'Enter a whole number from 0 to 5';
      let schema: unknown;
      if (!draft.useRequestSchema) {
        try {
          schema = JSON.parse(draft.schema) as unknown;
          if (typeof schema !== 'object' && typeof schema !== 'boolean') throw new Error('not a schema');
        } catch {
          errors.schema = 'Paste a JSON Schema object';
        }
      }
      spec.json_schema = {
        ...(draft.useRequestSchema
          ? { use_request_schema: true }
          : { schema: schema as Record<string, unknown> }),
        ...(reask > 0 ? { reask } : {}),
      };
      break;
    }
    case 'json_repair':
      spec.json_repair = {};
      break;
    case 'template': {
      let templates: unknown;
      try {
        templates = JSON.parse(draft.templates) as unknown;
        if (
          typeof templates !== 'object' ||
          templates === null ||
          Array.isArray(templates) ||
          Object.keys(templates).length === 0
        )
          throw new Error('not a map');
      } catch {
        errors.templates = 'Paste a JSON object of named templates, each with its messages';
      }
      spec.template = {
        templates: (templates ?? {}) as NonNullable<GuardrailSpec['template']>['templates'],
        ...(draft.templateRequired ? { required: true } : {}),
      };
      break;
    }
    case 'decorator':
      if (!draft.userPrefix.trim() && !draft.userSuffix.trim())
        errors.userPrefix = 'Enter a prefix, a suffix or both';
      spec.decorator = {
        ...(base?.decorator ?? {}),
        ...(draft.userPrefix.trim() ? { user_prefix: draft.userPrefix } : {}),
        ...(draft.userSuffix.trim() ? { user_suffix: draft.userSuffix } : {}),
      };
      if (!draft.userPrefix.trim()) delete spec.decorator.user_prefix;
      if (!draft.userSuffix.trim()) delete spec.decorator.user_suffix;
      break;
    case 'moderation': {
      if (!draft.model.trim()) errors.model = 'Choose the moderation Model';
      const thresholds = parsePairs(draft.thresholds, ratio);
      if (!thresholds.ok)
        errors.thresholds = `Write each line as category = a score from 0 to 1 (${thresholds.line})`;
      const t = thresholds.ok ? (thresholds.map as Record<string, number>) : {};
      const { thresholds: _old, ...rest } = base?.moderation ?? { model: '' };
      spec.moderation = {
        ...rest,
        model: draft.model.trim(),
        ...(Object.keys(t).length > 0 ? { thresholds: t } : {}),
      };
      break;
    }
    case 'llm_judge': {
      if (!draft.model.trim()) errors.model = 'Choose the Model that judges';
      const prompt = draft.prompt.trim();
      if (!prompt) errors.prompt = 'Tell the Model what to look for; {{content}} is the text';
      else if (prompt.length > 20_000) errors.prompt = 'At most 20,000 characters';
      const max = draft.judgeMaxTokens.trim();
      if (max && !(/^\d+$/.test(max) && Number(max) >= 1 && Number(max) <= 4096))
        errors.judgeMaxTokens = 'A whole number from 1 to 4096';
      spec.llm_judge = { model: draft.model.trim(), prompt, ...(max ? { max_tokens: Number(max) } : {}) };
      break;
    }
    case 'length': {
      const out: Partial<Record<LengthBound, number>> = {};
      for (const k of LENGTH_BOUNDS) {
        const v = draft.bounds[k].trim();
        if (!v) continue;
        if (!/^\d+$/.test(v)) errors.bounds = 'Each bound is a whole number, or empty';
        else out[k] = Number(v);
      }
      if (!errors.bounds && Object.keys(out).length === 0) errors.bounds = 'Set at least one bound';
      for (const unit of ['chars', 'words', 'tokens'] as const) {
        const lo = out[`min_${unit}`];
        const hi = out[`max_${unit}`];
        if (lo !== undefined && hi !== undefined && lo > hi)
          errors.bounds = `The least ${unit} is above the most`;
      }
      spec.length = out;
      break;
    }
    case 'tool_permission': {
      const allow = lines(draft.toolsAllow);
      const deny = lines(draft.toolsDeny);
      if (allow.length + deny.length === 0)
        errors.toolsAllow = 'List at least one tool to allow or deny, one per line';
      spec.tool_permission = {
        ...(allow.length > 0 ? { allow } : {}),
        ...(deny.length > 0 ? { deny } : {}),
      };
      break;
    }
    case 'system_prompt':
      if (!draft.systemText.trim()) errors.systemText = 'Write the system message';
      spec.system_prompt = {
        text: draft.systemText,
        ...(draft.systemMode ? { mode: draft.systemMode } : {}),
        ...(draft.systemRole !== 'system' || base?.system_prompt?.role ? { role: draft.systemRole } : {}),
      };
      break;
    case 'bedrock_guardrails': {
      if (!draft.provider.trim())
        errors.provider = 'Choose the Bedrock provider whose credentials sign the call';
      if (!draft.guardrailId.trim()) errors.guardrailId = 'The guardrail’s id or ARN';
      const url = vendorUrl('baseUrl', false);
      spec.bedrock_guardrails = {
        provider: draft.provider.trim(),
        guardrail_id: draft.guardrailId.trim(),
        ...(draft.guardrailVersion.trim() ? { guardrail_version: draft.guardrailVersion.trim() } : {}),
        ...(draft.region.trim() ? { region: draft.region.trim() } : {}),
        ...(url ? { base_url: url } : {}),
      };
      break;
    }
    case 'azure_content_safety': {
      const endpoint = vendorUrl('endpoint', true);
      const key = secretOf(draft.apiKey, base?.azure_content_safety?.api_key);
      if (!key) errors.apiKey = 'Enter the API key';
      const sev = draft.severityThreshold.trim();
      if (sev && !(/^\d$/.test(sev) && Number(sev) <= 7)) errors.severityThreshold = 'From 0 to 7';
      spec.azure_content_safety = {
        endpoint: endpoint ?? '',
        api_key: key ?? '',
        ...(draft.apiVersion.trim() ? { api_version: draft.apiVersion.trim() } : {}),
        ...(sev ? { severity_threshold: Number(sev) } : {}),
      };
      break;
    }
    case 'model_armor': {
      if (!draft.provider.trim())
        errors.provider = 'Choose the Vertex provider whose credentials sign the call';
      if (!draft.armorTemplate.trim()) errors.armorTemplate = 'The template’s id';
      const url = vendorUrl('baseUrl', false);
      spec.model_armor = {
        provider: draft.provider.trim(),
        template: draft.armorTemplate.trim(),
        ...(draft.gcpProject.trim() ? { project: draft.gcpProject.trim() } : {}),
        ...(draft.gcpLocation.trim() ? { location: draft.gcpLocation.trim() } : {}),
        ...(url ? { base_url: url } : {}),
      };
      break;
    }
    case 'lakera': {
      const key = secretOf(draft.apiKey, base?.lakera?.api_key);
      if (!key) errors.apiKey = 'Enter the API key';
      const url = vendorUrl('baseUrl', false);
      spec.lakera = {
        api_key: key ?? '',
        ...(url ? { base_url: url } : {}),
        ...(draft.lakeraProject.trim() ? { project_id: draft.lakeraProject.trim() } : {}),
      };
      break;
    }
    case null:
      break;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, spec };
}

/**
 * "Allow similar" and "Block similar" as a prepared edit of the guardrail that produced an event:
 * the change in words and the form with it applied, to review and save.
 */
export function prepareSimilar(
  kind: 'allow' | 'block',
  event: Pick<SafetyEvent, 'entities' | 'action'>,
  draft: RuleDraft,
): { draft: RuleDraft; change: string } | null {
  // Events name a kind of the rule's own by its label; the form, by its name.
  const types = (event.entities ?? []).map((e) => e.type);
  const found = [...types, ...draft.customKinds.filter((k) => types.includes(kindEntity(k))).map(kindId)];
  if (kind === 'allow') {
    if (draft.type === 'pii') {
      const drop = draft.entities.filter((e) => found.includes(e));
      const left = draft.entities.filter((e) => !found.includes(e));
      if (drop.length > 0 && left.length > 0)
        return {
          draft: { ...draft, entities: left },
          change: `Stop checking for ${drop.map((e) => kindInText(e, draft.customKinds)).join(', ')}.`,
        };
    }
    if (draft.type === 'secrets') {
      const drop = draft.detectors.filter((d) => found.includes(d));
      const left = draft.detectors.filter((d) => !found.includes(d));
      if (drop.length > 0 && left.length > 0)
        return {
          draft: { ...draft, detectors: left },
          change: `Stop checking for ${drop.map((d) => ENTITY_NAME[d] ?? d).join(', ')}.`,
        };
    }
    if (draft.action === 'flag' || !draft.action) return null;
    return {
      draft: { ...draft, action: 'flag' },
      change: 'Let similar requests through and only flag them, instead of blocking or changing them.',
    };
  }
  if (draft.action === 'block' || !draft.action) return null;
  const entities =
    draft.type === 'pii'
      ? [...new Set([...draft.entities, ...allKinds(draft.customKinds).filter((e) => found.includes(e))])]
      : draft.entities;
  return {
    draft: { ...draft, action: 'block', entities, reversible: false },
    change: 'Block similar requests instead of letting them through.',
  };
}

/** What a PII value looks like after redaction, with the parts the guardrail keeps. */
export function maskedSample(
  entity: string,
  replacement: 'label' | 'mask' | 'hash',
  preserve: PiiPreserve[],
  numbered = false,
): string {
  const label = placeholder(entity, numbered);
  const base = replacement === 'hash' ? '#3f9a1c…' : replacement === 'mask' ? '••••••' : label;
  switch (entity) {
    case 'email':
      return preserve.includes('email_domain')
        ? `${replacement === 'label' ? label : base}@example.com`
        : base;
    case 'credit_card':
      return preserve.includes('last4') ? `${replacement === 'label' ? label : '•••• •••• ••••'} 4242` : base;
    case 'ip_address':
      return preserve.includes('ip_subnet') ? '203.0.113.x' : base;
    case 'phone':
      return preserve.includes('country') ? `+1 ${replacement === 'label' ? label : '••• •••••'}` : base;
    case 'iban':
    case 'us_ssn':
    case 'ca_sin':
      return preserve.includes('last4') ? `${replacement === 'label' ? label : '••••'} 6789` : base;
    default:
      return base;
  }
}

/** How a kind of the rule's own is found. */
export function customMethod(kind: CustomKind): string {
  const check: Record<EntityCheck, string> = {
    none: '',
    luhn: ' and Luhn checksum',
    iban_mod97: ' and mod-97 checksum',
    cpf: ' and CPF check digits',
    cnpj: ' and CNPJ check digits',
  };
  return `Your pattern${check[kind.validate]}`;
}

/** How each kind of data is found. */
export function detectionMethod(entity: string, minEntropy?: number | null): string {
  switch (entity) {
    case 'credit_card':
    case 'ca_sin':
      return 'Pattern and Luhn checksum';
    case 'iban':
      return 'Pattern and mod-97 checksum';
    case 'ip_address':
      return 'Address parser';
    case 'email':
    case 'phone':
    case 'us_ssn':
      return 'Pattern';
    default:
      return minEntropy != null ? `Prefix and entropy ≥ ${minEntropy}` : 'Known prefix';
  }
}

export type Strictness = 'loose' | 'balanced' | 'strict';

/** The strictness presets over a PII guardrail's entities, kept parts and replacement. */
export const STRICTNESS: Record<
  Strictness,
  {
    label: string;
    entities: PiiEntity[];
    preserve: PiiPreserve[];
    replacement: 'label' | 'mask';
    summary: string;
  }
> = {
  loose: {
    label: 'Loose',
    entities: ['email', 'credit_card', 'us_ssn', 'iban'],
    preserve: ['email_domain', 'last4'],
    replacement: 'mask',
    summary:
      'Direct identifiers and financial numbers only; email domains and last four digits stay readable.',
  },
  balanced: {
    label: 'Balanced',
    entities: ['email', 'phone', 'credit_card', 'us_ssn', 'iban', 'ca_sin'],
    preserve: [],
    replacement: 'label',
    summary: 'Every identifier but IP addresses; values become labels, nothing of a value is kept.',
  },
  strict: {
    label: 'Strict',
    entities: [...PII_ENTITIES],
    preserve: [],
    replacement: 'label',
    summary: 'Every kind of personal data, including IP addresses; nothing of a value is kept.',
  },
};

function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** The built-in kinds a rule looks for; presets leave the rule's own kinds as they are. */
function builtinKinds(spec: GuardrailSpec): PiiEntity[] {
  const checked = checkedKinds(spec);
  return PII_ENTITIES.filter((e) => checked.includes(e));
}

export function strictnessOf(spec: GuardrailSpec): Strictness | null {
  const entities = builtinKinds(spec);
  const preserve = spec.pii?.preserve ?? [];
  const replacement = spec.replacement ?? 'label';
  for (const [key, p] of Object.entries(STRICTNESS) as [Strictness, (typeof STRICTNESS)[Strictness]][])
    if (sameSet(entities, p.entities) && sameSet(preserve, p.preserve) && replacement === p.replacement)
      return key;
  return null;
}

/** What applying a preset changes, in words; empty when nothing does. */
export function strictnessChanges(spec: GuardrailSpec, to: Strictness): string[] {
  const p = STRICTNESS[to];
  const entities = builtinKinds(spec);
  const preserve = spec.pii?.preserve ?? [];
  const replacement = spec.replacement ?? 'label';
  const out: string[] = [];
  const name = (e: string) => inText(ENTITY_NAME[e] ?? e);
  const added = p.entities.filter((e) => !entities.includes(e));
  const removed = entities.filter((e) => !p.entities.includes(e));
  if (added.length > 0) out.push(`Starts checking for ${added.map(name).join(', ')}`);
  if (removed.length > 0) out.push(`Stops checking for ${removed.map(name).join(', ')}`);
  const keep = p.preserve.filter((x) => !preserve.includes(x));
  const drop = preserve.filter((x) => !p.preserve.includes(x));
  if (keep.length > 0) out.push(`Keeps ${keep.map((x) => inText(PRESERVE_NAME[x])).join(', ')} readable`);
  if (drop.length > 0) out.push(`No longer keeps ${drop.map((x) => inText(PRESERVE_NAME[x])).join(', ')}`);
  if (replacement !== p.replacement)
    out.push(
      p.replacement === 'mask'
        ? 'Masks values instead of labelling them'
        : 'Labels values instead of masking them',
    );
  if (spec.pii?.reversible && (p.replacement !== 'label' || p.preserve.length > 0))
    out.push('Turns reversible redaction off (it needs labels and nothing kept)');
  return out;
}

export function applyStrictness(spec: GuardrailSpec, to: Strictness): GuardrailSpec {
  const p = STRICTNESS[to];
  const reversible = Boolean(spec.pii?.reversible) && p.replacement === 'label' && p.preserve.length === 0;
  const own = customKindsOf(spec);
  const next: GuardrailSpec = {
    ...spec,
    pii: {
      entities: p.entities,
      ...(own.length > 0 ? { custom: own.map(customWire) } : {}),
      ...(p.preserve.length > 0 ? { preserve: p.preserve } : {}),
      ...(reversible ? { reversible } : {}),
    },
  };
  if (p.replacement === 'label') delete next.replacement;
  else next.replacement = p.replacement;
  return next;
}
