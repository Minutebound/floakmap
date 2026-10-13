'use client'

/**
 * Left rail, plus the settings surface it opens.
 *
 * Four regions top to bottom: identity, search, layer filter, and a footer
 * holding the signed-in person and the map's attribution. The filter is the
 * only part a dispatcher touches often, so it gets the vertical space and
 * everything else stays out of its way.
 *
 * Settings lives in this file rather than its own because the profile button
 * is its only entry point, and the two share the same tokens and the same
 * idea of what a row looks like.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import Link from 'next/link'
import Logo from '@/components/Logo'
import type { CategoryKey, Theme, FlyTarget, DistanceUnit } from '@/lib/types'
import { LAYER_META, layerColor } from '@/lib/types'
import type { GeoStatus } from '@/hooks/useLiveTracking'
import { ui } from '@/lib/theme'

export const CITIES: Record<string, FlyTarget> = {
  'parker':            { center: [-104.762, 39.51],  zoom: 12.2 },
  'parker, co':        { center: [-104.762, 39.51],  zoom: 12.2 },
  '80134':             { center: [-104.762, 39.51],  zoom: 12.2 },
  'denver':            { center: [-104.990, 39.739], zoom: 11   },
  'denver, co':        { center: [-104.990, 39.739], zoom: 11   },
  'aurora':            { center: [-104.802, 39.729], zoom: 11   },
  'aurora, co':        { center: [-104.802, 39.729], zoom: 11   },
  'boulder':           { center: [-105.270, 40.015], zoom: 12   },
  'colorado springs':  { center: [-104.821, 38.833], zoom: 11   },
  'new york':          { center: [-74.006,  40.713], zoom: 11   },
  'los angeles':       { center: [-118.243, 34.052], zoom: 10   },
  'chicago':           { center: [-87.629,  41.878], zoom: 11   },
  'houston':           { center: [-95.369,  29.760], zoom: 10   },
  'phoenix':           { center: [-112.074, 33.448], zoom: 10   },
  'seattle':           { center: [-122.333, 47.606], zoom: 11   },
  'san francisco':     { center: [-122.419, 37.775], zoom: 12   },
  'miami':             { center: [-80.191,  25.774], zoom: 11   },
}

/* Inline icons. Stroke-only at 15px so they sit on the text baseline weight
   rather than shouting over a two-word label. */

export const IconLive = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
  </svg>
)

export const IconNetwork = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="5" r="2.4" /><circle cx="5" cy="18" r="2.4" /><circle cx="19" cy="18" r="2.4" />
    <path d="M10.4 6.9 6.6 15.6M13.6 6.9l3.8 8.7M7.4 18h9.2" />
  </svg>
)

export const IconHost = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 20a7 7 0 0 1 14 0" /><circle cx="10" cy="7" r="3.4" />
    <path d="M18 8.5v5M20.5 11h-5" />
  </svg>
)

export const IconJoin = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
    <path d="M10 17l5-5-5-5M15 12H3" />
  </svg>
)

export const IconRoster = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" /><circle cx="9" cy="7" r="3.2" />
    <path d="M22 20v-1.5a4 4 0 0 0-3-3.8" /><path d="M16.5 4.1a4 4 0 0 1 0 6.8" />
  </svg>
)

export const IconAlert = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
)

export const IconLayers = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3 3 8l9 5 9-5-9-5zM3 16l9 5 9-5M3 12l9 5 9-5" />
  </svg>
)

export const IconGear = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

/** #rrggbb + an alpha 0–1, as an 8-digit hex. */
export const alpha = (hex: string, a: number): string =>
  hex + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')

/**
 * Category glyph on a tinted tile.
 *
 * A coloured dot makes you read the label to know what a row is. A parking P,
 * a droplet, a bolt and a wrench are recognisable before the eye reaches the
 * text, which is the whole point of putting them there — and the tint keeps
 * the colour coding that the map dots use, so the legend and the map agree.
 *
 * Tile sits at 0.8 opacity: enough presence to identify, not so much that four
 * saturated squares compete with the map for attention.
 */
