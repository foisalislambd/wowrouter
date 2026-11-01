'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { callbackError, type CallbackError } from '@/features/auth/callback-error';

/**
 * A test sign-in that failed comes back to the sign-in settings as `?error=<code>&message=<text>`.
 * The outcome shows here in plain words until dismissed, and the parameters leave the address so a
 * reload or a shared link does not show it again.
 */
export function TestSignInOutcome() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const error = params.get('error');
  const message = params.get('message');
  const found = callbackError(error, message);
  const [outcome, setOutcome] = useState<CallbackError | null>(found);
  // A new failure while the page is open replaces the one shown (state set while rendering).
  const [shown, setShown] = useState(found);
  if (found && JSON.stringify(found) !== JSON.stringify(shown)) {
    setShown(found);
    setOutcome(found);
  }

  useEffect(() => {
    if (error === null && message === null) return;
    const next = new URLSearchParams(window.location.search);
    next.delete('error');
    next.delete('message');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [error, message, pathname, router]);

  if (!outcome) return null;
  return (
    <section className="border-b border-line bg-raised px-5 py-4 max-sm:px-gutter-sm">
      <div
        role="alert"
        className="flex items-start gap-2.5 rounded-control border border-[color-mix(in_oklab,var(--ant-error)_40%,transparent)] bg-[color-mix(in_oklab,var(--ant-error)_8%,transparent)] px-3 py-2.5 text-ui text-fg"
      >
        <span className="mt-px text-error">
          <Icon name="alertCircle" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">The test sign-in failed. {outcome.title}</p>
          <p className="mt-0.5 text-caption text-muted">{outcome.detail}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOutcome(null)}>
          Dismiss
        </Button>
      </div>
    </section>
  );
}
