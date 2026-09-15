'use client'

/**
 * Right rail.
 *
 * The host view used
 * to be a separate `NetPanel.tsx`, one letter away from this file's name and
 * meaning something different — the host's net, not the rail that contains it.
 * It is a local component now, so the confusable pair cannot exist.
 *
 * Exports exactly two things: the panel and its tab union. The segmented
 * control and the icons used to live here too, which made this file something
 * every other module imported from — and an editor completing `NetworkPanel`
 * inside this very file would happily add `import NetworkPanel from
 * './NetworkPanel'` alongside the local declaration, which is the conflict
 * TS2440 reports. They live in Sidebar.tsx now, with the other shared atoms.
 *
 *
 * Host and Join are two halves of one idea, so they live under one heading
 * rather than as a panel plus a modal. Joining used to interrupt the map with
 * an overlay; as a sub-section it sits beside the map, which matters because
 * the join flow asks you to read a fingerprint aloud to someone and that can
 * take a minute.
 *
 * The sub-tabs are a segmented control, not links: both states are visible at
 * once so it is obvious the other half exists.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { Theme } from '@/lib/types'
import type { FloakNet, NetMember, PendingRequest } from '@/lib/floaknet-types'
import { netApi } from '@/lib/floaknet-api'
import { ui } from '@/lib/theme'
import { Tabs, IconHost, IconJoin, IconLive } from './Sidebar'
import JoinNet from './JoinNet'
import type { JoinNetProps } from './JoinNet'
import NearbyPanel from './LivePanel'
import type { NearbyPanelProps } from './LivePanel'

export type NetworkTab = 'live' | 'host' | 'join'

interface NetworkPanelProps {
  theme: Theme
  token: string | null
  subjectId: string
  tab?: NetworkTab
  onTabChange: (tab: NetworkTab) => void
  onClose: () => void
  /** Everything the Live tab needs; passed straight through. */
  nearby: NearbyPanelProps
  /** Pending join requests, surfaced as a count on the Host tab. */
  pending?: number
  /** Everything the Join tab needs. Owned by the page so it survives a tab
   *  switch — see the note at the top of JoinNet. */
  join: Omit<JoinNetProps, 'theme' | 'onGoToHost'>
}

const TABS = [
  { id: 'live' as const, label: 'Live', icon: IconLive,
    hint: 'What is happening around you right now' },
  { id: 'host' as const, label: 'Host', icon: IconHost,
    hint: 'Create a net and approve who joins' },
  { id: 'join' as const, label: 'Join', icon: IconJoin,
    hint: 'Enter the code someone shared with you' },
]

