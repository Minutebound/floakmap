'use client'

import dynamic from 'next/dynamic'
import { useState, useCallback, useEffect } from 'react'
import type maplibregl from 'maplibre-gl'
import clsx from 'clsx'
import Sidebar from '@/components/Sidebar'
import LiveLayer from '@/components/LiveLayer'
import LivePanel from '@/components/LivePanel'
import NetPanel from '@/components/NetPanel'
import JoinNet from '@/components/JoinNet'
import type { ClaimResult } from '@/lib/floaknet-types'
import { useLiveTracking, useDemoToken } from '@/hooks/useLiveTracking'
import type { CategoryKey, FlyTarget, Theme } from '@/lib/types'
import { SEED_DATA } from '@/lib/seed-data'

// Dynamic import keeps maplibre-gl out of the SSR bundle
const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-stone-100 dark:bg-[#0f1525]">
      <div className="flex flex-col items-center gap-3 text-zinc-400">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">Loading map…</span>
      </div>
    </div>
  ),
})

const DEFAULT_LAYERS: Record<CategoryKey, boolean> = {
  parking: true,
  carwash: true,
  ev:      false,
  auto:    false,
}

const COUNTS: Record<CategoryKey, number> = {
  parking: SEED_DATA.parking.features.length,
  carwash: SEED_DATA.carwash.features.length,
  ev:      SEED_DATA.ev.features.length,
  auto:    SEED_DATA.auto.features.length,
}

export default function HomePage() {
  const [theme,  setTheme]  = useState<Theme>('light')
  const [layers, setLayers] = useState<Record<CategoryKey, boolean>>(DEFAULT_LAYERS)
  const [flyTo,  setFlyTo]  = useState<FlyTarget | null>(null)
  const [map,    setMap]    = useState<maplibregl.Map | null>(null)
  const [panel, setPanel] = useState<'live' | 'nets' | null>('live')
  const [joining, setJoining] = useState(false)

  // Swap useDemoToken for your real sign-in when you have one.
  const demoToken = useDemoToken()

  // Joining a net hands back a token scoped to that net. Using it swaps the
  // whole session over: the websocket re-authorises and starts sending only
  // that net's members, so the map narrows to your group without any
  // client-side filtering to get wrong.
  const [netSession, setNetSession] = useState<ClaimResult | null>(null)
  const token     = netSession?.access_token ?? demoToken
  const subjectId = netSession?.subject_id ?? 'usr_maya'

  const live = useLiveTracking({ token })

  const onJoined = useCallback((result: ClaimResult) => {
    setNetSession(result)
    setJoining(false)
    setPanel('nets')
  }, [])

  const toggleLayer = useCallback((key: CategoryKey) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }, [])

  // Tell the server which map bounds are on screen, so it can skip the rest.
  // This is what stops a nationwide account from streaming every vehicle in
  // the country to a dispatcher looking at one city.
  const { setViewport } = live
  useEffect(() => {
    if (!map) return
    const report = () => {
      const b = map.getBounds()
      setViewport([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
    }
    map.on('moveend', report)
    report()
    return () => { map.off('moveend', report) }
  }, [map, setViewport])

  return (
    // `dark` class here enables Tailwind dark: variants throughout the tree
    <main className={clsx('flex h-screen w-screen overflow-hidden', theme === 'dark' && 'dark')}>
      <Sidebar
        theme={theme}
        layers={layers}
        counts={COUNTS}
        onLayerToggle={toggleLayer}
        onThemeToggle={toggleTheme}
        onFlyTo={setFlyTo}
      />

      {/* Map area */}
      <div className="relative flex-1 min-w-0 overflow-hidden">
        <MapView
          theme={theme}
          layers={layers}
          geoData={SEED_DATA}
          flyTo={flyTo}
          onReady={setMap}
        />

        {/* Moving subjects, geofences and trails, drawn on top of the map */}
        <LiveLayer
          map={map}
          subjectsRef={live.subjectsRef}
          geofences={live.geofences}
          following={live.following}
          onSelect={live.follow}
        />

        {/* Zoom controls */}
        <div className="absolute bottom-6 right-4 flex flex-col gap-1 z-10">
          {['+', '−'].map((label, i) => (
            <button
              key={label}
              id={i === 0 ? 'zoom-in' : 'zoom-out'}
              onClick={() => (i === 0 ? map?.zoomIn() : map?.zoomOut())}
              className={clsx(
                'w-8 h-8 rounded-lg flex items-center justify-center text-base font-medium shadow-sm border transition-colors',
                theme === 'dark'
                  ? 'bg-[#161b2e] border-[#252d42] text-slate-200 hover:bg-[#252d42]'
                  : 'bg-white border-stone-200 text-zinc-700 hover:bg-stone-50',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Status badge */}
        <div
          className={clsx(
            'absolute top-3 left-3 z-10 flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium shadow-sm border',
            theme === 'dark'
              ? 'bg-[#161b2e] border-[#252d42] text-slate-200'
              : 'bg-white border-stone-200 text-zinc-700',
          )}
        >
          <span
            className={clsx(
              'w-2 h-2 rounded-full',
              live.connection === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-400',
            )}
          />
          {live.connection === 'live'
            ? `${live.subjects.length} live · Parker CO seed`
            : 'Nationwide · Parker CO seed'}
        </div>

        {/* Right-column switch */}
        <div
          className={clsx(
            'absolute top-3 right-3 z-10 flex items-center gap-0.5 rounded-full border p-0.5 shadow-sm',
            theme === 'dark'
              ? 'bg-[#161b2e] border-[#252d42]'
              : 'bg-white border-stone-200',
          )}
        >
          {(['live', 'nets'] as const).map((key) => (
            <button
              key={key}
              onClick={() => setPanel(panel === key ? null : key)}
              className={clsx(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors',
                panel === key
                  ? theme === 'dark'
                    ? 'bg-[#252d42] text-slate-100'
                    : 'bg-stone-100 text-zinc-900'
                  : theme === 'dark'
                    ? 'text-slate-400 hover:text-slate-200'
                    : 'text-zinc-500 hover:text-zinc-800',
              )}
            >
              {key === 'live' && live.unreadCount > 0 && (
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
              )}
              {key === 'live' ? 'Live' : 'Nets'}
            </button>
          ))}
          <button
            onClick={() => setJoining(true)}
            className={clsx(
              'rounded-full px-3 py-1 text-[12px] font-medium transition-colors',
              theme === 'dark'
                ? 'text-slate-400 hover:text-slate-200'
                : 'text-zinc-500 hover:text-zinc-800',
            )}
          >
            Join
          </button>
        </div>

        {/* Join flow */}
        {joining && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
            <JoinNet
              theme={theme}
              onJoined={onJoined}
              onCancel={() => setJoining(false)}
            />
          </div>
        )}
      </div>

      {panel === 'live' && (
        <LivePanel
          theme={theme}
          subjects={live.subjects}
          alerts={live.alerts}
          connection={live.connection}
          following={live.following}
          unreadCount={live.unreadCount}
          onFollow={live.follow}
          onAcknowledge={live.acknowledge}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === 'nets' && token && (
        <NetPanel
          theme={theme}
          token={token}
          subjectId={subjectId}
          onClose={() => setPanel(null)}
        />
      )}
    </main>
  )
}
