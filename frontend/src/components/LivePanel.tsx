'use client'

/**
 * The Live tab: what is around you right now.
 *
 * Two kinds of thing appear here and they are deliberately not merged. People
 * and vehicles moving on your net come first, because a moving dot is the only
 * item on this list that can change while you are reading it. Fixed places —
 * parking, car washes, charging, services — follow, sorted by distance.
 *
 * The list mirrors the layer filter rather than ignoring it. Turning off EV
 * charging in the rail removes it from the map and from here, because two
 * views of the same data that disagree about what is switched on is a bug
 * people report as "the map is wrong".
 */
import { useMemo, useState } from 'react'
import clsx from 'clsx'
import type { CategoryKey, DistanceUnit, GeoData, GeoFeature, Theme } from '@/lib/types'
import {
  LAYER_BY_KEY, LAYER_META, describeFacility, distanceMeters, formatDistance, layerColor,
} from '@/lib/types'
import { ui } from '@/lib/theme'
import { LayerIcon, alpha } from './Sidebar'
import type { ConnectionState, LiveState } from '@/lib/live-types'

export interface NearbyResult {
  feature: GeoFeature
  category: CategoryKey
  /** Metres from the device, or null when we have no fix. */
  distance: number | null
}

export interface NearbyPanelProps {
  theme: Theme
  /** Already filtered by the layer toggles and sorted by distance. */
  results: NearbyResult[]
  subjects: LiveState[]
  connection: ConnectionState
  following: string | null
  unit: DistanceUnit
  hasFix: boolean
  onFollow: (id: string | null) => void
  onSelect: (feature: GeoFeature) => void
  onRequestLocation: () => void
}

const CONNECTION_COPY: Record<ConnectionState, string> = {
  connecting: 'Connecting',
  live:       'Live',
  retrying:   'Reconnecting',
  closed:     'Offline',
}

/**
 * Build the Nearby list. Exported so the page can compute it once and hand
 * the same array to both the panel and the tab count.
 */
export function buildNearby(
  geoData: GeoData,
  layers: Record<CategoryKey, boolean>,
  origin: [number, number] | null,
  limit = 60,
): NearbyResult[] {
  const rows: NearbyResult[] = []
  for (const { key } of LAYER_META) {
    if (!layers[key]) continue
    for (const feature of geoData[key].features) {
      rows.push({
        feature,
        category: key,
        distance: origin ? distanceMeters(origin, feature.geometry.coordinates) : null,
      })
    }
  }
  // Without a fix there is no meaningful order, so fall back to alphabetical
  // rather than leaving whatever order the seed file happened to have.
  rows.sort((a, b) =>
    a.distance !== null && b.distance !== null
      ? a.distance - b.distance
      : a.feature.properties.name.localeCompare(b.feature.properties.name))
  return rows.slice(0, limit)
}

