import type { HttpHandler } from 'msw';

import type { components } from '@/lib/api/schema';

import { mock } from './http';

type Spec = components['schemas']['Guardrail'];
type Span = components['schemas']['GuardrailTestResult']['spans'][number];

/**
 * `POST /guardrails:test` for settings that need not be saved: a small stand-in for the gateway's
 * pattern, keyword and personal data checks, enough for the rule editor's test panel. A rule that
 * puts values back numbers its placeholders per value and reports what restore gives back.
 */
const BUILT_IN: Record<string, RegExp> = {
  email: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  phone: /\+?\d{1,3}[ -]?\(?\d{2,3}\)?[ -]?\d{3,5}[ -]?\d{4}\b/g,
  credit_card: /\b(?:\d{4}[ -]?){3}\d{4}\b/g,
  us_ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  iban: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
  ip_address: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g,
  ca_sin: /\b\d{3} \d{3} \d{3}\b/g,
};

interface Found {
  start: number;
  end: number;
  label: string;
}

function compile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern.replace(/^\(\?i\)/, ''), pattern.startsWith('(?i)') ? 'gi' : 'g');
  } catch {
    return null;
  }
}

function find(text: string, re: RegExp | null | undefined, label: string): Found[] {
  if (!re) return [];
  return [...text.matchAll(new RegExp(re.source, re.flags))]
    .filter((m) => m[0])
    .map((m) => ({ start: m.index, end: m.index + m[0].length, label }));
}

function matches(spec: Spec, name: string): (text: string) => Found[] {
  return (text) => {
    const all: Found[] = [];
    if (spec.type === 'pii') {
      for (const e of spec.pii?.entities ?? Object.keys(BUILT_IN))
        all.push(...find(text, BUILT_IN[e], e.toUpperCase()));
      for (const k of spec.pii?.custom ?? [])
        all.push(...find(text, compile(k.pattern), (k.label ?? k.name).toUpperCase()));
    } else if (spec.type === 'regex') {
      const label = spec.regex?.label ?? (spec.regex?.reversible ? name : 'REDACTED');
      for (const p of spec.regex?.deny ?? []) all.push(...find(text, compile(p), label.toUpperCase()));
    } else if (spec.type === 'keywords') {
      for (const w of spec.keywords?.words ?? []) {
        const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(spec.keywords?.match === 'substring' ? escaped : `\\b${escaped}\\b`, 'gi');
        all.push(...find(text, re, 'KEYWORD'));
      }
    }
    // The earliest, then the longest, match wins where two overlap.
    all.sort((a, b) => a.start - b.start || b.end - a.end);
    const kept: Found[] = [];
    for (const f of all) if (!kept.some((k) => f.start < k.end && k.start < f.end)) kept.push(f);
    return kept;
  };
}

export function testRuleSpec(
  spec: Spec,
  text: string,
  name = 'unsaved',
): components['schemas']['GuardrailTestResult'] {
  const found = matches(spec, name)(text);
  const action = spec.action ?? (spec.type === 'pii' ? 'redact' : 'block');
  const reversible =
    (spec.type === 'pii' && spec.pii?.reversible === true) ||
    (spec.type === 'regex' && spec.regex?.reversible === true);
  const tokens = new Map<string, string>();
  const next = new Map<string, number>();
  const spans: Span[] = found.map((f) => {
    if (action !== 'redact')
      return { start: f.start, end: f.end, entity: f.label.toLowerCase(), replacement: null };
    const value = text.slice(f.start, f.end);
    let token = tokens.get(`${f.label}\u0000${value}`);
    if (!token) {
      const n = (next.get(f.label) ?? 0) + 1;
      next.set(f.label, n);
      token = reversible ? `[${f.label}_${n}]` : `[${f.label}]`;
      tokens.set(`${f.label}\u0000${value}`, token);
    }
    return { start: f.start, end: f.end, entity: f.label.toLowerCase(), replacement: token };
  });
  let redacted = text;
  for (const s of [...spans].reverse())
    if (s.replacement) redacted = redacted.slice(0, s.start) + s.replacement + redacted.slice(s.end);
  const category =
    spans.length === 0
      ? null
      : spec.type === 'pii'
        ? 'pii'
        : spec.type === 'regex'
          ? 'deny_pattern'
          : spec.type === 'keywords'
            ? 'keyword'
            : null;
  return {
    verdict: spans.length === 0 ? 'pass' : action,
    category,
    spans,
    redacted,
    // Restoring the placeholders the provider got gives the sample's values back.
    restored: reversible && action === 'redact' && spans.length > 0 ? text : null,
  };
}

export function guardrailTestHandlers(): HttpHandler[] {
  return [
    mock('post', '/guardrails:test', ({ body }) => {
      const b = body as components['schemas']['GuardrailTestUnsavedRequest'];
      const text = 'text' in b.input ? b.input.text : JSON.stringify(b.input.body);
      return testRuleSpec(b.spec, text, b.name);
    }),
  ];
}
