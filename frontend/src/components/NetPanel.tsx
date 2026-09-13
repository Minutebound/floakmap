'use client'

/**
 * The host's view of a FloakNet: the join code, the pending queue, the roster.
 *
 * The queue is the interesting part. Approving someone is the moment the whole
 * security model rests on, so the fingerprint is the largest thing on the card
 * and the display name is secondary — the name is whatever the requester typed,
 * while the fingerprint is derived from a secret only they hold. The copy says
 * so out loud, because a host who does not know to check will approve anyone
 * with a plausible name.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { Theme } from '@/lib/types'
import type { FloakNet, NetMember, PendingRequest } from '@/lib/floaknet-types'
import { netApi } from '@/lib/floaknet-api'

const POLL_MS = 5000

interface NetPanelProps {
  theme: Theme
  token: string
  subjectId: string
  onClose?: () => void
}

export default function NetPanel({ theme, token, subjectId, onClose }: NetPanelProps) {
  const dark = theme === 'dark'

  const [nets, setNets]         = useState<FloakNet[]>([])
  const [active, setActive]     = useState<string | null>(null)
  const [queue, setQueue]       = useState<PendingRequest[]>([])
  const [members, setMembers]   = useState<NetMember[]>([])
  const [code, setCode]         = useState<string | null>(null)
  const [newName, setNewName]   = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [copied, setCopied]     = useState(false)
  const activeRef = useRef<string | null>(null)
  activeRef.current = active

  const net    = nets.find((n) => n.id === active) ?? null
  const isHost = net?.host_subject_id === subjectId

  const loadNets = useCallback(async () => {
    try {
      const mine = await netApi.mine(token)
      setNets(mine)
      if (!activeRef.current && mine.length) setActive(mine[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your nets')
    }
  }, [token])

  useEffect(() => { loadNets() }, [loadNets])

  // Poll the queue while a net is open. A websocket would be tidier, but
  // approvals are rare and a five-second poll costs one small request.
  useEffect(() => {
    if (!active) return
    let stop = false

    const tick = async () => {
      try {
        const [m, q] = await Promise.all([
          netApi.members(token, active),
          netApi.queue(token, active).catch(() => [] as PendingRequest[]),
        ])
        if (!stop) { setMembers(m); setQueue(q) }
      } catch { /* transient; the next tick retries */ }
    }

    tick()
    const id = setInterval(tick, POLL_MS)
    return () => { stop = true; clearInterval(id) }
  }, [token, active])

  const create = async () => {
    if (!newName.trim()) return
    setBusy(true); setError(null)
    try {
      const res = await netApi.create(token, newName.trim())
      setCode(res.join_code)
      setNewName('')
      setActive(res.net.id)
      await loadNets()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the net')
    } finally { setBusy(false) }
  }

  const rotate = async () => {
    if (!active) return
    setBusy(true); setError(null)
    try {
      setCode((await netApi.rotateCode(token, active)).join_code)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rotate the code')
    } finally { setBusy(false) }
  }

  const decide = async (requestId: string, approve: boolean) => {
    if (!active) return
    setQueue((q) => q.filter((r) => r.id !== requestId))   // optimistic
    try {
      approve
        ? await netApi.approve(token, active, requestId)
        : await netApi.deny(token, active, requestId)
      setMembers(await netApi.members(token, active))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not go through')
      setQueue(await netApi.queue(token, active).catch(() => []))
    }
  }

  const copyCode = async () => {
    if (!code) return
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const input = clsx(
    'w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none transition-colors',
    dark
      ? 'border-[#252d42] bg-[#161b2e] text-slate-200 placeholder:text-slate-500 focus:border-sky-500'
      : 'border-stone-200 bg-stone-50 text-zinc-700 placeholder:text-zinc-400 focus:border-blue-500',
  )
  const primary = clsx(
    'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40',
    dark ? 'bg-sky-500 text-white hover:bg-sky-400' : 'bg-blue-600 text-white hover:bg-blue-500',
  )

  return (
    <aside
      className={clsx(
        'flex h-full w-[300px] flex-shrink-0 flex-col border-l',
        dark ? 'bg-[#0f1525] border-[#252d42] text-slate-200'
             : 'bg-white border-stone-200 text-zinc-700',
      )}
    >
      <header className={clsx('flex items-center gap-2 border-b px-4 py-3',
        dark ? 'border-[#252d42]' : 'border-stone-200')}>
        <span className="text-[13px] font-semibold">FloakNet</span>
        {queue.length > 0 && (
          <span className="rounded-full bg-amber-500 px-1.5 py-[1px] text-[10px] font-semibold text-white">
            {queue.length} waiting
          </span>
        )}
        {onClose && (
          <button onClick={onClose} aria-label="Hide nets"
            className={clsx('ml-auto flex h-5 w-5 items-center justify-center rounded text-sm',
              dark ? 'hover:bg-[#252d42]' : 'hover:bg-stone-100')}>×</button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* ── Net picker / create ──────────────────────────────────────── */}
        <div className={clsx('border-b px-4 py-3', dark ? 'border-[#252d42]' : 'border-stone-200')}>
          {nets.length > 0 && (
            <select
              value={active ?? ''}
              onChange={(e) => { setActive(e.target.value); setCode(null) }}
              className={clsx(input, 'mb-2')}
            >
              {nets.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          )}
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              placeholder="Name a new net"
              className={input}
            />
            <button onClick={create} disabled={busy || !newName.trim()} className={primary}>
              Create
            </button>
          </div>
          {error && <p className="mt-2 text-[11px] text-rose-500">{error}</p>}
        </div>

        {/* ── Join code ────────────────────────────────────────────────── */}
        {net && isHost && (
          <div className={clsx('border-b px-4 py-3', dark ? 'border-[#252d42]' : 'border-stone-200')}>
            <p className={clsx('text-[11px]', dark ? 'text-slate-400' : 'text-zinc-500')}>
              Share this code. It only lets someone ask to join — you still
              approve every request.
            </p>
            {code ? (
              <button
                onClick={copyCode}
                className={clsx(
                  'mt-2 w-full rounded-lg border px-3 py-2 text-center font-mono text-[17px] tracking-[0.18em] transition-colors',
                  dark ? 'border-[#252d42] bg-[#161b2e] hover:border-sky-500'
                       : 'border-stone-200 bg-stone-50 hover:border-blue-500',
                )}
              >
                {copied ? 'Copied' : code}
              </button>
            ) : (
              <p className={clsx('mt-2 text-[11px]', dark ? 'text-slate-500' : 'text-zinc-400')}>
                The code is stored hashed, so it can’t be shown again. Rotate to
                get a new one.
              </p>
            )}
            <button
              onClick={rotate}
              disabled={busy}
              className={clsx('mt-2 text-[11px] underline-offset-2 hover:underline',
                dark ? 'text-slate-400' : 'text-zinc-500')}
            >
              Rotate code
            </button>
          </div>
        )}

        {/* ── Pending requests ─────────────────────────────────────────── */}
        {isHost && queue.length > 0 && (
          <div className={clsx('border-b', dark ? 'border-[#252d42]' : 'border-stone-200')}>
            <p className={clsx('px-4 pt-3 text-[11px] leading-relaxed',
              dark ? 'text-slate-400' : 'text-zinc-500')}>
              Ask them to read their fingerprint aloud and check it matches
              before you approve. The name is whatever they typed.
            </p>
            {queue.map((r) => (
              <div key={r.id} className="px-4 py-3">
                <div className={clsx(
                  'rounded-lg border px-3 py-2 text-center font-mono text-[15px] tracking-[0.16em]',
                  dark ? 'border-[#252d42] bg-[#161b2e] text-sky-300'
                       : 'border-stone-200 bg-stone-50 text-blue-700',
                )}>
                  {r.fingerprint}
                </div>
                <p className="mt-2 text-[12.5px]">
                  <span className={dark ? 'text-slate-400' : 'text-zinc-500'}>says they are </span>
                  <span className="font-medium">{r.display_name}</span>
                </p>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => decide(r.id, true)} className={clsx(primary, 'flex-1')}>
                    Approve
                  </button>
                  <button
                    onClick={() => decide(r.id, false)}
                    className={clsx(
                      'flex-1 rounded-lg border px-3 py-1.5 text-[13px] transition-colors',
                      dark ? 'border-[#252d42] hover:bg-[#161b2e]'
                           : 'border-stone-200 hover:bg-stone-50',
                    )}
                  >
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Members ──────────────────────────────────────────────────── */}
        {net && (
          <ul className="py-1">
            {members.map((m) => (
              <li key={m.subject_id} className="flex items-center gap-2 px-4 py-2">
                <span className="truncate text-[13px]">{m.display_name}</span>
                {m.role === 'host' && (
                  <span className={clsx('rounded px-1.5 py-[1px] text-[10px]',
                    dark ? 'bg-[#252d42] text-slate-300' : 'bg-stone-100 text-zinc-500')}>
                    host
                  </span>
                )}
                {isHost && m.role !== 'host' && (
                  <button
                    onClick={() => active && netApi.revoke(token, active, m.subject_id)
                      .then(() => netApi.members(token, active).then(setMembers))
                      .catch(() => setError('Could not remove them'))}
                    className={clsx('ml-auto text-[11px] underline-offset-2 hover:underline',
                      dark ? 'text-slate-500 hover:text-rose-400' : 'text-zinc-400 hover:text-rose-600')}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {nets.length === 0 && (
          <p className={clsx('px-4 py-10 text-center text-[12px] leading-relaxed',
            dark ? 'text-slate-500' : 'text-zinc-400')}>
            A net is a private group that shares location. Name one above, then
            send people the code.
          </p>
        )}
      </div>
    </aside>
  )
}
