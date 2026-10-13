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

const USER_ARROW = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 48 48">
  <path d="M24 4 39 40 24 32 9 40Z" fill="#ff5a61" stroke="#ffffff" stroke-width="3"
        stroke-linejoin="round"/>
</svg>`

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ))

const POPUP: Record<Theme, {
  title: string; body: string; muted: string; badgeBg: string; badgeText: string
}> = {
  light: {
    title: '#17191d',
    body: '#68707c',
    muted: '#68707c',
    badgeBg: '#eef0f3',
    badgeText: '#414852',
  },
  dark: {
    title: '#f5f6f8',
    body: '#9aa6b4',
    muted: '#9aa6b4',
    badgeBg: '#1a222c',
    badgeText: '#c8cfd8',
  },
}

/**
 * Zoom threshold for our own facility data.
 *
 * Below PIN_MINZOOM the map shows nothing of ours at all — no dot, no icon.
 * PIN_MINZOOM ≈ 14.3, which is roughly "zoomed in to 5,000 ft eye altitude"
 * (ground/eye distance halves about every one zoom level, calibrated off
 * zoom 15 ≈ 3,000 ft). Below that, every parking spot, charger and wash in
 * view would collapse into an illegible smear — it should tell you to zoom
 * in, not paint a wall of dots. Change this single constant to move the
 * reveal point.
 */
const PIN_MINZOOM = 14.3

function markerSvg(iconPaths: string[], color: string, dark: boolean): string {
  const surface = dark ? '#17202a' : '#f7f9fb'
  const border = dark ? alpha(color, 0.46) : alpha(color, 0.27)
  const glyph = iconPaths.map((d) => `<path d="${d}"/>`).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 36 36">
    <defs>
      <filter id="s" x="-35%" y="-35%" width="170%" height="180%">
        <feDropShadow dx="0" dy="1.2" stdDeviation="1.4" flood-color="#20242a" flood-opacity="0.18"/>
      </filter>
    </defs>
    <rect x="3" y="3" width="30" height="30" rx="9" fill="${surface}" stroke="#ffffff" stroke-width="3" filter="url(#s)"/>
    <rect x="4.5" y="4.5" width="27" height="27" rx="7.5" fill="${alpha(color, dark ? 0.17 : 0.09)}" stroke="${border}" stroke-width="1"/>
    <g transform="translate(18 18) scale(0.66) translate(-12 -12)" fill="none" stroke="${color}"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
  </svg>`
}

export interface MapViewProps {
  theme: Theme
  layers: Record<CategoryKey, boolean>
  geoData: GeoData
  flyTo?: { center: [number, number]; zoom: number } | null
  onReady?: (map: maplibregl.Map) => void
  showAttribution?: boolean
  userFix?: GeoFix | null
  mapOptions?: BasemapOptions
  onPlaceName?: (name: string | null) => void
}

