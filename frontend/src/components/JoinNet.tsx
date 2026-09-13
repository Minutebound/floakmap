'use client'

/**
 * The other side: asking to join a net you were given a code for.
 *
 * Three states, and the middle one carries the weight. After submitting, the
 * person is shown a fingerprint and told to read it to the host. That step is
 * what stops a code that leaked into a group chat from becoming access — the
 * host is verifying a person, not a string.
 *
 * The claim secret is held in component state only. Putting it in localStorage
 * would survive a refresh, and would also survive anyone else who opens that
 * browser.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { Theme } from '@/lib/types'
import type { ClaimResult, JoinSubmitted } from '@/lib/floaknet-types'
import { joinApi } from '@/lib/floaknet-api'

const POLL_MS = 3000

interface JoinNetProps {
  theme: Theme
  onJoined: (result: ClaimResult) => void
  onCancel: () => void
}

export default function JoinNet({ theme, onJoined, onCancel }: JoinNetProps) {
  const dark = theme === 'dark'

  const [code, setCode]       = useState('')
  const [name, setName]       = useState('')
  const [pending, setPending] = useState<JoinSubmitted | null>(null)
  const [status, setStatus]   = useState<ClaimResult | null>(null)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [remaining, setRemaining] = useState<number>(0)
  const pendingRef = useRef<JoinSubmitted | null>(null)
  pendingRef.current = pending

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      setPending(await joinApi.ask(code, name.trim()))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that request')
    } finally { setBusy(false) }
  }

  // Poll for the host's decision.
  useEffect(() => {
    if (!pending) return
    let stop = false

    const tick = async () => {
      try {
        const result = await joinApi.check(pending.request_id, pending.claim_secret)
        if (stop) return
        setStatus(result)
        if (result.status === 'approved') onJoined(result)
      } catch {
        /* transient; keep polling until the request expires */
      }
    }

    tick()
    const poll = setInterval(tick, POLL_MS)
    const clock = setInterval(() => {
      setRemaining(Math.max(0,
        Math.round((new Date(pending.expires_at).getTime() - Date.now()) / 1000)))
    }, 1000)

    return () => { stop = true; clearInterval(poll); clearInterval(clock) }
  }, [pending, onJoined])

  const cancel = useCallback(async () => {
    const p = pendingRef.current
    if (p) await joinApi.withdraw(p.request_id, p.claim_secret).catch(() => {})
    onCancel()
  }, [onCancel])

  const card = clsx(
    'w-[340px] rounded-xl border p-5 shadow-lg',
    dark ? 'bg-[#0f1525] border-[#252d42] text-slate-200'
         : 'bg-white border-stone-200 text-zinc-700',
  )
  const input = clsx(
    'w-full rounded-lg border px-3 py-2 text-[14px] outline-none transition-colors',
    dark ? 'border-[#252d42] bg-[#161b2e] text-slate-200 placeholder:text-slate-500 focus:border-sky-500'
         : 'border-stone-200 bg-stone-50 text-zinc-700 placeholder:text-zinc-400 focus:border-blue-500',
  )
  const primary = clsx(
    'w-full rounded-lg px-3 py-2 text-[14px] font-medium transition-colors disabled:opacity-40',
    dark ? 'bg-sky-500 text-white hover:bg-sky-400' : 'bg-blue-600 text-white hover:bg-blue-500',
  )
  const muted = dark ? 'text-slate-400' : 'text-zinc-500'

  // ── Decided ─────────────────────────────────────────────────────────────
  if (status && status.status !== 'pending' && status.status !== 'approved') {
    return (
      <div className={card}>
        <p className="text-[15px] font-semibold">
          {status.status === 'expired' ? 'That request timed out' : 'Not approved'}
        </p>
        <p className={clsx('mt-1 text-[13px] leading-relaxed', muted)}>
          {status.note ?? 'The host did not approve this request.'}
        </p>
        <button onClick={onCancel} className={clsx(primary, 'mt-4')}>Close</button>
      </div>
    )
  }

  // ── Waiting ─────────────────────────────────────────────────────────────
  if (pending) {
    return (
      <div className={card}>
        <p className="text-[15px] font-semibold">Waiting for the host</p>
        <p className={clsx('mt-1 text-[13px] leading-relaxed', muted)}>
          Read this to whoever runs <span className="font-medium">{pending.net_name}</span> so
          they know the request is yours.
        </p>

        <div className={clsx(
          'mt-4 rounded-lg border px-3 py-3 text-center font-mono text-[20px] tracking-[0.18em]',
          dark ? 'border-[#252d42] bg-[#161b2e] text-sky-300'
               : 'border-stone-200 bg-stone-50 text-blue-700',
        )}>
          {pending.fingerprint}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
          <span className={clsx('text-[12px]', muted)}>
            Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
          </span>
        </div>

        <button
          onClick={cancel}
          className={clsx(
            'mt-4 w-full rounded-lg border px-3 py-2 text-[14px] transition-colors',
            dark ? 'border-[#252d42] hover:bg-[#161b2e]' : 'border-stone-200 hover:bg-stone-50',
          )}
        >
          Cancel request
        </button>
      </div>
    )
  }

  // ── Asking ──────────────────────────────────────────────────────────────
  return (
    <div className={card}>
      <p className="text-[15px] font-semibold">Join a net</p>
      <p className={clsx('mt-1 text-[13px] leading-relaxed', muted)}>
        Enter the code you were given. The host approves before you can see
        anyone, or anyone can see you.
      </p>

      <input
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="ABCDE-12345"
        className={clsx(input, 'mt-4 text-center font-mono tracking-[0.16em]')}
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && code && name.trim() && submit()}
        placeholder="Your name"
        className={clsx(input, 'mt-2')}
      />

      {error && <p className="mt-2 text-[12px] text-rose-500">{error}</p>}

      <button
        onClick={submit}
        disabled={busy || !code || !name.trim()}
        className={clsx(primary, 'mt-3')}
      >
        {busy ? 'Sending' : 'Ask to join'}
      </button>
      <button onClick={onCancel} className={clsx('mt-2 w-full text-[12px] underline-offset-2 hover:underline', muted)}>
        Cancel
      </button>
    </div>
  )
}
