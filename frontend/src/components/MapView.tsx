'use client'

import 'maplibre-gl/dist/maplibre-gl.css'
import maplibregl from 'maplibre-gl'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CategoryKey, GeoData, Theme } from '@/lib/types'
import { LAYER_BY_KEY, LAYER_META, LAYER_LABELS, distanceMeters, layerColor } from '@/lib/types'
import type { GeoFix } from '@/hooks/useLiveTracking'
import { anchorFor, buildBasemapStyle, rasterFallbackStyle } from '@/lib/basemap'
import type { BasemapOptions } from '@/lib/basemap'
import { alpha } from './Sidebar'

/**
 * The "you are here" marker: a chevron rather than a dot, because a dot tells
 * you where you are and a chevron also tells you which way you are pointing,
 * which is the question someone actually has while navigating. White outline
 * so it survives both the cream land of the light basemap and the near-black
 * of the dark one without needing a per-theme variant.
 */
const USER_ARROW = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 48 48">
  <path d="M24 4 39 40 24 32 9 40Z" fill="#ff5555" stroke="#ffffff" stroke-width="3"
        stroke-linejoin="round"/>
</svg>`

/**
 * Popup colours per theme.
 *
 * These were hardcoded light-mode values, which meant dark mode rendered
 * near-black text on the dark popup background from globals.css, and left the
 * tag badges as bright light-grey islands. Popups are DOM, not canvas, so the
 * basemap palette does not reach them — they need their own tokens.
 *
 * `badgeText` clears 4.5:1 against `badgeBg` in both themes.
 */
const POPUP: Record<Theme, {
  title: string; body: string; muted: string; badgeBg: string; badgeText: string
}> = {
  light: {
    title:     '#111827',
    body:      '#6b7280',
    muted:     '#9ca3af',
    badgeBg:   '#f3f4f6',
    badgeText: '#374151',
  },
  dark: {
    title:     '#e6edf3',
    body:      '#9aa7b4',
    muted:     '#8390a0',
    badgeBg:   '#232d39',
    badgeText: '#cdd7e2',
  },
}

/**
 * A category marker, drawn to match the layer filter exactly.
 *
 * Same rounded tile, same single-stroke glyph, same tinted fill and hairline
 * border. The legend and the map are then literally the same object in two
 * places, which is the cheapest possible way to make one explain the other.
 *
 * The tints are composited against the panel surface rather than left
 * translucent. A 10% wash over whatever road or park happens to be underneath
 * would shift colour as you pan; flattening it first keeps every marker
 * identical to its row in the rail no matter what it is standing on.
 */
function markerSvg(iconPaths: string[], color: string, dark: boolean): string {
  // Same tile as the sidebar's LayerIcon, redrawn as a static SVG for the map.
  // One function — Sidebar's `alpha()` — computes every colour both places
  // use, so a palette change updates the rail and the map together.
  //
  //   fill    alpha(color, .16 dark / .10 light)   — the tinted square
  //   border  alpha(color, .42 dark / .30 light)   — 1 unit, matching
  //           Tailwind's default 1px `border` at the tile's 30px logical size
  //   glyph   stroke=color, fill=none, 2 units      — identical treatment,
  //           not white/ink, so the map and the rail read as one system
  //
  // rx=9 on a 30-unit tile reproduces `rounded-[9px]` at LayerIcon's default
  // size=30 exactly. The icon is centred and scaled by 16.5/24 (0.6875),
  // matching `width={size * 0.55}` on a 24×24 viewBox in LayerIcon.
  const fill   = alpha(color, dark ? 0.16 : 0.10)
  const border = alpha(color, dark ? 0.42 : 0.30)
  const glyph  = iconPaths.map((d) => `<path d="${d}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 30 30">
  <rect x="0.5" y="0.5" width="29" height="29" rx="9" fill="${fill}" stroke="${border}" stroke-width="1"/>
  <g transform="translate(15 15) scale(0.6875) translate(-12 -12)" fill="none" stroke="${color}"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    ${glyph}
  </g>
