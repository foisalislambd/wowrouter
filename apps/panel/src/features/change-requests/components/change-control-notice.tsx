'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { useSettingsHref } from '@/components/layout/url-sync';
import { useCan } from '@/components/ui/gate';
import { Icon } from '@/components/ui/icon';

import { CHANGE_CONTROL_ANCHOR } from '@/features/settings/components/change-control-card';

import { useChangeRequests } from '../store';

/**
 * While change control holds nothing (no kind of change, no single setting), changes apply at
 * once and no change request is opened for them: says so, with a link to where it is turned on.
 */
export function ChangeControlNotice() {
  const canRead = useCan('getGovernanceSettings');
  const governance = useChangeRequests((s) => s.governance);
  const load = useChangeRequests((s) => s.loadGovernance);
  const dangerHref = useSettingsHref('danger');
  useEffect(() => {
    if (canRead && governance.status === 'idle') void load();
  }, [canRead, governance.status, load]);
  const spec = governance.data?.spec;
  if (!canRead || !spec) return null;
  const cc = spec.change_control;
  const off = (cc?.resources ?? []).length === 0 && (cc?.protected_paths ?? []).length === 0;
  if (!off) return null;
  const held = (spec.dual_control?.actions ?? []).length > 0;
  return (
    <p
      role="status"
      className="flex flex-wrap items-start gap-x-2 gap-y-1 border-b border-line bg-raised px-5 py-3 text-ui text-fg max-sm:px-gutter-sm"
    >
      <Icon name="info" size={16} className="mt-0.5 shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        Change control is off: changes apply at once, without a change request.
        {held ? ' Only actions held by the two-person rule wait here.' : ''}{' '}
        <Link href={`${dangerHref}#${CHANGE_CONTROL_ANCHOR}`} className="text-accent hover:underline">
          Turn it on in Danger zone › Change control
        </Link>
      </span>
    </p>
  );
}
