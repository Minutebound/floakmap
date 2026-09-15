'use client'

/**
 * App shell.
 *
 * One tree, two layouts. At `lg` and up it is three columns: layer rail, map,
 * detail rail. Below that the map takes the whole screen and the two rails
 * become overlays — the layer rail slides in from the left, Live and Network
 * come up from the bottom — driven by a fixed bottom bar.
 *
 * The panels themselves are the same components in both layouts. They carry
 * responsive width and border classes rather than a `mobile` prop, so there is
 * one implementation of Live and one of Network, not two that drift.
 */
import dynamic from 'next/dynamic'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type maplibregl from 'maplibre-gl'
import clsx from 'clsx'
import Sidebar, {
  SettingsPage, DEFAULT_MAP_PREFS, Tabs, IconLayers, IconLive, IconHost, IconJoin,
} from '@/components/Sidebar'
import type { MapPrefs } from '@/components/Sidebar'
import LiveLayer from '@/components/LiveLayer'
import { buildNearby } from '@/components/LivePanel'
import NetworkPanel from '@/components/NetworkPanel'
import type { NetworkTab } from '@/components/NetworkPanel'
import type { ClaimResult, JoinSubmitted } from '@/lib/floaknet-types'
import { joinApi } from '@/lib/floaknet-api'
import { useLiveTracking, useDemoToken, useGeolocation } from '@/hooks/useLiveTracking'
import { ui } from '@/lib/theme'
import type { CategoryKey, FlyTarget, GeoFeature, Theme } from '@/lib/types'
import { SEED_DATA } from '@/lib/seed-data'
import { reverseGeocode } from '@/lib/types'

const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-ink-50 dark:bg-ink-900">
      <div className="flex flex-col items-center gap-3 text-ink-300">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-signal border-t-transparent motion-reduce:animate-none" />
        <span className="text-sm">Loading map…</span>
      </div>
    </div>
  ),
})

const DEFAULT_LAYERS: Record<CategoryKey, boolean> = {
  parking: true,
  carwash: true,
  ev:      false,
  gas:     false,
  auto:    false,
}

// Seeds the profile until real auth lands; editable from Settings.
const DEFAULT_PROFILE_NAME = 'Maya Ortiz'

const COUNTS: Record<CategoryKey, number> = {
  parking: SEED_DATA.parking.features.length,
  carwash: SEED_DATA.carwash.features.length,
  ev:      SEED_DATA.ev.features.length,
  gas:     SEED_DATA.gas.features.length,
  auto:    SEED_DATA.auto.features.length,
}


/* ──────────────────────────────────────────────────────────────────────────
   Layout primitives. Only this file uses them, so they live beside it rather
   than in components of their own.
   ────────────────────────────────────────────────────────────────────────── */

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(query)
    const update = () => setMatches(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [query])

  return matches
}

/** The width at which all three columns fit side by side. */
const useIsDesktop = () => useMediaQuery('(min-width: 1024px)')

interface DrawerProps {
  theme: Theme
  open: boolean
  onClose: () => void
  side: 'left' | 'bottom'
  children: ReactNode
  label: string
  /**
   * Dim and block the page behind the panel. True for the left menu, which
   * replaces the screen. False for the bottom sheet: this is a map app, and a
   * sheet that greys out the map hides the thing the sheet is describing. The
   * sheet sits above the nav bar instead, so Live and Network stay one tap
   * apart while it is open.
   */
  modal?: boolean
}

