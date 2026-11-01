'use client';

import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import { useReportUnsaved } from '../unsaved';

/** A settings section: flat and full-bleed, a title row over its body, a hairline under it. */
export function Card({
  id,
  title,
  badge,
  description,
  actions,
  children,
  danger,
}: {
  /** An anchor, so a link can land on this card. */
  id?: string;
  title: string;
  /** A small mark after the title, such as {@link GatewayWide} or {@link FromFile}. */
  badge?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  danger?: boolean;
}) {
  return (
    <section id={id} className="scroll-mt-4 border-b border-line bg-raised">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 max-sm:px-gutter-sm">
        <div className="min-w-0 flex-[1_1_16rem]">
          <h3
            className={
              danger
                ? 'flex flex-wrap items-center gap-2 text-body font-semibold text-error'
                : 'flex flex-wrap items-center gap-2 text-body font-semibold text-fg'
            }
          >
            {title}
            {badge}
          </h3>
          {description ? <p className="mt-0.5 text-ui text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children ? (
        <div className="px-5 pt-4 pb-5 max-sm:px-gutter-sm">{children}</div>
      ) : (
        <div className="pb-4" />
      )}
    </section>
  );
}

/** On a page that also holds one organization's settings: this card applies to every organization. */
export function GatewayWide() {
  return <Badge title="Shared by every organization on this gateway">Whole gateway</Badge>;
}

/** Settings read from the gateway's configuration file at startup, which nothing here can change. */
export function FromFile() {
  return (
    <Badge tone="info" title="Change it in the configuration file, then restart the gateway">
      Set in the configuration file
    </Badge>
  );
}

/** Label-value rows in plain words ("Password sign-in: On"). */
export function Facts({ items }: { items: { label: string; value: ReactNode; hint?: ReactNode }[] }) {
  return (
    <dl className="flex flex-col divide-y divide-line border-y border-line">
      {items.map((item) => (
        <div key={item.label} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-2.5">
          <dt className="w-56 shrink-0 text-ui text-muted max-sm:w-full">{item.label}</dt>
          <dd className="min-w-0 flex-1 text-ui text-fg">
            {item.value}
            {item.hint ? <p className="mt-0.5 text-caption text-muted">{item.hint}</p> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Save and Discard that only wake up once something changed. */
export function SaveBar({
  dirty,
  busy,
  canEdit,
  onDiscard,
}: {
  dirty: boolean;
  busy?: boolean;
  canEdit: boolean;
  onDiscard: () => void;
}) {
  useReportUnsaved(dirty);
  return (
    <div className="flex items-center gap-2 border-t border-line pt-4">
      <Button
        type="submit"
        variant="primary"
        busy={busy}
        disabled={!canEdit || !dirty}
        disabledReason={!canEdit ? "Your role can't change these settings" : 'Nothing changed yet'}
      >
        Save changes
      </Button>
      {dirty ? (
        <>
          <Button variant="ghost" onClick={onDiscard}>
            Discard
          </Button>
          <span className="text-caption text-muted">Unsaved changes</span>
        </>
      ) : null}
    </div>
  );
}

/** Raw settings behind a disclosure, for operators who need the exact values. */
export function TechnicalDetails({ value }: { value: unknown }) {
  const empty =
    value === null || value === undefined || (typeof value === 'object' && Object.keys(value).length === 0);
  if (empty) return null;
  return (
    <details className="group">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-caption text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
        <Icon name="chevronRight" size={12} className="transition-transform group-open:rotate-90" />
        Technical details
      </summary>
      <pre className="mono mt-2 max-h-64 overflow-auto rounded-control border border-line bg-sunken p-3 text-caption text-fg">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
