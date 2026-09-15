'use client'

/**
 * Asking to join a net you were given a code for.
 *
 * Three steps, and the middle one carries the weight. After submitting, the
 * person is shown a fingerprint and told to read it to the host. That is what
 * stops a code leaked into a group chat from becoming access — the host is
 * verifying a person, not a string.
 *
 * Controlled rather than self-contained. The request and its claim secret live
 * in the page, because this component unmounts every time someone switches to
 * the Host tab, and losing the claim secret there means the request can never
 * be redeemed. That is exactly the case of a host joining their own net: ask
 * here, approve there, come back — which used to be impossible.
 *
 * The claim secret is never persisted. localStorage would survive a refresh,
 * and would also survive anyone else who opens that browser.
 */
import { useState } from 'react'
import clsx from 'clsx'
import type { Theme } from '@/lib/types'
import type { ClaimResult, JoinSubmitted } from '@/lib/floaknet-types'
import { ui } from '@/lib/theme'

export interface JoinNetProps {
  theme: Theme
  /** The in-flight request, held by the page so it outlives this component. */
  session: JoinSubmitted | null
  /** Latest poll result for that request. */
  status: ClaimResult | null
  /** Seconds until the request expires. */
  remaining: number
  busy: boolean
  error: string | null
  /** True when this browser is signed in, so it might be the host approving. */
  canHost: boolean
  onSubmit: (code: string, name: string) => void
  onWithdraw: () => void
  onGoToHost: () => void
}

function Step({ n, label, state, theme }: {
  n: number; label: string; state: 'done' | 'current' | 'todo'; theme: Theme
}) {
  const t = ui(theme)
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={clsx(
          'flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-semibold',
          state === 'current' ? 'bg-signal text-ink-900'
            : state === 'done' ? 'bg-emerald-400 text-ink-900'
            : theme === 'dark' ? 'bg-ink-800 text-ink-400' : 'bg-ink-100 text-ink-400',
        )}
      >
        {state === 'done' ? '✓' : n}
      </span>
      <span className={clsx('text-[11px]', state === 'todo' ? t.faint : t.text)}>{label}</span>
    </div>
  )
}