function Drawer({
  theme, open, onClose, side, children, label, modal = side === 'left',
}: DrawerProps) {
  const t = ui(theme)
  const panelRef = useRef<HTMLDivElement>(null)

  // Escape closes, and the body stops scrolling behind the overlay. Both are
  // things people expect from a modal surface and notice only when missing.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    if (!modal) return () => document.removeEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose, modal])

  // Move focus into the panel when it opens so the keyboard follows the eye.
  // Only when modal: stealing focus for a non-blocking sheet would yank the
  // caret out of whatever the person was doing.
  useEffect(() => {
    if (open && modal) panelRef.current?.focus()
  }, [open, modal])

  return (
    <>
      {modal && (
        <div
          onClick={onClose}
          aria-hidden
          className={clsx(
            'fixed inset-0 z-40 bg-ink-950/50 transition-opacity duration-200 lg:hidden',
            'motion-reduce:transition-none',
            open ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={modal}
        aria-label={label}
        tabIndex={-1}
        className={clsx(
          'fixed flex flex-col outline-none lg:hidden',
          'transition-transform duration-250 ease-out motion-reduce:transition-none',
          t.panel,
          side === 'left'
            ? clsx('inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] border-r', t.border,
                   open ? 'translate-x-0' : '-translate-x-full')
            // Parked above the bottom nav (56px + the iOS home indicator) so
            // the nav stays reachable while the sheet is up.
            : clsx('inset-x-0 z-40 max-h-[62vh] rounded-t-2xl border-t shadow-2xl',
                   'bottom-[calc(3.5rem+env(safe-area-inset-bottom))]', t.border,
                   open ? 'translate-y-0' : 'translate-y-[130%]'),
        )}
      >
        {side === 'bottom' && (
          // Grab handle. Purely a signifier that this surface is dismissable —
          // the backdrop and the close button do the actual work.
          <div className="flex justify-center pt-2 pb-1">
            <span className={clsx('h-1 w-9 rounded-full', theme === 'dark' ? 'bg-ink-700' : 'bg-ink-200')} />
          </div>
        )}
        {children}
      </div>
    </>
  )
}

type MobileTab = 'layers' | NetworkTab

interface MobileNavProps {
  theme: Theme
  active: MobileTab | null
  onSelect: (tab: MobileTab) => void
  /** Vehicles currently reporting. Shown on Live. */
  liveCount?: number
  /** Unacknowledged alerts. Shown as a dot on Live. */
  unread?: number
}

const ITEMS: { id: MobileTab; label: string; icon: ReactNode }[] = [
  { id: 'layers', label: 'Layers', icon: IconLayers },
  { id: 'live',   label: 'Live',   icon: IconLive },
  { id: 'host',   label: 'Host',   icon: IconHost },
  { id: 'join',   label: 'Join',   icon: IconJoin },
]

function MobileNav({
  theme, active, onSelect, liveCount = 0, unread = 0,
}: MobileNavProps) {
  const t = ui(theme)
  const dark = theme === 'dark'

  return (
    <nav
      aria-label="Main"
      className={clsx(
        'fixed inset-x-0 bottom-0 z-50 flex border-t lg:hidden',
        // Clears the iOS home indicator without adding padding on Android.
        'pb-[env(safe-area-inset-bottom)]',
        t.panel, t.border,
      )}
    >
      {ITEMS.map(({ id, label, icon }) => {
        const on = active === id
        const badge = id === 'live' ? liveCount : 0
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            aria-current={on ? 'page' : undefined}
            className={clsx(
              'relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium',
              'transition-colors focus-visible:outline-none focus-visible:ring-2',
              'focus-visible:ring-inset focus-visible:ring-signal',
              on ? 'text-signal' : t.muted,
            )}
          >
            <span className="relative">
              {icon}
              {id === 'live' && unread > 0 && !on && (
                <span className={clsx(
                  'absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-signal ring-2',
                  dark ? 'ring-ink-850' : 'ring-white',
                )} />
              )}
            </span>
            <span>{label}</span>
            {!!badge && (
              <span className={clsx(
                'absolute right-[22%] top-1.5 rounded-full px-1.5 text-[9.5px] font-semibold tabular-nums',
                on ? 'bg-signal text-ink-900' : dark ? 'bg-ink-700 text-ink-200' : 'bg-ink-100 text-ink-600',
              )}>
                {badge}
              </span>
            )}
            {on && <span className="absolute inset-x-5 top-0 h-[2px] rounded-full bg-signal" />}
          </button>
        )
      })}
    </nav>
  )
}

/**
 * Shown when location is refused or unavailable.
 *
 * Deliberately a blocking card rather than a toast. Every distance, the sort
 * order of the Nearby list and the heading arrow all depend on a fix, so a
 * dismissed toast would leave someone using a visibly broken product without
 * knowing why. It explains the specific failure — a denial, an insecure
 * origin and a timeout each need a different action — and can be dismissed
 * once read, because a hard browser block cannot be undone from in here.
 */
function LocationGate({
  theme, status, message, onRetry, onDismiss,
}: {
  theme: Theme
  status: 'denied' | 'unavailable' | 'error'
  message: string | null
  onRetry: () => void
  onDismiss: () => void
}) {
  const t = ui(theme)
  const dark = theme === 'dark'

  const HOW: Record<typeof status, string> = {
    denied:
      'Open the padlock or location icon in the address bar, set this site to Allow, then try again.',
    unavailable:
      'Location needs a secure connection. Reach this site over HTTPS, or run it on localhost.',
    error:
      'Your device could not get a fix. Check that location services are on, then try again.',
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center">
      <div aria-hidden className="absolute inset-0 bg-ink-950/60 backdrop-blur-[2px]" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="loc-title"
        className={clsx('relative w-full max-w-[400px] rounded-2xl border p-6 shadow-2xl',
                        t.panel, t.border, t.text)}
      >
        <span
          aria-hidden
          className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-signal/15 text-signal"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
            <circle cx="12" cy="10" r="2.6" />
          </svg>
        </span>

        <h2 id="loc-title" className="text-[17px] font-semibold tracking-tight">
          FloakMap needs your location
        </h2>
        <p className={clsx('mt-2 text-[13px] leading-relaxed', t.muted)}>
          Distances, the order of what is nearby, and the heading arrow on the
          map all come from your device position. Without it the map still
          works, but nothing is sorted around you.
        </p>
        <p className={clsx('mt-3 rounded-lg px-3 py-2.5 text-[12px] leading-relaxed',
                           dark ? 'bg-ink-900 text-ink-300' : 'bg-ink-50 text-ink-500')}>
          {message ? `${message} ` : ''}{HOW[status]}
        </p>

        <div className="mt-5 flex gap-2">
          <button
            onClick={onRetry}
            className="flex-1 rounded-lg bg-signal px-4 py-2.5 text-[13px] font-semibold text-ink-900"
          >
            Try again
          </button>
          <button
            onClick={onDismiss}
            className={clsx('rounded-lg border px-4 py-2.5 text-[13px] font-medium', t.border, t.muted, t.hover)}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}

export default function HomePage() {
  const [theme,  setTheme]  = useState<Theme>('light')
  const [layers, setLayers] = useState<Record<CategoryKey, boolean>>(DEFAULT_LAYERS)
  const [flyTo,  setFlyTo]  = useState<FlyTarget | null>(null)
  const [map,    setMap]    = useState<maplibregl.Map | null>(null)
  // One panel, three tabs. Clicking any of Live / Host / Join opens the same
  // surface with that tab selected, so the other two are always one tap away
  // instead of hidden behind a second level of navigation.
  const [tab, setTab] = useState<NetworkTab>('live')
  const [panelOpen, setPanelOpen] = useState(true)
  const [navOpen, setNavOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [prefs, setPrefs] = useState<MapPrefs>(DEFAULT_MAP_PREFS)
  const [locationDismissed, setLocationDismissed] = useState(false)
  /**
   * Two sources for "where am I", in priority order.
   *
   * MapView reads the real place name out of the vector tiles under the fix,
   * which is accurate and free. It answers null whenever the tiles have not
   * loaded, the zoom is too low to carry a place label, or the basemap has
   * fallen back to raster — so a coordinate table covers those, naming the
   * nearest metro. Tiles win when they have an answer; the table is what keeps
   * the pill from showing bare decimals offline.
   */
  const [tilePlace, setTilePlace] = useState<string | null>(null)
  const [nearestPlace, setNearestPlace] = useState<string | null>(null)
  const placeName = tilePlace ?? nearestPlace
  const [profileName, setProfileName] = useState(DEFAULT_PROFILE_NAME)

  /**
   * The in-flight join request lives here, not inside JoinNet.
   *
   * NetworkPanel renders only the active tab, so JoinNet unmounts the moment
   * someone switches to Host — taking the claim secret with it and making the
   * request permanently unredeemable. That is the exact path a host takes to
   * join the net they just created: ask on Join, approve on Host, come back.
   * Holding it at the page keeps the request alive across that round trip, and
   * keeps polling running while the Join tab is not even mounted.
   */
  const [joinSession, setJoinSession] = useState<JoinSubmitted | null>(null)
  const [joinStatus, setJoinStatus]   = useState<ClaimResult | null>(null)
  const [joinBusy, setJoinBusy]       = useState(false)
  const [joinError, setJoinError]     = useState<string | null>(null)
  const [joinRemaining, setJoinRemaining] = useState(0)

  // Asked for on mount, not behind a button: this is a map of what is near
  // you, and without a position none of it is sorted by anything useful.
  const geo = useGeolocation()

  const isDesktop = useIsDesktop()
  const t = ui(theme)

  const demoToken = useDemoToken()

  // Joining a net hands back a token scoped to that net. Using it swaps the
  // whole session over: the websocket re-authorises and starts sending only
  // that net's members, so the map narrows to your group without any
  // client-side filtering to get wrong.
  const [netSession, setNetSession] = useState<ClaimResult | null>(null)
  const token     = netSession?.access_token ?? demoToken
  const subjectId = netSession?.subject_id ?? 'usr_maya'

  const live = useLiveTracking({ token })

  const submitJoin = useCallback(async (code: string, name: string) => {
    setJoinBusy(true); setJoinError(null)
    try {
      setJoinSession(await joinApi.ask(code, name))
      setJoinStatus(null)
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : 'Could not send that request')
    } finally { setJoinBusy(false) }
  }, [])

  const withdrawJoin = useCallback(async () => {
    const s = joinSession
    setJoinSession(null); setJoinStatus(null); setJoinError(null)
    if (s) await joinApi.withdraw(s.request_id, s.claim_secret).catch(() => {})
  }, [joinSession])

  // Polls for the host's decision. Lives here rather than in JoinNet so it
  // keeps running while the person is on the Host tab approving themselves.
  useEffect(() => {
    if (!joinSession) return
    let stop = false

    const tick = async () => {
      try {
        const result = await joinApi.check(joinSession.request_id, joinSession.claim_secret)
        if (stop) return
        setJoinStatus(result)
        if (result.status === 'approved') {
          setNetSession(result)
          setJoinSession(null)
          setTab('live')
        }
      } catch {
        /* transient; keep polling until the request expires */
      }
    }

    tick()
    const poll = setInterval(tick, 3000)
    const clock = setInterval(() => {
      setJoinRemaining(Math.max(0,
        Math.round((new Date(joinSession.expires_at).getTime() - Date.now()) / 1000)))
    }, 1000)

    return () => { stop = true; clearInterval(poll); clearInterval(clock) }
  }, [joinSession])

  /**
   * Name the place under the current fix.
   *
   * Rounded to three decimals — about 100 m — so a stationary phone jittering
   * by a few metres does not re-run this on every GPS tick. `reverseGeocode`
   * is a local table today and an async call tomorrow; awaiting it now means
   * that swap changes nothing here.
   */
  const fixKey = geo.fix
    ? `${geo.fix.coords[0].toFixed(3)},${geo.fix.coords[1].toFixed(3)}`
    : null

  useEffect(() => {
    if (!fixKey) { setNearestPlace(null); return }
    let cancelled = false
    const coords = fixKey.split(',').map(Number) as [number, number]
    reverseGeocode(coords)
      .then((place) => { if (!cancelled) setNearestPlace(place?.label ?? null) })
      .catch(() => { if (!cancelled) setNearestPlace(null) })
    return () => { cancelled = true }
  }, [fixKey])

  const toggleLayer = useCallback((key: CategoryKey) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }, [])

  // Flying to a searched city from the drawer should reveal the map, not leave
  // you looking at the menu you searched from.
  const flyAndDismiss = useCallback((dest: FlyTarget) => {
    setFlyTo(dest)
    setNavOpen(false)
  }, [])

  /**
   * Tapping a tab opens it; tapping the one already showing closes the panel.
   *
   * Read straight from state rather than a ref. An earlier version assigned
   * `tabRef.current = next` and then compared against it inside a
   * `setPanelOpen` updater — but the assignment runs immediately while the
   * updater runs at commit, so the comparison always saw the new value and
   * every single tab click closed the panel.
   */
  const openTab = useCallback((next: NetworkTab) => {
    if (panelOpen && next === tab) { setPanelOpen(false); return }
    setTab(next)
    setPanelOpen(true)
  }, [panelOpen, tab])

  const onMobileTab = useCallback((next: MobileTab) => {
    if (next === 'layers') { setNavOpen(true); return }
    openTab(next)
  }, [openTab])

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

  // A panel that changes size needs the canvas re-measured, or the map keeps
  // the old width and the right edge goes grey.
  useEffect(() => {
    if (!map) return
    const id = window.setTimeout(() => map.resize(), 260)
    return () => window.clearTimeout(id)
  }, [map, panelOpen, tab, isDesktop])

  const nearbyResults = useMemo(
    () => buildNearby(SEED_DATA, layers, geo.fix?.coords ?? null),
    [layers, geo.fix],
  )

  const focusFeature = useCallback((feature: GeoFeature) => {
    setFlyTo({ center: feature.geometry.coordinates, zoom: 16 })
  }, [])

  const panelBody = (
    <NetworkPanel
      theme={theme}
      token={token}
      subjectId={subjectId}
      tab={tab}
      onTabChange={setTab}
      onClose={() => setPanelOpen(false)}
      join={{
        session: joinSession,
        status: joinStatus,
        remaining: joinRemaining,
        busy: joinBusy,
        error: joinError,
        canHost: token !== null,
        onSubmit: submitJoin,
        onWithdraw: withdrawJoin,
      }}
      nearby={{
        theme,
        results: nearbyResults,
        subjects: live.subjects,
        connection: live.connection,
        following: live.following,
        unit: prefs.unit,
        hasFix: geo.fix !== null,
        onFollow: live.follow,
        onSelect: focusFeature,
        onRequestLocation: geo.request,
      }}
    />
  )

  const sidebar = (onClose?: () => void) => (
    <Sidebar
      theme={theme}
      layers={layers}
      counts={COUNTS}
      profileName={profileName}
      onLayerToggle={toggleLayer}
      onThemeToggle={toggleTheme}
      onFlyTo={onClose ? flyAndDismiss : setFlyTo}
      onOpenSettings={() => { setSettingsOpen(true); onClose?.() }}
      onClose={onClose}
    />
  )

  return (
    // `dark` here enables Tailwind dark: variants throughout the tree.
    // 100dvh rather than 100vh: on mobile Safari, vh includes the collapsing
    // URL bar, so the bottom nav sits below the fold until you scroll.
    <main className={clsx('flex h-[100dvh] w-full overflow-hidden', theme === 'dark' && 'dark')}>
      {/* Left rail — desktop only; the drawer below carries it otherwise */}
      <div className="hidden lg:flex">{sidebar()}</div>

      {/* Map */}
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <MapView
          theme={theme}
          layers={layers}
          geoData={SEED_DATA}
          flyTo={flyTo}
          onReady={setMap}
          // The left rail carries the OpenStreetMap credit and is always on
          // screen at lg+. Below that it is a closed drawer, so the on-map
          // chip has to stay for the attribution to remain visible.
          showAttribution={!isDesktop}
          userFix={geo.fix}
          onPlaceName={setTilePlace}
          mapOptions={{ terrain: prefs.terrain, labels: prefs.labels, poi: prefs.poi }}
        />

        <LiveLayer
          map={map}
          subjectsRef={live.subjectsRef}
          geofences={live.geofences}
          following={live.following}
          onSelect={live.follow}
        />

        {/* Menu button — replaces the rail below lg */}
        <button
          onClick={() => setNavOpen(true)}
          aria-label="Open menu"
          className={clsx(
            'absolute left-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-lg border shadow-sm lg:hidden',
            t.panel, t.border, t.text,
          )}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        {/* Status badge. Shifts right on mobile to clear the menu button, and
            drops the seed-data suffix where there is no room for it. */}
        <div
          className={clsx(
            'absolute top-3 left-14 z-10 flex items-center gap-2 rounded-full border px-3 py-1.5',
            'text-[12px] font-medium shadow-sm lg:left-3',
            t.panel, t.border, t.text,
          )}
        >
          <span
            className={clsx(
              'h-2 w-2 flex-shrink-0 rounded-full',
              live.connection === 'live'
                ? 'bg-emerald-400 animate-pulse motion-reduce:animate-none'
                : 'bg-ink-300',
            )}
          />
          {/* Where you are, not what the dataset is called. The dot is the
              only part that still reports connection state; the words are for
              the person, and the thing a person wants confirmed is that the
              map is showing the street they are standing on. */}
          <span className="max-w-[46vw] truncate sm:max-w-[320px]">
            {placeName
              ?? (geo.fix
                    ? `${geo.fix.coords[1].toFixed(4)}, ${geo.fix.coords[0].toFixed(4)}`
                    : 'Locating…')}
          </span>
        </div>

        {/* Panel switch — desktop only, and only while the panel is closed.
            Once it is open its own header carries the same three tabs, and two
            identical controls a few hundred pixels apart is just clutter over
            the map. The bottom bar owns this below lg. */}
        {!panelOpen && (
        <Tabs
          theme={theme}
          variant="inset"
          size="sm"
          className="absolute right-3 top-3 z-10 hidden lg:flex"
          ariaLabel="Detail panel"
          value={panelOpen ? tab : null}
          onChange={openTab}
          items={[
            { id: 'live' as const, label: 'Live', icon: IconLive,
              count: nearbyResults.length, dot: live.unreadCount > 0 },
            { id: 'host' as const, label: 'Host', icon: IconHost },
            { id: 'join' as const, label: 'Join', icon: IconJoin },
          ]}
        />
        )}

        {/* Zoom and recentre. Lifted clear of the bottom bar and the
            attribution chip. */}
        <div className="absolute bottom-24 right-3 z-10 flex flex-col gap-1 lg:bottom-6 lg:right-4">
          {/* Snap back to the device position. Panning away from yourself is
              the easiest thing to do on a map and the most annoying to undo by
              hand, so this is one tap. With no fix it asks for permission
              instead of sitting there dead — the same button, still doing the
              thing its arrow promises. */}
          <button
            onClick={() => {
              if (geo.fix) setFlyTo({ center: geo.fix.coords, zoom: Math.max(15, map?.getZoom() ?? 15) })
              else geo.request()
            }}
            aria-label={geo.fix ? 'Centre on my location' : 'Enable location'}
            className={clsx(
              'mb-1 flex h-9 w-9 items-center justify-center rounded-lg border shadow-sm transition-colors lg:h-8 lg:w-8',
              t.panel, t.border, t.hover,
              geo.fix ? 'text-signal' : t.faint,
            )}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3.2" />
              <circle cx="12" cy="12" r="8" />
              <path d="M12 1.5v2.6M12 19.9v2.6M22.5 12h-2.6M4.1 12H1.5" />
            </svg>
          </button>

          {['+', '−'].map((label, i) => (
            <button
              key={label}
              id={i === 0 ? 'zoom-in' : 'zoom-out'}
              onClick={() => (i === 0 ? map?.zoomIn() : map?.zoomOut())}
              aria-label={i === 0 ? 'Zoom in' : 'Zoom out'}
              className={clsx(
                'flex h-9 w-9 items-center justify-center rounded-lg border text-base font-medium shadow-sm transition-colors lg:h-8 lg:w-8',
                t.panel, t.border, t.text, t.hover,
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Right rail — desktop only */}
      {panelOpen && <div className="hidden lg:flex">{panelBody}</div>}

      {/* ── Below lg: the same panels as overlays ──────────────────────── */}

      <Drawer theme={theme} side="left" label="Menu"
              open={navOpen} onClose={() => setNavOpen(false)}>
        {sidebar(() => setNavOpen(false))}
      </Drawer>

      {/* Mounted only below `lg`. Rendering it unconditionally meant two live
          NetworkPanels at desktop widths — two Nearby lists, and two NetPanels
          each polling the join queue on their own timer. */}
      <Drawer theme={theme} side="bottom" label="Nearby and network"
              open={!isDesktop && panelOpen} onClose={() => setPanelOpen(false)}>
        {!isDesktop && panelBody}
      </Drawer>

      <MobileNav
        theme={theme}
        active={navOpen ? 'layers' : panelOpen ? tab : null}
        onSelect={onMobileTab}
        liveCount={nearbyResults.length}
        unread={live.unreadCount}
      />

      {/* Location is this product's premise, so a refusal is not a quiet
          footnote — it blocks until the person has seen why it matters and
          had a chance to retry. Dismissible, because a browser that has
          hard-blocked the permission cannot be talked round from here. */}
      {(geo.status === 'denied' || geo.status === 'unavailable' || geo.status === 'error')
        && !locationDismissed && (
        <LocationGate
          theme={theme}
          status={geo.status}
          message={geo.message}
          onRetry={geo.request}
          onDismiss={() => setLocationDismissed(true)}
        />
      )}

      {settingsOpen && (
        <SettingsPage
          theme={theme}
          profileName={profileName}
          prefs={prefs}
          geoStatus={geo.status}
          geoMessage={geo.message}
          layers={layers}
          onPrefsChange={setPrefs}
          onThemeChange={setTheme}
          onLayerToggle={toggleLayer}
          onRequestLocation={geo.request}
          onProfileNameChange={setProfileName}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  )
}