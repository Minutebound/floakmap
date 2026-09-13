'use client'

import 'maplibre-gl/dist/maplibre-gl.css'
import maplibregl from 'maplibre-gl'
import { useCallback, useEffect, useRef } from 'react'
import type { CategoryKey, GeoData, Theme } from '@/lib/types'
import { LAYER_META, LAYER_LABELS } from '@/lib/types'
import { buildBasemapStyle, rasterFallbackStyle } from '@/lib/basemap'

const COLORS: Record<CategoryKey, string> = Object.fromEntries(
  LAYER_META.map(({ key, color }) => [key, color]),
) as Record<CategoryKey, string>

export interface MapViewProps {
  theme: Theme
  layers: Record<CategoryKey, boolean>
  geoData: GeoData
  flyTo?: { center: [number, number]; zoom: number } | null
  /** Hands the map instance up once it has loaded, so LiveLayer can draw on it. */
  onReady?: (map: maplibregl.Map) => void
}

export default function MapView({ theme, layers, geoData, flyTo, onReady }: MapViewProps) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const mapRef        = useRef<maplibregl.Map | null>(null)
  const usingFallback = useRef(false)
  const geoDataRef    = useRef(geoData)
  geoDataRef.current  = geoData
  const layersRef     = useRef(layers)
  layersRef.current   = layers

  /**
   * Adds the facility sources and layers. Safe to call repeatedly: a style
   * swap (theme change, or the fallback kicking in) wipes everything the
   * style did not declare, so this runs again on every `styledata`.
   */
  const installFacilityLayers = useCallback((map: maplibregl.Map) => {
    LAYER_META.forEach(({ key, color }) => {
      if (map.getSource(key)) return
      const vis: 'visible' | 'none' = layersRef.current[key] ? 'visible' : 'none'

      map.addSource(key, { type: 'geojson', data: geoDataRef.current[key] })

      // Outer glow
      map.addLayer({
        id: `${key}-halo`,
        type: 'circle',
        source: key,
        paint: {
          'circle-radius':  ['interpolate', ['linear'], ['zoom'], 9, 11, 14, 18, 17, 26],
          'circle-color':   color,
          'circle-opacity': 0.18,
        },
        layout: { visibility: vis },
      })

      // Main dot
      map.addLayer({
        id: `${key}-dot`,
        type: 'circle',
        source: key,
        paint: {
          'circle-radius':       ['interpolate', ['linear'], ['zoom'], 9, 5, 14, 9, 17, 14],
          'circle-color':        color,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 14, 2.5],
          'circle-opacity':      0.93,
        },
        layout: { visibility: vis },
      })
    })
  }, [])

  // ── Init map once on mount ─────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildBasemapStyle(theme),
      center: [-104.762, 39.51],
      zoom: 12.2,
      attributionControl: false,
    })

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right',
    )

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

    // Re-add our own layers after any style swap.
    map.on('styledata', () => installFacilityLayers(map))

    // Click handlers live on the map, not the style, so they are registered
    // once here — re-registering per styledata would stack duplicate popups.
    map.on('load', () => {
      installFacilityLayers(map)

      LAYER_META.forEach(({ key, color }) => {
        map.on('click', `${key}-dot`, (e) => {
          if (!e.features?.length) return
          const feat   = e.features[0]
          const coords = (feat.geometry as GeoJSON.Point).coordinates as [number, number]
          const p      = feat.properties as Record<string, string | number>

          const tagHtml = (
            [p.type, p.spaces && `${p.spaces} spaces`, p.free && `Free: ${p.free}`,
             p.network, p.ports && `${p.ports} ports`, p.level, p.hours, p.phone]
              .filter(Boolean) as string[]
          )
            .map(
              (t) =>
                `<span style="font-size:10.5px;background:#f3f4f6;border-radius:4px;padding:2px 7px;color:#374151;white-space:nowrap">${t}</span>`,
            )
            .join('')

          new maplibregl.Popup({ closeButton: true, maxWidth: '290px', offset: 14 })
            .setLngLat(coords)
            .setHTML(
              `<div style="font-family:system-ui,sans-serif;line-height:1.45">
                <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:${color};margin-bottom:3px">${LAYER_LABELS[key]}</div>
                <div style="font-size:14px;font-weight:600;color:#111827;margin-bottom:2px">${p.name}</div>
                <div style="font-size:11.5px;color:#6b7280;margin-bottom:6px">${p.address}, ${p.city}, ${p.state}</div>
                ${p.notes ? `<div style="font-size:11px;color:#9ca3af;margin-bottom:6px">${p.notes}</div>` : ''}
                <div style="display:flex;flex-wrap:wrap;gap:4px">${tagHtml}</div>
              </div>`,
            )
            .addTo(map)
        })

        map.on('mouseenter', `${key}-dot`, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', `${key}-dot`, () => { map.getCanvas().style.cursor = '' })
      })

      // Live tracking layers are added on top of these, once the map exists.
      onReady?.(map)
    })

    mapRef.current = map

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
      usingFallback.current ? rasterFallbackStyle(theme) : buildBasemapStyle(theme),
    )
  }, [theme])

  // ── Sync layer visibility ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      ;(Object.keys(layers) as CategoryKey[]).forEach((key) => {
        const vis: 'visible' | 'none' = layers[key] ? 'visible' : 'none'
        if (map.getLayer(`${key}-dot`)) {
          map.setLayoutProperty(`${key}-dot`,  'visibility', vis)
          map.setLayoutProperty(`${key}-halo`, 'visibility', vis)
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

  return <div ref={containerRef} className="absolute inset-0" />
}
