import type { LogRecord } from '@/lib/api/types';

import { customKindsOf, type GuardrailSpec, kindInText, placeholder } from '@/features/safety/rules';

/** One rule that replaced values in the prompt before the provider saw it. */
export interface Replacement {
  rule: string;
  /** Values replaced per kind; empty when the record has no matches to count (no content access). */
  counts: Record<string, number>;
  /**
   * The rule gave the provider numbered placeholders that the answer gets back as values (a
   * personal data or pattern rule that puts values back); null when its settings can't be read.
   */
  tokenized: boolean | null;
  /** The rule's settings, when they could be read: names its own kinds. */
  spec: GuardrailSpec | null;
}

/** What the record says the gateway did with personal data on the way in and out. */
export interface PiiHandling {
  replaced: Replacement[];
  /** Some rule tokenized values, so the answer had them put back. */
  tokenized: boolean;
  /** Placeholders handed out that the stored answer still holds, such as `[EMAIL_1]`. */
  leftInAnswer: string[];
}

function text(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** The names of the rules that replaced values in the prompt. */
export function replacingRules(record: Pick<LogRecord, 'guardrails'>): string[] {
  return [
    ...new Set(
      record.guardrails
        .filter((g) => text(g.stage) === 'input' && text(g.verdict) === 'redact')
        .map((g) => text(g.name) ?? text(g.guardrail) ?? '')
        .filter(Boolean),
    ),
  ];
}

/**
 * The prompt-side replacements of a record, with each rule's settings where read (`specs`), and
 * the placeholders the stored answer (`answer`, its text) still holds. A rule whose settings put
 * values back tokenized them: the provider saw `[EMAIL_1]` and the answer got the value back.
 */
export function piiHandling(
  record: Pick<LogRecord, 'guardrails'>,
  specs: Record<string, GuardrailSpec | null>,
  answer: string,
): PiiHandling {
  const replaced: Replacement[] = [];
  for (const g of record.guardrails) {
    if (text(g.stage) !== 'input' || text(g.verdict) !== 'redact') continue;
    const rule = text(g.name) ?? text(g.guardrail) ?? '';
    const spans = Array.isArray(g.spans) ? (g.spans as { entity?: unknown }[]) : [];
    const counts: Record<string, number> = {};
    for (const s of spans) {
      // Records name kinds as the rule labels them (`PHONE`); reports, in lower case.
      const e = text(s.entity)?.toLowerCase();
      if (e) counts[e] = (counts[e] ?? 0) + 1;
    }
    const spec = specs[rule] ?? null;
    const tokenized = spec
      ? (spec.type === 'pii' && spec.pii?.reversible === true) ||
        (spec.type === 'regex' && spec.regex?.reversible === true)
      : null;
    const same = replaced.find((r) => r.rule === rule);
    if (same) for (const [e, n] of Object.entries(counts)) same.counts[e] = (same.counts[e] ?? 0) + n;
    else replaced.push({ rule, counts, tokenized, spec });
  }
  const tokenized = replaced.some((r) => r.tokenized === true);
  const labels = new Set(
    replaced
      .filter((r) => r.tokenized === true)
      .flatMap((r) => Object.keys(r.counts).map((e) => e.toUpperCase())),
  );
  const left = [...answer.matchAll(/\[([A-Z][A-Z0-9_]*)_(\d+)\]/g)]
    .filter((m) => labels.size === 0 || labels.has(m[1] ?? ''))
    .map((m) => m[0]);
  return { replaced, tokenized, leftInAnswer: tokenized ? [...new Set(left)] : [] };
}

/** "2 values (phone number, Brazilian CPF)", or null when the record has no matches to count. */
export function countsInWords(r: Replacement): string | null {
  const kinds = r.spec ? customKindsOf(r.spec) : [];
  const total = Object.values(r.counts).reduce((a, n) => a + n, 0);
  if (total === 0) return null;
  const names = Object.keys(r.counts).map((e) => kindInText(e, kinds));
  return `${total === 1 ? '1 value' : `${total} values`} (${names.join(', ')})`;
}

/** A placeholder of the kinds a rule replaced, for the sentence that explains them. */
export function examplePlaceholder(r: Replacement): string {
  const first = Object.keys(r.counts)[0] ?? 'email';
  return placeholder(first, r.tokenized === true);
}
