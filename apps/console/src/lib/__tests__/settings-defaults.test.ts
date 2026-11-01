import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SETTINGS_DEFAULTS } from '../settings-defaults';

// Vitest runs from the console directory.
const script = resolve(process.cwd(), 'scripts/generate-settings-defaults.mjs');

describe('settings defaults', () => {
  it('match the configuration schema (run `pnpm settings:defaults` when this fails)', () => {
    expect(() => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it('carry the built-in values the settings pages show', () => {
    expect(SETTINGS_DEFAULTS.limits.algorithm).toBe('gcra');
    expect(SETTINGS_DEFAULTS.limits.on_store_unavailable).toBe('local_share');
    expect(SETTINGS_DEFAULTS.server.admission).toMatchObject({
      max_in_flight: 16384,
      max_queue: 4096,
      queue_timeout: '2s',
    });
    expect(SETTINGS_DEFAULTS.security.client_ip.header).toBe('x-forwarded-for');
    expect(SETTINGS_DEFAULTS.auth.admin.scim.enabled).toBe(false);
  });
});
