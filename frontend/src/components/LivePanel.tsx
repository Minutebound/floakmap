'use client'

/**
 * Roster and alert feed. Styled to match Sidebar.tsx — same theme prop, same
 * clsx pattern, same navy/stone palette.
 *
 * Design note: the thing an operator actually distrusts about a tracking map
 * is freshness — not where the dot is, but whether the dot is still true. So
 * each row carries a bar that drains as the fix ages, rather than a
 * green/grey badge that only flips once it is already too late. You can see a
 * vehicle going quiet before it has gone quiet.
 */
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { Theme } from '@/lib/types'
import type { Alert, ConnectionState, LiveState } from '@/lib/live-types'
import { KIND_COLOR } from '@/lib/live-types'

const STALE_AFTER_S = 180

interface LivePanelProps {
  theme: Theme
  subjects: LiveState[]
  alerts: Alert[]
  connection: ConnectionState
  following: string | null
  unreadCount: number
  onFollow: (id: string | null) => void
  onAcknowledge: (id: string) => void
  onClose?: () => void
}

const CONNECTION_COPY: Record<ConnectionState, string> = {
  connecting: 'Connecting',
  live:       'Live',
  retrying:   'Reconnecting',
  closed:     'Offline',
}

function useClock(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function ago(seconds: number): string {
  if (seconds < 5)    return 'just now'
  if (seconds < 60)   return `${Math.floor(seconds)}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

export default function LivePanel({
  theme, subjects, alerts, connection, following, unreadCount,
  onFollow, onAcknowledge, onClose,
}: LivePanelProps) {
  const [tab, setTab]       = useState<'roster' | 'alerts'>('roster')
  const [search, setSearch] = useState('')
  const now  = useClock()
  const dark = theme === 'dark'

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? subjects.filter((s) => s.label.toLowerCase().includes(q)) : subjects
  }, [subjects, search])

  const moving = subjects.filter((s) => (s.speed_kmh ?? 0) > 5).length

  return (
    <aside
      className={clsx(
        'flex h-full w-[272px] flex-shrink-0 flex-col border-l',
        dark
          ? 'bg-[#0f1525] border-[#252d42] text-slate-200'
          : 'bg-white border-stone-200 text-zinc-700',
      )}
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header
        className={clsx(
          'flex items-center gap-2 border-b px-4 py-3',
          dark ? 'border-[#252d42]' : 'border-stone-200',
        )}
      >
        <span
          className={clsx(
            'h-2 w-2 flex-shrink-0 rounded-full',
            connection === 'live'       && 'bg-emerald-400',
            connection === 'retrying'   && 'animate-pulse bg-amber-400',
            connection === 'connecting' && 'animate-pulse bg-sky-400',
            connection === 'closed'     && 'bg-zinc-400',
          )}
        />
        <span className="text-[13px] font-semibold">{CONNECTION_COPY[connection]}</span>
        <span className={clsx('ml-auto text-[11px] tabular-nums', dark ? 'text-slate-400' : 'text-zinc-400')}>
          {moving} moving · {subjects.length} tracked
        </span>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Hide live panel"
            className={clsx(
              'ml-1 flex h-5 w-5 items-center justify-center rounded text-sm',
              dark ? 'hover:bg-[#252d42]' : 'hover:bg-stone-100',
            )}
          >
            ×
          </button>
        )}
      </header>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <nav className={clsx('flex border-b text-[13px]', dark ? 'border-[#252d42]' : 'border-stone-200')}>
        {(['roster', 'alerts'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              'flex-1 px-3 py-2 transition-colors',
              tab === key
                ? dark
                  ? 'border-b-2 border-sky-400 font-medium text-slate-100'
                  : 'border-b-2 border-blue-600 font-medium text-zinc-900'
                : dark
                  ? 'text-slate-400 hover:text-slate-200'
                  : 'text-zinc-400 hover:text-zinc-700',
            )}
          >
            {key === 'roster' ? 'Who’s out' : 'Attention'}
            {key === 'alerts' && unreadCount > 0 && (
              <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 py-[1px] text-[10px] font-semibold text-white">
                {unreadCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* ── Roster ───────────────────────────────────────────────────────── */}
      {tab === 'roster' ? (
        <>
          <div className="px-3 py-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a vehicle or person"
              className={clsx(
                'w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none transition-colors',
                dark
                  ? 'border-[#252d42] bg-[#161b2e] text-slate-200 placeholder:text-slate-500 focus:border-sky-500'
                  : 'border-stone-200 bg-stone-50 text-zinc-700 placeholder:text-zinc-400 focus:border-blue-500',
              )}
            />
          </div>

          <ul className="flex-1 overflow-y-auto pb-2">
            {filtered.length === 0 && (
              <li className={clsx('px-4 py-10 text-center text-[12px] leading-relaxed', dark ? 'text-slate-500' : 'text-zinc-400')}>
                {subjects.length === 0
                  ? 'Nothing is reporting yet. Run the simulator, or post a fix to /api/v1/ingest/positions.'
                  : 'No match for that name.'}
              </li>
            )}

            {filtered.map((s) => {
              const age       = (now - new Date(s.recorded_at).getTime()) / 1000
              const freshness = Math.max(0, 1 - age / STALE_AFTER_S)
              const color     = s.color ?? KIND_COLOR[s.kind]
              const active    = following === s.subject_id

              return (
                <li key={s.subject_id}>
                  <button
                    onClick={() => onFollow(active ? null : s.subject_id)}
                    className={clsx(
                      'w-full px-3.5 py-2.5 text-left transition-colors',
                      active
                        ? dark ? 'bg-[#1c2338]' : 'bg-stone-100'
                        : dark ? 'hover:bg-[#161b2e]' : 'hover:bg-stone-50',
                    )}
                  >
                    <div className="flex items-baseline gap-2">
                      <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ background: color, opacity: s.stale ? 0.4 : 1 }}
                      />
                      <span className="truncate text-[13px] font-medium">{s.label}</span>
                      <span className={clsx('ml-auto flex-shrink-0 text-[11px] tabular-nums', dark ? 'text-slate-400' : 'text-zinc-400')}>
                        {s.share_mode === 'approximate'
                          ? 'nearby'
                          : (s.speed_kmh ?? 0) > 5
                            ? `${Math.round(s.speed_kmh!)} km/h`
                            : 'stopped'}
                      </span>
                    </div>

                    <div className="mt-1.5 flex items-center gap-2 pl-[18px]">
                      <span className={clsx('h-[3px] flex-1 overflow-hidden rounded-full', dark ? 'bg-[#252d42]' : 'bg-stone-200')}>
                        <span
                          className="block h-full rounded-full transition-[width] duration-1000 ease-linear"
                          style={{
                            width: `${freshness * 100}%`,
                            background: freshness > 0.3 ? color : '#f59e0b',
                          }}
                        />
                      </span>
                      <span className={clsx('flex-shrink-0 text-[10.5px] tabular-nums', dark ? 'text-slate-500' : 'text-zinc-400')}>
                        {ago(age)}
                      </span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        /* ── Alerts ─────────────────────────────────────────────────────── */
        <ul className="flex-1 overflow-y-auto">
          {alerts.length === 0 && (
            <li className={clsx('px-4 py-10 text-center text-[12px] leading-relaxed', dark ? 'text-slate-500' : 'text-zinc-400')}>
              Nothing needs attention. Speeding, idling, lost signal and zone
              crossings land here.
            </li>
          )}

          {alerts.map((a) => (
            <li
              key={a.id}
              className={clsx(
                'border-b px-3.5 py-3',
                dark ? 'border-[#1c2338]' : 'border-stone-100',
                a.acknowledged_by && 'opacity-45',
              )}
            >
              <div className="flex items-start gap-2">
                <span
                  className="mt-[6px] h-1.5 w-1.5 flex-shrink-0 rounded-full"
                  style={{
                    background:
                      a.severity === 'critical' ? '#e11d48'
                        : a.severity === 'warning' ? '#f59e0b'
                          : '#64748b',
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] leading-snug">{a.message}</p>
                  <div className="mt-1 flex items-center gap-3">
                    <span className={clsx('text-[10.5px] tabular-nums', dark ? 'text-slate-500' : 'text-zinc-400')}>
                      {ago((now - new Date(a.raised_at).getTime()) / 1000)}
                    </span>
                    <button
                      onClick={() => onFollow(a.subject_id)}
                      className={clsx('text-[10.5px] underline-offset-2 hover:underline', dark ? 'text-slate-400' : 'text-zinc-500')}
                    >
                      Show on map
                    </button>
                    {!a.acknowledged_by && (
                      <button
                        onClick={() => onAcknowledge(a.id)}
                        className={clsx('text-[10.5px] underline-offset-2 hover:underline', dark ? 'text-slate-400' : 'text-zinc-500')}
                      >
                        Mark handled
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