export function LayerIcon({
  category, theme, size = 30, active = true,
}: {
  category: CategoryKey; theme: Theme; size?: number; active?: boolean
}) {
  const meta = LAYER_META.find((m) => m.key === category)!
  const color = layerColor(category, theme)
  return (
    <span
      aria-hidden
      className="flex flex-shrink-0 items-center justify-center rounded-[9px] border transition-opacity"
      style={{
        width: size,
        height: size,
        backgroundColor: alpha(color, theme === 'dark' ? 0.16 : 0.1),
        borderColor: alpha(color, theme === 'dark' ? 0.42 : 0.3),
        color,
        opacity: active ? 0.8 : 0.3,
      }}
    >
      <svg
        width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
      >
        {meta.iconPaths.map((d) => <path key={d} d={d} />)}
      </svg>
    </span>
  )
}

function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'relative flex-shrink-0 w-9 h-[22px] rounded-full transition-colors duration-200',
        on ? 'bg-signal' : 'bg-ink-200 dark:bg-ink-700',
      )}
    >
      <span
        className="absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 motion-reduce:transition-none"
        style={{ transform: on ? 'translateX(14px)' : 'translateX(0)' }}
      />
    </span>
  )
}

export function initialsOf(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const take = (w: string) => [...w][0] ?? ''
  const letters = parts.length === 1
    ? take(parts[0])
    : take(parts[0]) + take(parts[parts.length - 1])
  return letters.toUpperCase() || '?'
}

interface SidebarProps {
  theme: Theme
  layers: Record<CategoryKey, boolean>
  counts: Record<CategoryKey, number>
  profileName?: string
  onLayerToggle: (key: CategoryKey) => void
  onThemeToggle: () => void
  onFlyTo: (dest: FlyTarget) => void
  onOpenSettings?: () => void
  /** False shows Sign up / Log in; true shows the profile row + Log out.
   *  Settings itself (the gear) is reachable either way — only the Profile
   *  section inside it needs an account. */
  signedIn?: boolean
  onSignOut?: () => void
  /** Only rendered below `lg`, where the rail is a drawer. */
  onClose?: () => void
}