export default function NetworkPanel({
  theme, token, subjectId, tab, onTabChange, onClose, nearby, join, pending = 0,
}: NetworkPanelProps) {
  const t = ui(theme)
  const dark = theme === 'dark'
  // Fall back rather than assert: an unrecognised tab should show Live, not
  // take the panel down.
  const active = TABS.find((x) => x.id === tab) ?? TABS[0]

  // Counts go in the tabs because they are the reason to switch. How many
  // places are around you, and how many people are waiting on you, are both
  // worth knowing before you pick.
  const items = TABS.map((x) =>
    x.id === 'live' ? { ...x, count: nearby.results.length }
    : x.id === 'host' ? { ...x, count: pending, dot: pending > 0 }
    : x)

  return (
    <section
      className={clsx(
        // Full width inside a bottom sheet on small screens, a fixed column on
        // desktop. min-h-0 lets the scroll region below actually scroll.
        'flex min-h-0 w-full flex-1 flex-col lg:h-full lg:w-[320px] lg:flex-none lg:border-l',
        t.panel, t.border, t.text,
      )}
      aria-label="Activity and network"
    >
      <header className={clsx('px-4 pb-3 pt-3 border-b lg:pt-3.5', t.border)}>
        <div className="flex items-center gap-2 mb-2.5">
          <h2 className="flex-1 text-[15px] font-semibold tracking-tight lg:text-sm">
            {active.label === 'Live' ? 'Nearby' : 'Network'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close network panel"
            className={clsx('w-7 h-7 rounded-md flex items-center justify-center transition-colors', t.hover, t.muted)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <Tabs
          theme={theme}
          items={items}
          value={tab}
          onChange={onTabChange}
          ariaLabel="Sections"
          // Left unstretched: full-bleed on a tablet sheet, three segments
          // would spread across 800px and stop reading as one control.
          className="max-w-md"
        />
        <p className={clsx('mt-2 text-[11.5px] leading-snug', t.faint)}>{active.hint}</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {active.id === 'live' && <NearbyPanel {...nearby} />}

        {active.id === 'host' && (token
          ? <HostView theme={theme} token={token} subjectId={subjectId} />
          : <Empty theme={theme}
                   title="Not signed in"
                   body="Hosting a net needs an account. Sign in to create one, name it, and share the code it gives you." />)}

        {active.id === 'join' && (
          <JoinNet theme={theme} {...join} onGoToHost={() => onTabChange('host')} />
        )}
      </div>
    </section>
  )
}

function Empty({ theme, title, body }: { theme: Theme; title: string; body: string }) {
  const t = ui(theme)
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-[13px] font-medium">{title}</p>
      <p className={clsx('mt-1.5 text-[11.5px] leading-relaxed', t.faint)}>{body}</p>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */

const POLL_MS = 5000

interface HostViewProps {
  theme: Theme
  token: string
  subjectId: string
}

/**
 * The host's half of a net: the join code, the pending queue, the roster.
 *
 * The queue is the interesting part. Approving someone is the moment the whole
 * security model rests on, so the fingerprint is the largest thing on the card
 * and the display name is secondary — the name is whatever the requester
 * typed, while the fingerprint is derived from a secret only they hold. The
 * copy says so out loud, because a host who does not know to check will
 * approve anyone with a plausible name.
 */
function HostView({ theme, token, subjectId }: HostViewProps) {
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
      ? 'border-[#222c37] bg-[#151c24] text-ink-100 placeholder:text-ink-400 focus:border-signal'
      : 'border-ink-100 bg-ink-50 text-ink-700 placeholder:text-ink-300 focus:border-signal',
  )
  const primary = clsx(
    'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40',
    dark ? 'bg-signal text-white hover:bg-signal-400' : 'bg-signal-600 text-white hover:bg-signal',
  )

  return (
    <div className="flex w-full flex-col">
      {queue.length > 0 && (
        <div className={clsx('border-b px-4 py-2', dark ? 'border-ink-700' : 'border-ink-100')}>
          <span className="rounded-full bg-signal px-1.5 py-[1px] text-[10px] font-semibold text-ink-900">
            {queue.length} waiting
          </span>
        </div>
      )}

      <div>
        {/* ── Net picker / create ──────────────────────────────────────── */}
        <div className={clsx('border-b px-4 py-3', dark ? 'border-ink-700' : 'border-ink-100')}>
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
          {error && <p className="mt-2 text-[11px] text-signal">{error}</p>}
        </div>

        {/* ── Join code ────────────────────────────────────────────────── */}
        {net && isHost && (
          <div className={clsx('border-b px-4 py-3', dark ? 'border-ink-700' : 'border-ink-100')}>
            <p className={clsx('text-[11px]', dark ? 'text-ink-300' : 'text-ink-400')}>
              Share this code. It only lets someone ask to join — you still
              approve every request.
            </p>
            {code ? (
              <button
                onClick={copyCode}
                className={clsx(
                  'mt-2 w-full rounded-lg border px-3 py-2 text-center font-mono text-[17px] tracking-[0.18em] transition-colors',
                  dark ? 'border-[#222c37] bg-[#151c24] hover:border-signal'
                       : 'border-ink-100 bg-ink-50 hover:border-signal',
                )}
              >
                {copied ? 'Copied' : code}
              </button>
            ) : (
              <p className={clsx('mt-2 text-[11px]', dark ? 'text-ink-400' : 'text-ink-300')}>
                The code is stored hashed, so it can’t be shown again. Rotate to
                get a new one.
              </p>
            )}
            <button
              onClick={rotate}
              disabled={busy}
              className={clsx('mt-2 text-[11px] underline-offset-2 hover:underline',
                dark ? 'text-ink-300' : 'text-ink-400')}
            >
              Rotate code
            </button>
          </div>
        )}

        {/* ── Pending requests ─────────────────────────────────────────── */}
        {isHost && queue.length > 0 && (
          <div className={clsx('border-b', dark ? 'border-ink-700' : 'border-ink-100')}>
            <p className={clsx('px-4 pt-3 text-[11px] leading-relaxed',
              dark ? 'text-ink-300' : 'text-ink-400')}>
              Ask them to read their fingerprint aloud and check it matches
              before you approve. The name is whatever they typed.
            </p>
            {queue.map((r) => (
              <div key={r.id} className="px-4 py-3">
                <div className={clsx(
                  'rounded-lg border px-3 py-2 text-center font-mono text-[15px] tracking-[0.16em]',
                  dark ? 'border-[#222c37] bg-[#151c24] text-signal-300'
                       : 'border-ink-100 bg-ink-50 text-signal-700',
                )}>
                  {r.fingerprint}
                </div>
                <p className="mt-2 text-[12.5px]">
                  <span className={dark ? 'text-ink-300' : 'text-ink-400'}>says they are </span>
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
                      dark ? 'border-[#222c37] hover:bg-[#151c24]'
                           : 'border-ink-100 hover:bg-ink-50',
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
                    dark ? 'bg-[#222c37] text-slate-300' : 'bg-ink-100 text-ink-400')}>
                    host
                  </span>
                )}
                {isHost && m.role !== 'host' && (
                  <button
                    onClick={() => active && netApi.revoke(token, active, m.subject_id)
                      .then(() => netApi.members(token, active).then(setMembers))
                      .catch(() => setError('Could not remove them'))}
                    className={clsx('ml-auto text-[11px] underline-offset-2 hover:underline',
                      dark ? 'text-ink-400 hover:text-rose-400' : 'text-ink-300 hover:text-signal-700')}
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
            dark ? 'text-ink-400' : 'text-ink-300')}>
            A net is a private group that shares location. Name one above, then
            send people the code.
          </p>
        )}
      </div>
    </div>
  )
}