export default function NearbyPanel({
  theme, results, subjects, connection, following, unit, hasFix,
  onFollow, onSelect, onRequestLocation,
}: NearbyPanelProps) {
  const t = ui(theme)
  const dark = theme === 'dark'
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return results
    return results.filter(({ feature }) =>
      feature.properties.name.toLowerCase().includes(q) ||
      feature.properties.city.toLowerCase().includes(q))
  }, [results, query])

  return (
    <div className="pb-4">
      {/* Status strip */}
      <div className={clsx('flex items-center gap-2 border-b px-4 py-2.5', t.border)}>
        <span className={clsx(
          'h-1.5 w-1.5 flex-shrink-0 rounded-full',
          connection === 'live' ? 'bg-emerald-400' : 'bg-ink-300',
        )} />
        <span className="text-[11.5px] font-medium">{CONNECTION_COPY[connection]}</span>
        <span className={clsx('ml-auto text-[11px] tabular-nums', t.faint)}>
          {subjects.length} moving · {results.length} places
        </span>
      </div>

      {!hasFix && (
        <button
          onClick={onRequestLocation}
          className={clsx(
            'm-4 flex w-[calc(100%-2rem)] items-start gap-3 rounded-xl border px-3.5 py-3 text-left',
            'border-signal/40 bg-signal/10',
          )}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
               className="mt-0.5 flex-shrink-0 text-signal">
            <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" />
          </svg>
          <span>
            <span className="block text-[12.5px] font-semibold">Turn on location</span>
            <span className={clsx('mt-0.5 block text-[11px] leading-snug', t.faint)}>
              Distances and ordering need your position. Everything here is
              alphabetical until then.
            </span>
          </span>
        </button>
      )}

      {/* Moving subjects first — the only rows that change while you read */}
      {subjects.length > 0 && (
        <section className="px-4 pt-3">
          <h3 className={clsx('mb-1.5 text-[11px] font-medium', t.faint)}>On the move</h3>
          {subjects.map((s) => (
            <button
              key={s.subject_id}
              onClick={() => onFollow(following === s.subject_id ? null : s.subject_id)}
              className={clsx(
                '-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2.5 rounded-lg px-1 py-2 text-left',
                following === s.subject_id ? (dark ? 'bg-ink-800' : 'bg-ink-50') : t.hover,
              )}
            >
              <span className={clsx(
                'h-2 w-2 flex-shrink-0 rounded-full',
                s.stale ? 'bg-ink-300' : 'bg-emerald-400',
              )} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">{s.label}</span>
                <span className={clsx('block truncate text-[10.5px]', t.faint)}>
                  {s.stale ? 'Signal lost' : s.speed_kmh
                    ? `${Math.round(s.speed_kmh)} km/h`
                    : 'Stopped'}
                </span>
              </span>
              {following === s.subject_id && (
                <span className="rounded-full bg-signal px-2 py-0.5 text-[10px] font-semibold text-ink-900">
                  Following
                </span>
              )}
            </button>
          ))}
        </section>
      )}

      {/* Fixed places */}
      <section className="px-4 pt-3">
        <div className="mb-2 flex items-center gap-2">
          <h3 className={clsx('flex-1 text-[11px] font-medium', t.faint)}>Around you</h3>
        </div>

        <div className={clsx('mb-2 flex items-center gap-2 rounded-lg border px-3 py-2', t.base, t.border)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.2" strokeLinecap="round" className={t.faint}>
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or city"
            className={clsx('min-w-0 flex-1 bg-transparent text-[12px] outline-none',
                            t.text, dark ? 'placeholder:text-ink-500' : 'placeholder:text-ink-300')}
          />
        </div>

        {filtered.length === 0 ? (
          <p className={clsx('px-1 py-8 text-center text-[12px] leading-relaxed', t.faint)}>
            {results.length === 0
              ? 'No layers are switched on. Turn one on in the rail to see what is around you.'
              : 'Nothing matches that filter.'}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map(({ feature, category, distance }) => {
              const p = feature.properties
              const color = layerColor(category, theme)
              return (
                <li key={`${category}-${p.name}-${feature.geometry.coordinates.join(',')}`}>
                  <button
                    onClick={() => onSelect(feature)}
                    className={clsx('-mx-1 flex w-[calc(100%+0.5rem)] items-start gap-2.5 rounded-lg px-1 py-2 text-left',
                                    t.hover)}
                  >
                    <LayerIcon category={category} theme={theme} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{p.name}</span>
                        {distance !== null && (
                          <span className={clsx('flex-shrink-0 text-[10.5px] tabular-nums', t.faint)}>
                            {formatDistance(distance, unit)}
                          </span>
                        )}
                      </span>
                      <span className={clsx('mt-0.5 block truncate text-[11px]', t.muted)}>
                        {describeFacility(p) || LAYER_BY_KEY[category].label}
                      </span>
                      <span className={clsx('mt-0.5 block truncate text-[10.5px]', t.faint)}>
                        {p.address}, {p.city}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: alpha(color, 0.8) }}
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}