export default function Sidebar({
  theme, layers, counts, profileName = 'Guest',
  onLayerToggle, onThemeToggle, onFlyTo, onOpenSettings, signedIn, onSignOut, onClose,
}: SidebarProps) {
  const t = ui(theme)
  const dark = theme === 'dark'
  const [search, setSearch] = useState('')
  const [notFound, setNotFound] = useState(false)
  const onCount = LAYER_META.filter((m) => layers[m.key]).length

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const hit = CITIES[search.trim().toLowerCase()]
    if (hit) { onFlyTo(hit); setSearch(''); setNotFound(false) }
    else setNotFound(true)
  }

  return (
    <aside
      className={clsx(
        'flex h-full w-full flex-col lg:w-[288px] lg:flex-none lg:border-r',
        t.panel, t.border, t.text,
      )}
    >
      <div className={clsx('border-b px-5 pb-4 pt-5', t.border)}>
        <div className="mb-4 flex items-center gap-2.5">
          <Link href="/" aria-label="FloakMap home" className="flex-shrink-0 rounded-md">
            <Logo tone={dark ? 'light' : 'dark'} size={30} showWordmark={false} />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[19px] font-extrabold leading-tight tracking-[-0.02em]">FloakMap</div>
          </div>
          <button
            onClick={onThemeToggle}
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} 
            className={clsx('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border transition-colors',
                            t.base, t.border, t.muted, t.hover)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {dark ? (
                <>
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </>
              ) : (
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              )}
            </svg>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close menu"
              className={clsx('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border lg:hidden',
                              t.base, t.border, t.muted, t.hover)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className={clsx('flex h-11 items-center gap-2.5 rounded-xl border px-3 transition-colors',
                             t.base, notFound ? 'border-signal' : t.border)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.2" strokeLinecap="round" className={t.faint}>
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setNotFound(false) }}
            onKeyDown={handleSearch}
            placeholder="Search city or ZIP"
            autoComplete="off"
            className={clsx('min-w-0 flex-1 bg-transparent text-[14px] outline-none',
                            t.text, dark ? 'placeholder:text-ink-500' : 'placeholder:text-ink-300')}
          />
        </div>
        {notFound && (
          <p className="mt-2 px-1 text-[12px] text-signal">
            No match. Try Denver, Chicago, or a ZIP.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="font-display text-[17px] font-bold tracking-[-0.01em]">Layers</h2>
          <span className={clsx('text-[12px] tabular-nums', t.faint)}>
            {onCount} of {LAYER_META.length} on
          </span>
        </div>
        {LAYER_META.map(({ key, label, blurb }) => {
          const on = layers[key]
          return (
            <button
              key={key}
              onClick={() => onLayerToggle(key)}
              aria-pressed={on}
              className={clsx('-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors',
                              t.hover)}
            >
              <LayerIcon category={key} theme={theme} size={38} active={on} />
              <span className={clsx('flex min-w-0 flex-1 flex-col transition-opacity', !on && 'opacity-45')}>
                <span className="truncate text-[14px] font-semibold">{label}</span>
                <span className={clsx('truncate text-[12px]', t.faint)}>{blurb}</span>
              </span>
              <span className={clsx('rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums', t.chip,
                                    !on && 'opacity-45')}>
                {counts[key]}
              </span>
              <Switch on={on} />
            </button>
          )
        })}
      </div>

      <div className={clsx('border-t', t.border)}>
        {/* Signed in: avatar + name opens Settings on the Profile section.
            Signed out: no profile row at all — just Sign up / Log in — but
            Settings (gear) stays reachable either way below, since
            everything in it except the Profile section works without an
            account. */}
        {signedIn ? (
          <button
            onClick={onOpenSettings}
            className={clsx('flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors', t.hover)}
          >
            <span className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-full bg-signal text-[13px] font-bold text-ink-900">
              {initialsOf(profileName)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold">{profileName}</span>
              <span className={clsx('block truncate text-[12px]', t.faint)}>Profile &amp; settings</span>
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={t.faint}>
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        ) : (
          <div className="flex items-center gap-2 px-5 py-3.5">
            <Link href="/signup" className="flex h-10 flex-1 items-center justify-center rounded-lg bg-signal text-[12.5px] font-semibold text-ink-900">
              Sign up
            </Link>
            <Link href="/login" className={clsx('flex h-10 flex-1 items-center justify-center rounded-lg border text-[12.5px] font-medium', t.border, t.hover)}>
              Log in
            </Link>
            <button
              onClick={onOpenSettings}
              aria-label="Settings"
              className={clsx('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border transition-colors',
                              t.base, t.border, t.muted, t.hover)}
            >
              {IconGear}
            </button>
          </div>
        )}

        {signedIn && onSignOut && (
          <div className="px-5 pb-3">
            <button onClick={onSignOut} className={clsx('h-9 w-full rounded-lg border text-[12.5px] font-medium', t.border, t.muted, t.hover)}>
              Log out
            </button>
          </div>
        )}

        <p className={clsx('px-5 pb-4 text-[11px] leading-relaxed', t.faint)}>
          Map data ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
             className="underline underline-offset-2 hover:text-signal">
            OpenStreetMap
          </a>{' '}
          contributors. Tiles by OpenFreeMap.
        </p>
      </div>
    </aside>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
   Settings
   ────────────────────────────────────────────────────────────────────────── */

export interface MapPrefs {
  terrain: boolean
  labels: boolean
  poi: boolean
  unit: DistanceUnit
}

export const DEFAULT_MAP_PREFS: MapPrefs = {
  terrain: true, labels: true, poi: false, unit: 'mi',
}

const GEO_COPY: Record<GeoStatus, { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  idle:        { label: 'Not requested',  tone: 'warn' },
  prompting:   { label: 'Waiting for a fix', tone: 'warn' },
  granted:     { label: 'Sharing',        tone: 'ok'   },
  denied:      { label: 'Blocked',        tone: 'bad'  },
  unavailable: { label: 'Unavailable',    tone: 'bad'  },
  error:       { label: 'No fix',         tone: 'bad'  },
}

interface SettingsProps {
  theme: Theme
  profileName: string
  /** Everything here works without an account except the Profile section,
   *  which needs a signed-in person to have a name and an avatar to show. */
  signedIn: boolean
  prefs: MapPrefs
  geoStatus: GeoStatus
  geoMessage: string | null
  layers: Record<CategoryKey, boolean>
  onPrefsChange: (next: MapPrefs) => void
  onThemeChange: (theme: Theme) => void
  onLayerToggle: (key: CategoryKey) => void
  onRequestLocation: () => void
  onProfileNameChange: (name: string) => void
  onClose: () => void
}

/**
 * Full-screen on a phone, a centred card on a desktop. Settings is one of the
 * few surfaces where covering the map is the right call: nobody adjusts units
 * while watching a vehicle.
 */
/**
 * Settings rows, hoisted to module scope on purpose.
 *
 * Defined inside SettingsPage these are a new component type on every render,
 * so React unmounts and remounts the entire subtree each keystroke — the name
 * field lost focus and its value after a single character. Same markup, but
 * stable identity.
 */
function SettingsRow({ theme, label, hint, children }: {
  theme: Theme; label: string; hint?: string; children: React.ReactNode
}) {
  const t = ui(theme)
  return (
    <div className={clsx('flex items-center gap-3 border-b px-5 py-3.5 last:border-b-0', t.border)}>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{label}</span>
        {hint && <span className={clsx('mt-0.5 block text-[11px] leading-snug', t.faint)}>{hint}</span>}
      </span>
      {children}
    </div>
  )
}

function SettingsSection({ theme, title, children }: {
  theme: Theme; title: string; children: React.ReactNode
}) {
  const t = ui(theme)
  return (
    <section className="mb-5">
      <h3 className={clsx('mb-1.5 px-5 text-[11px] font-medium', t.faint)}>{title}</h3>
      <div className={clsx('rounded-xl border', t.border,
                           theme === 'dark' ? 'bg-ink-900' : 'bg-white')}>
        {children}
      </div>
    </section>
  )
}

function SettingsToggle({ on, onChange, label }: {
  on: boolean; onChange: () => void; label: string
}) {
  return (
    <button onClick={onChange} role="switch" aria-checked={on} aria-label={label}>
      <Switch on={on} />
    </button>
  )
}

interface MobileSearchBarProps {
  theme: Theme
  profileName?: string
  signedIn?: boolean
  onFlyTo: (dest: FlyTarget) => void
  onOpenProfile: () => void
}

/**
 * The full-width top bar shown below `lg` in place of the hamburger button.
 * Same city/ZIP lookup as the desktop rail's search, plus an avatar at the
 * right edge that opens the same Settings/profile overlay the desktop
 * footer row opens — there is no separate mobile profile screen to keep in
 * sync with the desktop one.
 */
export function MobileSearchBar({ theme, profileName = 'Guest', signedIn, onFlyTo, onOpenProfile }: MobileSearchBarProps) {
  const t = ui(theme)
  const dark = theme === 'dark'
  const [search, setSearch] = useState('')
  const [notFound, setNotFound] = useState(false)

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const hit = CITIES[search.trim().toLowerCase()]
    if (hit) { onFlyTo(hit); setSearch(''); setNotFound(false) }
    else setNotFound(true)
  }

  return (
    <div className="absolute inset-x-3 top-3 z-10 lg:hidden">
      <div className={clsx('flex h-11 items-center gap-2 rounded-full border pl-3.5 pr-1.5 shadow-md transition-colors',
                           t.panel, notFound ? 'border-signal' : t.border)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2.2" strokeLinecap="round" className={clsx('flex-shrink-0', t.faint)}>
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setNotFound(false) }}
          onKeyDown={handleSearch}
          placeholder="Search city or ZIP"
          autoComplete="off"
          className={clsx('min-w-0 flex-1 bg-transparent text-[14px] outline-none',
                          t.text, dark ? 'placeholder:text-ink-500' : 'placeholder:text-ink-300')}
        />
        <button
          onClick={onOpenProfile}
          aria-label={signedIn ? `${profileName} \u2014 profile and settings` : 'Sign in or open settings'}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-signal text-[12px] font-bold text-ink-900"
        >
          {signedIn ? initialsOf(profileName) : IconGear}
        </button>
      </div>
      {notFound && (
        <p className={clsx('mt-1.5 ml-1 rounded-full px-2.5 py-1 text-[12px] text-signal shadow-sm', t.panel)}>
          No match. Try Denver, Chicago, or a ZIP.
        </p>
      )}
    </div>
  )
}

export function SettingsPage({
  theme, profileName, signedIn, prefs, geoStatus, geoMessage, layers,
  onPrefsChange, onThemeChange, onLayerToggle, onRequestLocation,
  onProfileNameChange, onClose,
}: SettingsProps) {
  const t = ui(theme)
  const dark = theme === 'dark'
  const geo = GEO_COPY[geoStatus]

  // Held locally and committed on blur, so the avatar initials do not churn
  // on every keystroke while someone is mid-word.
  const [draftName, setDraftName] = useState(profileName)
  const commitName = () => {
    const next = draftName.trim()
    if (next && next !== profileName) onProfileNameChange(next)
    else setDraftName(profileName)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div
        onClick={onClose}
        aria-hidden
        className="absolute inset-0 bg-ink-950/60 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className={clsx(
          'relative flex h-full w-full flex-col sm:h-auto sm:max-h-[86vh] sm:w-[440px] sm:rounded-2xl sm:border sm:shadow-2xl',
          t.panel, t.border, t.text,
        )}
      >
        <header className={clsx('flex flex-shrink-0 items-center gap-3 border-b px-5 py-4', t.border)}>
          {signedIn ? (
            <>
              <span className={clsx(
                'flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-semibold ring-1',
                dark ? 'bg-ink-800 text-ink-100 ring-ink-700' : 'bg-ink-100 text-ink-700 ring-ink-200',
              )}>
                {initialsOf(profileName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[17px] font-bold">{draftName || profileName}</span>
                <span className={clsx('block text-[11.5px]', t.faint)}>Settings</span>
              </span>
            </>
          ) : (
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-[17px] font-bold">Settings</span>
            </span>
          )}
          {/* Close button always sits top right — same spot in this centred
              desktop card and in the full-screen mobile view below. */}
          <button
            onClick={onClose}
            aria-label="Close settings"
            className={clsx('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg', t.hover, t.muted)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className={clsx('min-h-0 flex-1 overflow-y-auto py-5', t.base)}>
          {signedIn && (
            <SettingsSection theme={theme} title="Profile">
              <div className={clsx('border-b px-5 py-4', t.border)}>
                {/* Associated, not just adjacent: without htmlFor/id a screen
                    reader announces this input as unlabelled, and tapping the
                    label does not focus it. */}
                <label htmlFor="profile-name"
                       className={clsx('mb-1.5 block text-[11px] font-medium', t.faint)}>
                  Display name
                </label>
                <input
                  id="profile-name"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setDraftName(profileName)
                  }}
                  placeholder="Your name"
                  className={clsx(
                    'w-full rounded-lg border px-3 py-2 text-[13px] outline-none transition-colors',
                    t.text, dark
                      ? 'border-ink-700 bg-ink-850 placeholder:text-ink-500 focus:border-signal'
                      : 'border-ink-100 bg-white placeholder:text-ink-300 focus:border-signal',
                  )}
                />
                <p className={clsx('mt-1.5 text-[11px] leading-snug', t.faint)}>
                  This is what a net host sees next to your join request, and what
                  other members see on the map.
                </p>
              </div>
              <SettingsRow theme={theme} label="Avatar" hint="Generated from your initials.">
                <span className={clsx(
                  'flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-semibold ring-1',
                  dark ? 'bg-ink-800 text-ink-100 ring-ink-700' : 'bg-ink-100 text-ink-700 ring-ink-200',
                )}>
                  {initialsOf(draftName || profileName)}
                </span>
              </SettingsRow>
            </SettingsSection>
          )}

          <SettingsSection theme={theme} title="Location">
            <SettingsRow
              theme={theme}
              label="Device location"
              hint={geoMessage ?? 'Used to centre the map and sort nearby places.'}
            >
              <span className={clsx(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
                geo.tone === 'ok'
                  ? dark ? 'bg-emerald-400/15 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
                  : geo.tone === 'warn'
                    ? dark ? 'bg-amber-400/15 text-amber-300' : 'bg-amber-50 text-amber-700'
                    : 'bg-signal/15 text-signal',
              )}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {geo.label}
              </span>
            </SettingsRow>
            {geoStatus !== 'granted' && (
              <SettingsRow theme={theme} label="Permission" hint="Blocked permissions have to be cleared in the browser's site settings.">
                <button
                  onClick={onRequestLocation}
                  className="h-10 rounded-[10px] bg-signal px-4 text-[13px] font-semibold text-ink-900 transition-colors hover:bg-signal-400"
                >
                  Try again
                </button>
              </SettingsRow>
            )}
          </SettingsSection>

          <SettingsSection theme={theme} title="Appearance">
            <SettingsRow theme={theme} label="Theme" hint="Dark mode also recolours the map itself, not just the panels.">
              <div className={clsx('flex gap-0.5 rounded-lg p-0.5', dark ? 'bg-ink-800' : 'bg-ink-100')}>
                {(['light', 'dark'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => onThemeChange(mode)}
                    aria-pressed={theme === mode}
                    className={clsx('rounded-md px-3 py-1 text-[12px] font-medium capitalize transition-colors',
                                    theme === mode ? 'bg-signal text-ink-900' : t.muted)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </SettingsRow>
            <SettingsRow theme={theme} label="Distance units">
              <div className={clsx('flex gap-0.5 rounded-lg p-0.5', dark ? 'bg-ink-800' : 'bg-ink-100')}>
                {(['mi', 'km'] as const).map((u) => (
                  <button
                    key={u}
                    onClick={() => onPrefsChange({ ...prefs, unit: u })}
                    aria-pressed={prefs.unit === u}
                    className={clsx('rounded-md px-3 py-1 text-[12px] font-medium transition-colors',
                                    prefs.unit === u ? 'bg-signal text-ink-900' : t.muted)}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection theme={theme} title="Map detail">
            <SettingsRow theme={theme} label="Terrain shading" hint="Hillshade under the basemap, below zoom 13.">
              <SettingsToggle on={prefs.terrain} label="Terrain shading"
                      onChange={() => onPrefsChange({ ...prefs, terrain: !prefs.terrain })} />
            </SettingsRow>
            <SettingsRow theme={theme} label="Place labels" hint="Turn off for a clean plate when screenshotting.">
              <SettingsToggle on={prefs.labels} label="Place labels"
                      onChange={() => onPrefsChange({ ...prefs, labels: !prefs.labels })} />
            </SettingsRow>
            <SettingsRow theme={theme} label="OpenStreetMap POIs" hint="Off by default: they compete with your own pins.">
              <SettingsToggle on={prefs.poi} label="OpenStreetMap POIs"
                      onChange={() => onPrefsChange({ ...prefs, poi: !prefs.poi })} />
            </SettingsRow>
          </SettingsSection>

          <p className={clsx('px-5 text-[10.5px] leading-relaxed', t.faint)}>
            Map data © OpenStreetMap contributors, ODbL. Tiles by OpenFreeMap.
            Terrain from AWS Open Data.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
   Segmented control, shared with the map's Live/Network switch.

   It lives here rather than in its own file because the Network panel is the
   component that defines what a tab looks like in this app; the map switch
   borrows it so the two levels cannot drift apart visually.
   ────────────────────────────────────────────────────────────────────────── */

export interface TabItem<T extends string> {
  id: T
  label: string
  icon?: ReactNode
  /** Rendered as a pill after the label. A number of 0 is hidden. */
  count?: number
  /** Small dot before the label, for "something changed while you were away". */
  dot?: boolean
}

interface TabsProps<T extends string> {
  theme: Theme
  items: TabItem<T>[]
  /** Null or undefined renders every segment unselected. */
  value: T | null | undefined
  onChange: (id: T) => void
  /** `pill` floats over the map; `inset` sits in a panel header. */
  variant?: 'pill' | 'inset'
  size?: 'sm' | 'md'
  className?: string
  ariaLabel?: string
}

export function Tabs<T extends string>({
  theme, items, value, onChange,
  variant = 'inset', size = 'md', className, ariaLabel,
}: TabsProps<T>) {
  const t = ui(theme)
  const dark = theme === 'dark'

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={clsx(
        'flex items-center gap-1 p-1',
        variant === 'pill'
          ? clsx('rounded-full border shadow-sm', t.panel, t.border)
          : clsx('rounded-xl', dark ? 'bg-ink-900' : 'bg-ink-100'),
        className,
      )}
    >
      {items.map(({ id, label, icon, count, dot }) => {
        const on = value === id
        return (
          <button
            key={id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(id)}
            className={clsx(
              'relative flex flex-1 items-center justify-center gap-1.5 font-semibold',
              'transition-colors focus-visible:outline-none focus-visible:ring-2',
              'focus-visible:ring-signal focus-visible:ring-offset-1',
              dark ? 'focus-visible:ring-offset-ink-900' : 'focus-visible:ring-offset-white',
              variant === 'pill' ? 'rounded-full' : 'rounded-[9px]',
              size === 'sm' ? 'h-9 px-3 text-[13px]' : 'h-10 px-4 text-[14px]',
              on
                ? clsx('shadow-sm', dark ? 'bg-ink-700 text-ink-50' : 'bg-white text-ink-900')
                : clsx(t.muted, dark ? 'hover:bg-ink-800 hover:text-ink-100'
                                     : 'hover:bg-white/60 hover:text-ink-900'),
            )}
          >
            {dot && !on && (
              <span className="absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-signal" />
            )}
            {icon}
            <span>{label}</span>
            {!!count && (
              <span
                className={clsx(
                  'rounded-full px-[7px] py-px text-[11px] font-bold tabular-nums',
                  dot
                    ? 'bg-signal text-ink-900'
                    : dark ? 'bg-ink-800 text-ink-200' : 'bg-ink-100 text-ink-600',
                )}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}