export default function MapView({
  theme, layers, geoData, flyTo, onReady, showAttribution = true, userFix = null,
  mapOptions, onPlaceName,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const usingFallback = useRef(false)
  const geoDataRef = useRef(geoData)
  geoDataRef.current = geoData
  const layersRef = useRef(layers)
  layersRef.current = layers
  const themeRef = useRef(theme)
  themeRef.current = theme
  const optionsRef = useRef(mapOptions)
  optionsRef.current = mapOptions
  const userFixRef = useRef(userFix)
  userFixRef.current = userFix
  const selectedRef = useRef<string | null>(null)
  const [mapCreated, setMapCreated] = useState(false)

  const attribRef = useRef<maplibregl.AttributionControl | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (showAttribution && !attribRef.current) {
      attribRef.current = new maplibregl.AttributionControl({ compact: true })
      map.addControl(attribRef.current, 'top-right')
    } else if (!showAttribution && attribRef.current) {
      map.removeControl(attribRef.current)
      attribRef.current = null
    }
  }, [showAttribution, mapCreated])

  /**
   * Distance scale bar, bottom-left.
   *
   * Added once and left alone — MapLibre's ScaleControl updates its own
   * label on every render frame, so it needs no re-registration on pan,
   * zoom or style swap. Hidden on narrow screens via CSS: the bottom-left
   * corner is where the mobile Live/Network sheet lives, and a scale bar
   * fighting a drag handle for the same 44px is worse than no scale bar.
   */
  const scaleRef = useRef<maplibregl.ScaleControl | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || scaleRef.current) return
    scaleRef.current = new maplibregl.ScaleControl({ maxWidth: 120, unit: 'imperial' })
    map.addControl(scaleRef.current, 'bottom-left')
  }, [mapCreated])

  const registerImage = useCallback((map: maplibregl.Map, id: string) => {
    if (map.hasImage(id)) return

    let svg: string | null = null
    if (id === 'user-arrow') {
      svg = USER_ARROW
    } else {
      const match = /^marker-(\w+)-(light|dark)$/.exec(id)
      if (match) {
        const key = match[1] as CategoryKey
        const meta = LAYER_BY_KEY[key]
        if (meta) svg = markerSvg(meta.iconPaths, layerColor(key, match[2] as Theme), match[2] === 'dark')
      }
    }
    if (!svg) return

    const img = new Image(144, 144)
    img.onload = () => { if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 4 }) }
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  }, [])

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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 8, 14, 22, 18, 46],
          'circle-color': '#ff5a61',
          'circle-opacity': 0.14,
          'circle-stroke-color': '#ff5a61',
          'circle-stroke-width': 1,
          'circle-stroke-opacity': 0.32,
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
          'icon-rotation-alignment': 'map',
          'icon-rotate': ['coalesce', ['get', 'heading'], 0],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })
    }

    const src = map.getSource('user-location') as maplibregl.GeoJSONSource | undefined
    src?.setData(userFeatures(userFixRef.current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Restyle the basemap's surviving place labels (city and town only — see
   * basemap.ts, which no longer draws road, water, POI, shield, neighbourhood,
   * village, state or country labels at all). Every remaining label still
   * comes from the live vector tiles; this only changes face, spacing and
   * halo to match the product's own type system.
   */
  const applyPlaceTypography = useCallback((map: maplibregl.Map) => {
    const style = map.getStyle()
    if (!style?.layers || !style.glyphs) return

    for (const candidate of style.layers) {
      if (candidate.type !== 'symbol') continue
      const layer = candidate as maplibregl.SymbolLayerSpecification
      if (layer.id !== 'label-city' && layer.id !== 'label-town') continue

      const setLayout = (property: string, value: unknown) => {
        if (JSON.stringify(map.getLayoutProperty(layer.id, property)) !== JSON.stringify(value)) {
          map.setLayoutProperty(layer.id, property, value)
        }
      }
      const setPaint = (property: string, value: unknown) => {
        if (JSON.stringify(map.getPaintProperty(layer.id, property)) !== JSON.stringify(value)) {
          map.setPaintProperty(layer.id, property, value)
        }
      }

      setLayout('text-font', ['Noto Sans Bold'])
      setLayout('text-letter-spacing', 0.015)
      setPaint('text-color', themeRef.current === 'dark' ? '#e7e9ec' : '#34322f')
      setPaint('text-halo-color', themeRef.current === 'dark' ? '#151b22' : '#f4f1e9')
      setPaint('text-halo-width', 1.25)
      setPaint('text-halo-blur', 0.25)
    }
  }, [])

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
      const town = nearest(['village', 'town', 'city'], 30000)
      const label = [local, town].filter(Boolean).join(', ')
      onPlaceName(label || null)
    }

    resolve()
    map.on('idle', resolve)
    return () => { cancelled = true; map.off('idle', resolve) }
  }, [userFix, mapCreated, onPlaceName])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapCreated) return
    const src = map.getSource('user-location') as maplibregl.GeoJSONSource | undefined
    src?.setData(userFeatures(userFix))
  }, [userFix, mapCreated])

  /**
   * Facility sources and layers. Only the icon pin is drawn now — there is no
   * dot tier. The pin stays hidden below PIN_MINZOOM regardless of the layer
   * toggle in the rail — turning a layer on at a world-scale zoom should not
   * paint anything, it should tell you to zoom in.
   */
  const installFacilityLayers = useCallback((map: maplibregl.Map) => {
    const before = anchorFor(map, 'overRoads')

    LAYER_META.forEach(({ key }) => {
      if (map.getSource(key)) return
      const visibility: 'visible' | 'none' = layersRef.current[key] ? 'visible' : 'none'

      map.addSource(key, { type: 'geojson', data: geoDataRef.current[key] })

      map.addLayer({
        id: `${key}-pin`,
        type: 'symbol',
        source: key,
        minzoom: PIN_MINZOOM,
        paint: {
          'icon-opacity': ['interpolate', ['linear'], ['zoom'], PIN_MINZOOM, 0, PIN_MINZOOM + 0.4, 1],
        },
        layout: {
          'icon-image': `marker-${key}-${themeRef.current}`,
          'icon-size': ['interpolate', ['linear'], ['zoom'], PIN_MINZOOM, 0.55, PIN_MINZOOM + 3, 0.82, 17, 1],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          visibility,
        },
      }, before)
    })

    if (!map.getSource('selected-facility')) {
      map.addSource('selected-facility', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
    }
    if (!map.getLayer('selected-facility-halo')) {
      map.addLayer({
        id: 'selected-facility-halo',
        type: 'circle',
        source: 'selected-facility',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 13, 17, 18],
          'circle-color': 'rgba(255,255,255,0)',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 6,
          'circle-stroke-opacity': 0.96,
        },
      }, before)
    }
    if (!map.getLayer('selected-facility-ring')) {
      map.addLayer({
        id: 'selected-facility-ring',
        type: 'circle',
        source: 'selected-facility',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 13, 17, 18],
          'circle-color': 'rgba(255,255,255,0)',
          'circle-stroke-color': '#ff5a61',
          'circle-stroke-width': 2.5,
        },
      }, before)
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildBasemapStyle(theme, optionsRef.current),
      center: [-104.762, 39.51],
      zoom: 12.2,
      attributionControl: false,
    })

    map.on('error', (event: unknown) => {
      const e = event as { sourceId?: string; source?: { id?: string } }
      const failedSource = e?.sourceId === 'openmaptiles' || e?.source?.id === 'openmaptiles'
      if (!failedSource || usingFallback.current) return
      usingFallback.current = true
      console.warn('[floakmap] vector basemap unavailable, using raster fallback')
      map.setStyle(rasterFallbackStyle(themeRef.current))
    })

    map.on('styleimagemissing', (event) => registerImage(map, event.id))
    map.on('styledata', () => {
      installFacilityLayers(map)
      installUserLayers(map)
      applyPlaceTypography(map)
    })

    map.on('load', () => {
      installFacilityLayers(map)
      installUserLayers(map)
      applyPlaceTypography(map)

      LAYER_META.forEach(({ key }) => {
        const onClick = (event: maplibregl.MapLayerMouseEvent) => {
          if (!event.features?.length) return
          const feature = event.features[0]
          const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number]
          const p = feature.properties as Record<string, string | number>
          const c = POPUP[themeRef.current]
          const dark = themeRef.current === 'dark'
          const color = layerColor(key, themeRef.current)

          const tagHtml = (
            [p.type, p.spaces && `${p.spaces} spaces`, p.free && `Free: ${p.free}`,
             p.network, p.ports && `${p.ports} ports`, p.level, p.hours, p.phone]
              .filter(Boolean) as string[]
          ).map((tag) =>
            `<span class="floak-popup-badge" style="background:${c.badgeBg};color:${c.badgeText}">${esc(tag)}</span>`,
          ).join('')

          const glyph = LAYER_BY_KEY[key].iconPaths.map((d) => `<path d="${d}"/>`).join('')
          const tileHtml =
            `<span class="floak-popup-icon" style="color:${color};background:${alpha(color, dark ? 0.16 : 0.10)};border-color:${alpha(color, dark ? 0.42 : 0.30)}">` +
            `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg></span>`

          const popup = new maplibregl.Popup({
            closeButton: true,
            maxWidth: '300px',
            offset: 20,
            className: dark ? 'floak-popup floak-popup-dark' : 'floak-popup',
          })
            .setLngLat(coords)
            .setHTML(
              `<article class="floak-popup-card">
                <header class="floak-popup-header">
                  ${tileHtml}
                  <div class="floak-popup-heading">
                    <div class="floak-popup-kicker" style="color:${color}">${esc(LAYER_LABELS[key])}</div>
                    <div class="floak-popup-title" style="color:${c.title}">${esc(String(p.name))}</div>
                  </div>
                </header>
                <div class="floak-popup-address" style="color:${c.body}">${esc(`${p.address}, ${p.city}, ${p.state}`)}</div>
                ${tagHtml ? `<div class="floak-popup-badges">${tagHtml}</div>` : ''}
                ${p.notes ? `<div class="floak-popup-notes" style="color:${c.body};border-color:${dark ? '#293440' : '#e4e7ec'}">${esc(String(p.notes))}</div>` : ''}
              </article>`,
            )
            .addTo(map)

          const selectionKey = `${coords[0]},${coords[1]}`
          selectedRef.current = selectionKey
          const selected = map.getSource('selected-facility') as maplibregl.GeoJSONSource | undefined
          selected?.setData({
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: {} }],
          })
          popup.on('close', () => {
            if (selectedRef.current !== selectionKey) return
            selectedRef.current = null
            selected?.setData({ type: 'FeatureCollection', features: [] })
          })
        }

        const id = `${key}-pin`
        map.on('click', id, onClick)
        map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = '' })
      })

      onReady?.(map)
    })

    mapRef.current = map
    setMapCreated(true)

    return () => {
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.setStyle(
      usingFallback.current ? rasterFallbackStyle(theme) : buildBasemapStyle(theme, optionsRef.current),
    )
  }, [theme, JSON.stringify(mapOptions ?? {})])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      ;(Object.keys(layers) as CategoryKey[]).forEach((key) => {
        const visibility: 'visible' | 'none' = layers[key] ? 'visible' : 'none'
        if (map.getLayer(`${key}-pin`)) map.setLayoutProperty(`${key}-pin`, 'visibility', visibility)
      })
    }
    map.loaded() ? apply() : map.once('load', apply)
  }, [layers])

  // Keep the existing dynamic facility sources current when API data changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapCreated) return
    ;(Object.keys(geoData) as CategoryKey[]).forEach((key) => {
      const source = map.getSource(key) as maplibregl.GeoJSONSource | undefined
      source?.setData(geoData[key])
    })
  }, [geoData, mapCreated])

  useEffect(() => {
    if (!flyTo) return
    mapRef.current?.flyTo({ center: flyTo.center, zoom: flyTo.zoom, speed: 1.4, curve: 1.3 })
  }, [flyTo])

  return <div ref={containerRef} className="floak-map-canvas h-full w-full" />
}
