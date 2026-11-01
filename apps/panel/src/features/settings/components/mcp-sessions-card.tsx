'use client';

import { useCallback, useEffect, useState } from 'react';

import { Field, Select } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { LoadError, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api/client';
import { plural } from '@/lib/format';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';
import { emptySlot, failSlot, type Slot } from '@/lib/slot';

import { durationOptions } from '../choices';
import { Card, Facts, FromFile } from './parts';
import { SettingsForm } from './settings-form';

type McpSettings = Awaited<ReturnType<typeof readMcp>>;

function readMcp() {
  return api.get('/settings/mcp');
}

export interface McpSessionValues {
  maxLifetime: string;
}

/**
 * MCP sessions through the gateway: how long one may last, the keys that sign session ids, and
 * the commands local (stdio) servers may run, which only the configuration file sets.
 */
export function McpSessionsCard() {
  const canRead = useCan('getMcpSettings');
  const canEdit = useCan('patchMcpSettings');
  const [settings, setSettings] = useState<Slot<McpSettings>>(emptySlot);
  const reload = useCallback(
    () =>
      readMcp().then(
        (data) => setSettings({ data, status: 'ready', error: null, at: Date.now() }),
        (e: unknown) => setSettings((s) => failSlot(s, e)),
      ),
    [],
  );
  useEffect(() => {
    if (canRead) void reload();
  }, [canRead, reload]);
  if (!canRead) return null;
  const spec = settings.data?.spec;
  const keys = spec?.session?.keys ?? [];
  const commands = spec?.stdio?.allowed_commands ?? [];
  return (
    <Card title="MCP sessions" description="Sessions apps open with MCP servers through the gateway.">
      <LoadError of={settings} subject="MCP settings" size="sm" />
      {!settings.data && !settings.error ? <LoadingRows rows={2} /> : null}
      {settings.data ? (
        <div className="flex flex-col gap-5">
          <SettingsForm<McpSessionValues>
            key={settings.data.metadata.etag}
            initial={{
              maxLifetime: spec?.session?.max_lifetime ?? SETTINGS_DEFAULTS.mcp.session.max_lifetime,
            }}
            toSpec={(v) => ({ session: { max_lifetime: v.maxLifetime } })}
            save={async (patch) => {
              await api.patch('/settings/mcp', {
                body: { spec: patch },
                ifMatch: settings.data?.metadata.etag,
              });
              await reload();
            }}
            canEdit={canEdit}
            saved="MCP session settings saved"
            paths={{ 'mcp.session.max_lifetime': 'maxLifetime' }}
          >
            {({ values, set, errors, disabled }) => (
              <Field
                label="A session lasts at most"
                error={errors.maxLifetime}
                hint="Then the app opens a new one."
                className="w-56 max-sm:w-full"
              >
                <Select
                  value={values.maxLifetime}
                  disabled={disabled}
                  onChange={(v) => set('maxLifetime', v)}
                  options={durationOptions(['1h', '8h', '24h', '7d', '30d'], values.maxLifetime)}
                />
              </Field>
            )}
          </SettingsForm>
          <Facts
            items={[
              {
                label: 'Session signing keys',
                value: keys.length
                  ? `${plural(keys.length, 'key')}, newest id ${Math.max(...keys.map((k) => k.id))}`
                  : 'One the gateway generated and keeps in its store',
                hint: 'They sign session ids, so every node accepts them. Change them in Configuration.',
              },
              {
                label: 'Commands local servers may run',
                value: commands.length ? <span className="mono">{commands.join(', ')}</span> : 'None',
                hint: (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    Local (stdio) MCP servers start only these programs. <FromFile />
                  </span>
                ),
              },
            ]}
          />
        </div>
      ) : null}
    </Card>
  );
}