</svg>`
}

export interface MapViewProps {
  theme: Theme
  layers: Record<CategoryKey, boolean>
  geoData: GeoData
  flyTo?: { center: [number, number]; zoom: number } | null
  /** Hands the map instance up once it has loaded, so LiveLayer can draw on it. */
  onReady?: (map: maplibregl.Map) => void
  /**
   * Draw MapLibre's attribution control on the map itself.
   *
   * ODbL requires the credit to be visible wherever the map is, not merely
   * present somewhere in the product. On desktop the left rail is always on
   * screen and carries it, so the on-map chip is redundant and takes a corner
   * the zoom controls want. On narrow screens the rail is a drawer that is
   * usually closed, so the chip has to stay.
   */
  showAttribution?: boolean
  /** Current device position, or null while we have no fix. */
  userFix?: GeoFix | null
  /** Terrain / labels / POI switches from Settings. */
  mapOptions?: BasemapOptions
  /** Reports a short human place name for the current position. */
  onPlaceName?: (name: string | null) => void
}

export default function MapView({
  theme, layers, geoData, flyTo, onReady, showAttribution = true, userFix = null,
  mapOptions, onPlaceName,
}: MapViewProps) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const mapRef        = useRef<maplibregl.Map | null>(null)
  const usingFallback = useRef(false)
  const geoDataRef    = useRef(geoData)
  geoDataRef.current  = geoData
  const layersRef     = useRef(layers)
  layersRef.current   = layers
  // Click handlers are registered once on `load`, so they close over the
  // first render's theme. Read it through a ref instead, or popups keep the
  // colours the app started in.
  const themeRef      = useRef(theme)
  themeRef.current    = theme
  const optionsRef    = useRef(mapOptions)
  optionsRef.current  = mapOptions
  const userFixRef    = useRef(userFix)
  userFixRef.current  = userFix
  // Effects that reach into the map instance need to re-run once it exists;
  // a ref alone never triggers them. Flipped as soon as the instance is
  // constructed, not on `load` — controls can be added straight away, and
  // waiting for tiles would leave the attribution missing on a slow network.
  const [mapCreated, setMapCreated] = useState(false)

  // Attribution follows the breakpoint, so it is added and removed rather
  // than set once at construction.
  const attribRef = useRef<maplibregl.AttributionControl | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (showAttribution && !attribRef.current) {
      attribRef.current = new maplibregl.AttributionControl({ compact: true })
      // Top-right, not the conventional bottom-right. This control only exists
      // below `lg`, where the bottom of the map is covered by the Live/Network
      // sheet and the nav bar — an attribution nobody can see does not satisfy
      // ODbL. Top-right is empty at these widths; the status pill is top-left.
      map.addControl(attribRef.current, 'top-right')
    } else if (!showAttribution && attribRef.current) {
      map.removeControl(attribRef.current)
      attribRef.current = null
    }
  }, [showAttribution, mapCreated])

  /**
   * Registers marker artwork on demand.
   *
   * `addImage` from an SVG data URI is asynchronous — the Image has to decode
   * first. Adding the symbol layer in the same tick means it references an
   * image that does not exist yet, and MapLibre renders nothing at all rather
   * than waiting: you get bare halos and one warning in the console.
   *
   * `styleimagemissing` inverts that. The layer declares whatever name it
   * likes, MapLibre asks for the bitmap when it first needs to paint it, and
   * we answer. It also survives a style swap for free, because a new style
   * re-asks for everything it is missing.
   */
  const registerImage = useCallback((map: maplibregl.Map, id: string) => {
    if (map.hasImage(id)) return

    let svg: string | null = null
    if (id === 'user-arrow') {
      svg = USER_ARROW
    } else {
      const m = /^marker-(\w+)-(light|dark)$/.exec(id)
      if (m) {
        const key = m[1] as CategoryKey
        const meta = LAYER_BY_KEY[key]
        if (meta) svg = markerSvg(meta.iconPaths, layerColor(key, m[2] as Theme), m[2] === 'dark')
      }
    }
    if (!svg) return

    const img = new Image(128, 128)
    img.onload = () => { if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 4 }) }
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  }, [])

  /**
   * The device-position layers: an accuracy halo and the heading chevron.
   *
   * Kept separate from the facility layers and added last, so the marker sits
   * above every dot on the map. Where you are is never the thing that should
   * be occluded.
   */
  const userFeatures = (fix: GeoFix | null): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: fix
      ? [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: fix.coords },
          properties: { heading: fix.heading ?? 0 },
        }]
      : [],
  })

  const installUserLayers = useCallback((map: maplibregl.Map) => {
    if (!map.getSource('user-location')) {
      map.addSource('user-location', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
    }


    if (!map.getLayer('user-accuracy')) {
      map.addLayer({
        id: 'user-accuracy',
        type: 'circle',
        source: 'user-location',
        paint: {
          // Real metre-accurate radius needs a projection trick; at the zooms
          // this app is used at, a zoom-scaled halo reads the same and costs
          // nothing.
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 8, 14, 22, 18, 46],
          'circle-color': '#ff5555',
          'circle-opacity': 0.14,
          'circle-stroke-color': '#ff5555',
          'circle-stroke-width': 1,
          'circle-stroke-opacity': 0.35,
        },
      })
    }

    if (!map.getLayer('user-arrow')) {
      map.addLayer({
        id: 'user-arrow',
        type: 'symbol',
        source: 'user-location',
        layout: {
          'icon-image': 'user-arrow',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 16, 0.85],
          // Rotate with the map, so the chevron keeps pointing at the real
          // bearing when the map itself is rotated.
          'icon-rotation-alignment': 'map',
          'icon-rotate': ['coalesce', ['get', 'heading'], 0],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })
    }

    // A style swap rebuilds this source empty. Without replaying the last fix
    // here, the arrow vanishes the first time someone toggles the theme — or
    // silently at startup, when the raster fallback restyles the map.
    const src = map.getSource('user-location') as maplibregl.GeoJSONSource | undefined
    src?.setData(userFeatures(userFixRef.current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Turn the fix into somewhere a person recognises.
   *
   * Read out of the vector tiles that are already downloaded rather than sent
   * to a geocoder: no key, no rate limit, no third party learning where every
   * user is standing, and it keeps working on a flaky connection because the
   * answer is in tiles the map has already painted.
   *
   * Queries `place-query`, an invisible layer the style always declares, so
   * this still resolves when someone has turned labels off in Settings.
   * Returns null on the raster fallback, which has no vector source at all.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapCreated || !onPlaceName) return
    if (!userFix) { onPlaceName(null); return }

    let cancelled = false

    const resolve = () => {
      if (cancelled) return
      if (!map.getLayer('place-query')) { onPlaceName(null); return }

      let feats: maplibregl.MapGeoJSONFeature[] = []
      try {
        feats = map.queryRenderedFeatures({ layers: ['place-query'] })
      } catch { return }
      if (!feats.length) return

      // Nearest thing of each granularity, within a radius where naming it is
      // still honest: a suburb two kilometres away is where you are, a city
      // forty kilometres away is not.
      const nearest = (classes: string[], maxM: number) => {
        let best: { name: string; d: number } | null = null
        for (const f of feats) {
          const p = f.properties as Record<string, string>
          if (!p?.name || !classes.includes(p.class)) continue
          const g = f.geometry
          if (g.type !== 'Point') continue
          const d = distanceMeters(userFix.coords, g.coordinates as [number, number])
          if (d <= maxM && (!best || d < best.d)) {
            best = { name: (p['name:latin'] as string) || p.name, d }
          }
        }
        return best?.name ?? null
      }

      const local = nearest(['neighbourhood', 'suburb', 'quarter', 'hamlet'], 2500)
      const town  = nearest(['village', 'town', 'city'], 30000)
      const label = [local, town].filter(Boolean).join(', ')
      onPlaceName(label || null)
    }

    resolve()
    // Tiles stream in, so the first attempt often has nothing to work with.
    map.on('idle', resolve)
    return () => { cancelled = true; map.off('idle', resolve) }
  }, [userFix, mapCreated, onPlaceName])

  /** Push each new fix into the source. */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapCreated) return
    const src = map.getSource('user-location') as maplibregl.GeoJSONSource | undefined
    if (!src) return
    src.setData(userFeatures(userFix))
  }, [userFix, mapCreated])

  /**
   * Adds the facility sources and layers. Safe to call repeatedly: a style
   * swap (theme change, or the fallback kicking in) wipes everything the
   * style did not declare, so this runs again on every `styledata`.
   */
  const installFacilityLayers = useCallback((map: maplibregl.Map) => {
    // Slot the dots above the road network but below the place labels, so a
    // dense cluster of facilities never buries the city name underneath it.
    const before = anchorFor(map, 'overRoads')

    LAYER_META.forEach(({ key }) => {
      const color = layerColor(key, themeRef.current)
      if (map.getSource(key)) return
      const vis: 'visible' | 'none' = layersRef.current[key] ? 'visible' : 'none'

      map.addSource(key, { type: 'geojson', data: geoDataRef.current[key] })

      // Zoomed out, a glyph is smaller than the strokes it is made of, so the
      // marker degrades to a plain dot below z11 and only becomes an icon once
      // there is room to read one.
      map.addLayer({
        id: `${key}-dot`,
        type: 'circle',
        source: key,
        maxzoom: 10,
        paint: {
          'circle-radius':       ['interpolate', ['linear'], ['zoom'], 6, 3.5, 11, 6],
          'circle-color':   color,
          'circle-opacity': 0.9,
        },
        layout: { visibility: vis },
      }, before)

      // The image is registered lazily by the styleimagemissing handler below,
      // so the layer can reference it before it has finished decoding.
      const image = `marker-${key}-${themeRef.current}`

      map.addLayer({
        id: `${key}-pin`,
        type: 'symbol',
        source: key,
        minzoom: 10,
        layout: {
          'icon-image': image,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 0.78, 17, 1],
          // Every facility matters equally, so none of them get hidden by
          // collision. Allowing overlap also keeps a dense block of parking
          // legible as a cluster instead of thinning to one arbitrary pin.
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          visibility: vis,
        },
      }, before)
    })
  }, [])

  // ── Init map once on mount ─────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildBasemapStyle(theme, optionsRef.current),
      center: [-104.762, 39.51],
      zoom: 12.2,
      attributionControl: false,
    })

    // If the vector tiles are unreachable, fall back to the CartoDB raster
    // rather than leaving a blank canvas. Once is enough — retrying in a loop
    // just hammers a service that is already having a bad day.
    map.on('error', (e: any) => {
      const failedSource = e?.sourceId === 'openmaptiles' || e?.source?.id === 'openmaptiles'
      if (!failedSource || usingFallback.current) return
      usingFallback.current = true
      console.warn('[floakmap] vector basemap unavailable, using raster fallback')
      map.setStyle(rasterFallbackStyle(theme))
    })

    map.on('styleimagemissing', (e) => registerImage(map, e.id))

    // Re-add our own layers after any style swap.
    map.on('styledata', () => {
      installFacilityLayers(map)
      installUserLayers(map)
    })

    // Click handlers live on the map, not the style, so they are registered
    // once here — re-registering per styledata would stack duplicate popups.
    map.on('load', () => {
      installFacilityLayers(map)
      installUserLayers(map)

      LAYER_META.forEach(({ key }) => {
        const onClick = (e: maplibregl.MapLayerMouseEvent) => {
          if (!e.features?.length) return
          const feat   = e.features[0]
          const coords = (feat.geometry as GeoJSON.Point).coordinates as [number, number]
          const p      = feat.properties as Record<string, string | number>

          const c = POPUP[themeRef.current]

          const tagHtml = (
            [p.type, p.spaces && `${p.spaces} spaces`, p.free && `Free: ${p.free}`,
             p.network, p.ports && `${p.ports} ports`, p.level, p.hours, p.phone]
              .filter(Boolean) as string[]
          )
            .map(
              (t) =>
                `<span style="font-size:10.5px;background:${c.badgeBg};border-radius:4px;padding:2px 7px;color:${c.badgeText};white-space:nowrap">${t}</span>`,
            )
            .join('')

          new maplibregl.Popup({
            closeButton: true, maxWidth: '290px', offset: 14,
            className: themeRef.current === 'dark' ? 'floak-popup floak-popup-dark' : 'floak-popup',
          })
            .setLngLat(coords)
            .setHTML(
              `<div style="font-family:system-ui,sans-serif;line-height:1.45">
                <div class="fm-cat" style="--fm-cat:${layerColor(key, themeRef.current)}">${LAYER_LABELS[key]}</div>
                <div style="font-size:14px;font-weight:600;color:${c.title};margin-bottom:2px">${p.name}</div>
                <div style="font-size:11.5px;color:${c.body};margin-bottom:6px">${p.address}, ${p.city}, ${p.state}</div>
                ${p.notes ? `<div style="font-size:11px;color:${c.muted};margin-bottom:6px">${p.notes}</div>` : ''}
                <div style="display:flex;flex-wrap:wrap;gap:4px">${tagHtml}</div>
              </div>`,
            )
            .addTo(map)
        }

        // Both the dot and the pin are clickable: they swap at z11 and a
        // handler on only one of them makes the map stop responding at a
        // seemingly arbitrary zoom.
        ;[`${key}-dot`, `${key}-pin`].forEach((id) => {
          map.on('click', id, onClick)
          map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', id, () => { map.getCanvas().style.cursor = '' })
        })
      })

      // Live tracking layers are added on top of these, once the map exists.
      onReady?.(map)
    })

    mapRef.current = map
    setMapCreated(true)

    return () => {
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // run once

  // ── Sync theme ─────────────────────────────────────────────────────────────
  // A vector style change means setStyle, which drops every source and layer
  // we added. The styledata handler above puts the facility layers back, and
  // LiveLayer re-installs its own the same way.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.setStyle(
      usingFallback.current ? rasterFallbackStyle(theme) : buildBasemapStyle(theme, optionsRef.current),
    )
    // Settings changes (terrain, labels, POIs) alter the style's layer list,
    // so they need the same rebuild the theme does. Serialised rather than
    // passed by reference: the object is rebuilt on every settings render and
    // would otherwise re-style the map on every keystroke elsewhere.
  }, [theme, JSON.stringify(mapOptions ?? {})])

  // ── Sync layer visibility ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      ;(Object.keys(layers) as CategoryKey[]).forEach((key) => {
        const vis: 'visible' | 'none' = layers[key] ? 'visible' : 'none'
        if (map.getLayer(`${key}-dot`)) {
          map.setLayoutProperty(`${key}-dot`, 'visibility', vis)
          if (map.getLayer(`${key}-pin`)) map.setLayoutProperty(`${key}-pin`, 'visibility', vis)
        }
      })
    }
    map.loaded() ? apply() : map.once('load', apply)
  }, [layers])

  // ── Fly to city ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!flyTo) return
    mapRef.current?.flyTo({ center: flyTo.center, zoom: flyTo.zoom, speed: 1.4, curve: 1.3 })
  }, [flyTo])

  // Sized, not positioned. maplibre-gl.css sets `.maplibregl-map { position:
  // relative }` on this element, and because that stylesheet loads after
  // Tailwind's utilities it beats `.absolute` at equal specificity — leaving a
  // relatively-positioned box whose `inset-0` does nothing and whose height
  // collapses to zero. Filling the parent avoids the fight entirely.
  return <div ref={containerRef} className="h-full w-full" />
}