'use client';

import { useEffect, useState } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm';
import { Switch } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { notify } from '@/stores/ui';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';

import { useOrgSettings } from '../store';
import { Card } from './parts';

/**
 * Whether apps must send an API key (`auth.mode`): turning it off lets every request in without
 * one, so it lives here, behind a typed confirmation.
 */
export function KeyRequirementCard() {
  const auth = useOrgSettings((s) => s.auth);
  const loadSettings = useOrgSettings((s) => s.loadSettings);
  const saveAuth = useOrgSettings((s) => s.saveAuth);
  const canRead = useCan('getAuthSettings');
  const canEdit = useCan('patchAuthSettings');
  const [confirm, setConfirm] = useState<boolean | null>(null);
  useEffect(() => {
    if (canRead && auth.status === 'idle') void loadSettings();
  }, [canRead, auth.status, loadSettings]);
  if (!canRead) return null;
  const required = (auth.data?.spec.mode ?? SETTINGS_DEFAULTS.auth.mode) === 'required';
  return (
    <Card
      danger
      title="Require an API key"
      description="Apps must send a valid key with every request. Off, anyone who can reach the gateway can call every Model, with no limits or budgets of a key."
      actions={
        <Switch
          label="Require an API key"
          hideLabel
          checked={required}
          disabled={!canEdit || !auth.data}
          disabledReason="You don't have permission to change security settings."
          onChange={(next) => setConfirm(next)}
        />
      }
    >
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm ? 'Require an API key again?' : 'Let requests in without an API key?'}
        tone={confirm ? 'primary' : 'danger'}
        confirmLabel={confirm ? 'Require a key' : 'Stop requiring a key'}
        typeToConfirm={confirm ? undefined : 'no key'}
        withReason
        effect={
          confirm
            ? 'Requests without a valid key are refused again.'
            : 'Every request is let in without a key, from anyone who can reach the gateway, until someone turns this back on.'
        }
        onConfirm={async (reason) => {
          await saveAuth({ mode: confirm ? 'required' : 'disabled' }, reason);
          notify('success', confirm ? 'API keys required again' : 'API keys no longer required');
        }}
      />
    </Card>
  );
}
