'use client';

import { useEffect, useState } from 'react';

import { API_BASE } from '@/lib/api/client';

type Item = { id: string; flow: string; configured: boolean };

/** Starts a subscription login. Device-code providers show a user code to enter in the browser. */
export function OAuthCard() {
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<{ id: string; device?: string; url?: string } | null>(null);

  useEffect(() => {
    void fetch(`${API_BASE}/oauth/catalog`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { providers?: Item[] } | null) => setItems(body?.providers ?? []))
      .catch(() => undefined);
  }, []);

  async function start(id: string) {
    setNote('');
    const res = await fetch(`/oauth/${id}/start`, { method: 'POST', credentials: 'same-origin' });
    const body = (await res.json().catch(() => null)) as {
      authorization_url?: string;
      user_code?: string;
      verification_uri?: string;
      device_code?: string;
      state?: string;
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      setNote(body?.error?.message ?? 'Could not start sign-in.');
      return;
    }
    if (body?.verification_uri) {
      setPending({ id, device: body.device_code, url: body.verification_uri });
      setNote(`Open ${body.verification_uri} and enter ${body.user_code ?? ''}.`);
      return;
    }
    if (body?.authorization_url) {
      setPending({ id, device: body.state, url: body.authorization_url });
      setNote(body.authorization_url);
    }
  }

  async function poll() {
    if (!pending) return;
    const res = await fetch(`/oauth/${pending.id}/poll`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: pending.device, state: pending.device }),
    });
    const body = (await res.json().catch(() => null)) as { pending?: string; ok?: boolean; error?: { message?: string } } | null;
    if (body?.ok) {
      setNote(`${pending.id} is connected.`);
      setPending(null);
      return;
    }
    setNote(body?.pending ? 'Still waiting for the browser.' : (body?.error?.message ?? 'Not finished yet.'));
  }

  if (items.length === 0) return null;
  return (
    <section className="mb-4 rounded-control border border-line px-3 py-3">
      <h2 className="text-ui font-semibold text-fg">Subscription sign-in</h2>
      <p className="mt-1 text-caption text-muted">
        Claude, Codex, GitHub, Copilot, Gemini, Antigravity, Kiro, Cursor, and Cline. A provider with no client id set needs the matching WOWROUTER_OAUTH_*_CLIENT_ID.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <button key={item.id} type="button" className="rounded-sm border border-line px-2 py-1 text-ui" onClick={() => void start(item.id)}>
            {item.id}
          </button>
        ))}
        {pending ? (
          <button type="button" className="rounded-sm bg-accent px-2 py-1 text-ui text-canvas" onClick={() => void poll()}>
            Check {pending.id}
          </button>
        ) : null}
      </div>
      {note ? <p className="mt-2 text-caption text-muted">{note}</p> : null}
    </section>
  );
}
