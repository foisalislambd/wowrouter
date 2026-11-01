import { describe, expect, it } from 'vitest';

import { settingsScopeWords } from '../components/sections';

describe('gateway settings', () => {
  it('says whom the open section is for', () => {
    expect(settingsScopeWords('general', { kind: 'gateway' })).toBe('For the default organization');
    expect(settingsScopeWords('general', { kind: 'organization', name: 'acme' })).toBe('For acme');
    // Notifications, webhooks and SMTP are gateway-wide, whatever the scope.
    expect(settingsScopeWords('notifications', { kind: 'organization', name: 'acme' })).toBe(
      'For the whole gateway',
    );
    expect(settingsScopeWords('webhooks', { kind: 'gateway' })).toBe('For the whole gateway');
    expect(settingsScopeWords('sign-in', { kind: 'gateway' })).toBe(
      'For the whole gateway and the default organization',
    );
    expect(settingsScopeWords('privacy', { kind: 'gateway' })).toBe('For the whole gateway');
    expect(settingsScopeWords('privacy', { kind: 'organization', name: 'acme' })).toBe(
      'For acme and the whole gateway',
    );
    expect(settingsScopeWords('api-endpoints', { kind: 'gateway' })).toBe('For the whole gateway');
    expect(settingsScopeWords('audit', { kind: 'gateway' })).toBe('For the whole gateway');
    expect(settingsScopeWords('danger', { kind: 'organization', name: 'acme' })).toBe(
      'For the whole gateway',
    );
  });
});