export default function JoinNet({
  theme, session, status, remaining, busy, error, canHost,
  onSubmit, onWithdraw, onGoToHost,
}: JoinNetProps) {
  const t = ui(theme)
  const dark = theme === 'dark'
  const [code, setCode] = useState('')
  const [name, setName] = useState('')

  const decided = status && status.status !== 'pending' && status.status !== 'approved'
  const step = decided ? 3 : session ? 2 : 1

  const input = clsx(
    'w-full rounded-lg border px-3 py-2.5 text-[14px] outline-none transition-colors',
    t.base, t.text,
    dark ? 'border-ink-700 placeholder:text-ink-500 focus:border-signal'
         : 'border-ink-100 placeholder:text-ink-300 focus:border-signal',
  )
  const primary =
    'w-full rounded-lg bg-signal px-3 py-2.5 text-[14px] font-semibold text-ink-900 ' +
    'transition-opacity hover:opacity-90 disabled:opacity-40'
  const secondary = clsx(
    'w-full rounded-lg border px-3 py-2.5 text-[13px] font-medium transition-colors',
    t.border, t.muted, t.hover,
  )

  return (
    <div className="px-4 py-4">
      <div className="mb-4 flex items-center gap-3">
        <Step n={1} label="Code"    theme={theme} state={step > 1 ? 'done' : 'current'} />
        <span className={clsx('h-px flex-1', dark ? 'bg-ink-700' : 'bg-ink-100')} />
        <Step n={2} label="Verify"  theme={theme}
              state={step > 2 ? 'done' : step === 2 ? 'current' : 'todo'} />
        <span className={clsx('h-px flex-1', dark ? 'bg-ink-700' : 'bg-ink-100')} />
        <Step n={3} label="Joined"  theme={theme} state={step === 3 ? 'current' : 'todo'} />
      </div>

      {/* ── Step 3: the host decided, and it was not yes ────────────────── */}
      {decided && (
        <div className={clsx('rounded-xl border p-4', t.border, t.base)}>
          <p className="text-[14px] font-semibold">
            {status!.status === 'expired' ? 'That request timed out' : 'Not approved'}
          </p>
          <p className={clsx('mt-1.5 text-[12.5px] leading-relaxed', t.muted)}>
            {status!.note ?? 'The host did not approve this request.'}
          </p>
          <button onClick={onWithdraw} className={clsx(primary, 'mt-4')}>Start over</button>
        </div>
      )}

      {/* ── Step 2: waiting on the host ─────────────────────────────────── */}
      {!decided && session && (
        <>
          <p className={clsx('text-[12.5px] leading-relaxed', t.muted)}>
            Read this back to whoever runs{' '}
            <span className={clsx('font-medium', t.text)}>{session.net_name}</span>. They approve
            the fingerprint, not the name — the name is just what you typed.
          </p>

          <div className={clsx(
            'mt-3 rounded-xl border px-3 py-4 text-center font-mono text-[22px] tracking-[0.18em]',
            t.border, t.base, dark ? 'text-signal-300' : 'text-signal-700',
          )}>
            {session.fingerprint}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400 motion-reduce:animate-none" />
            <span className={clsx('text-[11.5px] tabular-nums', t.muted)}>
              Waiting · expires in {Math.floor(remaining / 60)}:
              {String(remaining % 60).padStart(2, '0')}
            </span>
          </div>

          {/* The host approving their own request is a normal thing to do when
              setting up, and the approve button is on the other tab. Without
              this, the flow looks broken rather than two-sided. */}
          {canHost && (
            <button
              onClick={onGoToHost}
              className={clsx('mt-4 flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-3 text-left',
                              'border-signal/40 bg-signal/10')}
            >
              <span className="mt-[1px] text-signal">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h13M13 6l6 6-6 6" />
                </svg>
              </span>
              <span>
                <span className="block text-[12.5px] font-semibold">Approve it in Host</span>
                <span className={clsx('mt-0.5 block text-[11px] leading-snug', t.faint)}>
                  Running this net yourself? The request is sitting in your queue.
                  This stays open while you switch.
                </span>
              </span>
            </button>
          )}

          <button onClick={onWithdraw} className={clsx(secondary, 'mt-2')}>Cancel request</button>
        </>
      )}

      {/* ── Step 1: the code ────────────────────────────────────────────── */}
      {!decided && !session && (
        <>
          <p className={clsx('text-[12.5px] leading-relaxed', t.muted)}>
            Enter the code you were given. Nobody sees you, and you see nobody,
            until the host approves.
          </p>

          <label className={clsx('mt-4 mb-1.5 block text-[11px] font-medium', t.faint)}>
            Join code
          </label>
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCDE-12345"
            className={clsx(input, 'text-center font-mono tracking-[0.16em]')}
          />

          <label className={clsx('mt-3 mb-1.5 block text-[11px] font-medium', t.faint)}>
            Your name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && code && name.trim() && onSubmit(code, name.trim())}
            placeholder="How the host will see you"
            className={input}
          />

          {error && <p className="mt-2 text-[12px] text-signal">{error}</p>}

          <button
            onClick={() => onSubmit(code, name.trim())}
            disabled={busy || !code || !name.trim()}
            className={clsx(primary, 'mt-4')}
          >
            {busy ? 'Sending…' : 'Ask to join'}
          </button>

          {canHost && (
            <p className={clsx('mt-3 text-[11px] leading-relaxed', t.faint)}>
              Testing your own net? Create it under Host, copy the code, paste it
              here — then approve yourself from the Host tab.
            </p>
          )}
        </>
      )}
    </div>
  )
}