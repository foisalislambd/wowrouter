import { z } from 'zod';

import type { components } from '@/lib/api/schema';

/**
 * Your own kinds of sensitive value, found by pattern. Settings › Data & privacy keeps each one as
 * a pattern rule (`entity_<label>`); a personal data rule lists its own beside the built-in kinds.
 * Both take a label (the placeholder, `[CUSTOMER_ID]`) and an optional check a match must pass.
 */
export type EntityCheck = components['schemas']['PatternCheck'];

export const ENTITY_CHECKS: { value: EntityCheck; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'luhn', label: 'Luhn checksum (card-like numbers)' },
  { value: 'iban_mod97', label: 'IBAN checksum' },
  { value: 'cpf', label: 'CPF check digits (Brazil)' },
  { value: 'cnpj', label: 'CNPJ check digits (Brazil)' },
];

export function entityCheck(v: string): EntityCheck {
  return ENTITY_CHECKS.find((c) => c.value === v)?.value ?? 'none';
}

export const entityLabel = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{0,62}$/, 'Use capital letters, digits and _, starting with a letter');

export const entityPatterns = z
  .string()
  .refine((v) => v.split('\n').some((l) => l.trim() !== ''), 'Enter at least one pattern')
  .refine((v) => v.split('\n').every((l) => l.length <= 1000), 'Keep each pattern under 1,000 characters')
  .refine((v) => v.split('\n').filter((l) => l.trim()).length <= 256, 'Use at most 256 patterns');

export const entitySchema = z.object({ label: entityLabel, patterns: entityPatterns });

/** The patterns of a form's text: one per line, blank lines dropped. */
export function patternLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** The first pattern a browser can't compile, if any (the gateway's dialect is close to it). */
export function badPattern(patterns: string[]): string | null {
  for (const p of patterns) {
    try {
      new RegExp(p);
    } catch {
      return p;
    }
  }
  return null;
}
