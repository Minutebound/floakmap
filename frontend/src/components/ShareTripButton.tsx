'use client';

/**
 * Creates a read-only link to a trip and copies it.
 *
 * The expiry is shown before the link is made, not buried in settings, because
 * "for how long" is the only question that matters when you share your
 * location and the answer should never be "until you remember to stop".
 */
import { useState } from 'react';

interface Props {
  apiBase: string;
  token: string;
  tripId: string;
}

const CHOICES = [1, 4, 8, 24];

export default function ShareTripButton({ apiBase, token, tripId }: Props) {
  const [hours, setHours] = useState(4);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch(
        `${apiBase}/api/v1/trips/${tripId}/share-link?hours=${hours}`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      );
      const body = await res.json();
      const url = `${window.location.origin}${body.url}`;
      setLink(url);
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        Share this trip
      </p>
      <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
        Anyone with the link can watch until it expires. No account needed.
      </p>
      <div className="mt-2.5 flex gap-1">
        {CHOICES.map((h) => (
          <button
            key={h}
            onClick={() => setHours(h)}
            className={`flex-1 rounded-md border px-2 py-1 text-xs tabular-nums transition-colors ${
              hours === h
                ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                : 'border-neutral-200 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300'
            }`}
          >
            {h}h
          </button>
        ))}
      </div>
      <button
        onClick={create}
        disabled={busy}
        className="mt-2.5 w-full rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {copied ? 'Link copied' : busy ? 'Creating' : `Create a ${hours}-hour link`}
      </button>
      {link && (
        <p className="mt-2 truncate text-[11px] text-neutral-400">{link}</p>
      )}
    </div>
  );
}
