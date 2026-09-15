/**
 * FloakMap basemap.
 *
 * Built rather than borrowed. The look that reads as "Felt" is a specific set
 * of choices — warm off-white land instead of grey, sage green instead of
 * saturated park green, white road fills over a warm casing so streets read as
 * ribbons rather than lines, a whisper of terrain shading under everything, and
 * labels quiet enough that your own data is the loudest thing on screen. Those
 * choices live in PALETTE below, so a new look is a new palette object and
 * nothing else.
 *
 * Tiles come from OpenFreeMap (OpenMapTiles schema, no API key, no signup).
 * That is a free public service with no SLA, so `rasterFallbackStyle` keeps the
 * old CartoDB raster ready: MapView swaps to it automatically if the vector
 * tiles fail. A map that goes blank is worse than a map that looks different.
 *
 * To move to self-hosted tiles, change VECTOR_TILES to your own TileJSON or
 * `pmtiles://` URL. Nothing else in this file needs to change — Planetiler's
 * default profile emits the same OpenMapTiles schema these filters target.
 */
import type { StyleSpecification, Map as MapLibreMap } from 'maplibre-gl'
import type { Theme } from './types'

const VECTOR_TILES = 'https://tiles.openfreemap.org/planet'
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'
const SPRITE = 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm'
const RELIEF = 'https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'
const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ' +
  '<a href="https://openfreemap.org">OpenFreeMap</a>'

/**
 * The only fontstacks the tile server has glyphs for. Any symbol layer added
 * later — vehicle labels, geofence names — must use one of these, or MapLibre
 * requests a fontstack that 404s and the text silently never appears.
 */
export const BASEMAP_FONT = ['Noto Sans Regular']
export const BASEMAP_FONT_BOLD = ['Noto Sans Bold']
export const BASEMAP_FONT_ITALIC = ['Noto Sans Italic']

/**
 * Empty layers that exist only to be passed as `beforeId`, so everything we
 * draw lands in a deliberate place in the stack instead of on top of the world.
 *
 *   underRoads — geofences, coverage polygons, anything the street network
 *                should sit on top of.
 *   overRoads  — facility dots, vehicles, trails. Above the roads so they are
 *                unmistakably ours, below the labels so place names stay
 *                readable through a cluster of markers.
 */
export const ANCHORS = {
  underRoads: 'anchor-under-roads',
  overRoads: 'anchor-over-roads',
} as const

export type AnchorName = keyof typeof ANCHORS

/**
 * Safe `beforeId` lookup. Returns undefined if the anchor is missing — mid
 * style-swap, or on a style that never declared it — and `addLayer` with an
 * undefined beforeId appends, which is the right way to degrade.
 */
export function anchorFor(map: MapLibreMap, anchor: AnchorName): string | undefined {
  const id = ANCHORS[anchor]
  return map.getLayer(id) ? id : undefined
}

interface Palette {
  land: string
  residential: string
  water: string
  waterway: string
  grass: string
  wood: string
  sand: string
  ice: string
  building: string
  buildingEdge: string
  aeroway: string
  roadFill: string
  roadCasing: string
  roadCasingMajor: string
  motorway: string
  rail: string
  boundary: string
  label: string
  labelStrong: string
  labelRoad: string
  labelHalo: string
  waterLabel: string
  shieldText: string
  /** Halo thickness in px. Dark maps need a fatter halo: light text has to
   *  survive crossing water, parks and roads of very different values. */
  haloWidth: number
  /** Opacity for the deliberately quieter label tiers (state, neighbourhood).
   *  Dimming that reads as restraint on paper reads as unreadable on black. */
  labelDim: number
  demShadow: string
  demHighlight: string
  /** Low-zoom Natural Earth relief opacity, [at z0, at z6]. */
  reliefOpacity: [number, number]
}

/**
 * Light is warm and paper-like; dark is cool and near-black so coloured
 * vehicle dots stay legible on it. Deliberately different temperatures —
 * a dark mode that is just the light palette inverted looks muddy.
 */
export const PALETTE: Record<Theme, Palette> = {
  light: {
    land: '#f7f4ee',
    residential: '#efeae1',
    water: '#b0d0e2',
    waterway: '#a6c8dc',
    grass: '#e2e9d8',
    wood: '#d6e0c8',
    sand: '#f1e8d3',
    ice: '#edf1f2',
    building: '#eae4da',
    buildingEdge: '#ddd5c8',
    aeroway: '#ebe7e0',
    roadFill: '#ffffff',
    roadCasing: '#e4dcce',
    roadCasingMajor: '#ddcdb2',
    motorway: '#fdf7ed',
    rail: '#d6cfc2',
    boundary: '#b7aea0',
    label: '#635c52',
    labelStrong: '#3b362f',
    labelRoad: '#8a8276',
    labelHalo: 'rgba(250,247,242,0.92)',
    waterLabel: '#628fa6',
    shieldText: '#4a443c',
    haloWidth: 1.5,
    labelDim: 0.85,
    demShadow: 'rgba(98,84,64,0.26)',
    demHighlight: 'rgba(255,255,255,0.12)',
    reliefOpacity: [0.5, 0.1],
  },
  dark: {
    land: '#0d1117',
    residential: '#12171e',
    water: '#0f1c26',
    waterway: '#162936',
    grass: '#111a16',
    wood: '#13201a',
    sand: '#1a1913',
    ice: '#1b2328',
    building: '#161b22',
    buildingEdge: '#1f2630',
    aeroway: '#151a21',
    roadFill: '#2b333d',
    roadCasing: '#151b22',
    roadCasingMajor: '#1d242d',
    motorway: '#3d4753',
    rail: '#222a33',
    boundary: '#39434f',
    // Label values are set by measured contrast, not by eye. Each clears 4.5:1
    // against the lightest surface it can land on — which is the motorway fill
    // (#3d4753), not the land. The previous values were fine over land and
    // effectively invisible over a highway.
    label: '#b3bfcc',        // 5.05:1 on motorway, 10.13:1 on land
    labelStrong: '#e6edf3',  // 7.99:1 on motorway
    labelRoad: '#a8b5c1',    // 4.52:1 on motorway — sits on roads by definition
    labelHalo: 'rgba(6,9,13,0.9)',
    waterLabel: '#95b8ce',   // 4.51:1 on motorway, 7.2:1 on water
    shieldText: '#e6edf3',
    haloWidth: 1.9,
    labelDim: 0.95,
    demShadow: 'rgba(0,0,0,0.45)',
    demHighlight: 'rgba(140,160,180,0.08)',
    reliefOpacity: [0.16, 0.04],
  },
}

export interface BasemapOptions {
  /** Hillshade under the map, fading out by z13. Costs one extra tile request
   *  per view below that zoom. Default true. */
  terrain?: boolean
  /** US interstate / highway / state route shields. Default true. */
  shields?: boolean
  /** OSM points of interest from z15. Off by default — the facility dots are
   *  this product's POIs and the two compete for the same screen space. */
  poi?: boolean
  /** Every text layer. Off gives a clean plate for screenshots and exports. */
  labels?: boolean
}

const DEFAULTS: Required<BasemapOptions> = {
  terrain: true,
  shields: true,
  poi: false,
  labels: true,
}

/** Zoom-interpolated value: [z, v, z, v, …]. */
const ramp = (base: number, stops: number[]): any => [
  'interpolate', ['exponential', base], ['zoom'], ...stops,
]
const linear = (stops: number[]): any => ['interpolate', ['linear'], ['zoom'], ...stops]

/** Local name first, romanised second. A bare ['get','name'] gives you Cyrillic
 *  and Han in the middle of an English UI. */
const NAME: any = ['coalesce', ['get', 'name:latin'], ['get', 'name'], ['get', 'name:en']]

/** Surface features only. Without this, tunnels draw as solid streets over the
 *  land and every hilly city gets phantom roads through its ridges. */
const SURFACE: any = ['match', ['get', 'brunnel'], ['tunnel'], false, true]

const classIs = (...classes: string[]): any => [
  'match', ['get', 'class'], classes, true, false,
]

/** Transparent placeholder used as a `beforeId` target. */
const anchorLayer = (id: string): any => ({
  id,
  type: 'background',
  paint: { 'background-color': 'rgba(0,0,0,0)', 'background-opacity': 0 },
})

export function buildBasemapStyle(
  theme: Theme,
  options: BasemapOptions = {},
): StyleSpecification {
  const c = PALETTE[theme]
  const o = { ...DEFAULTS, ...options }
  const src = 'openmaptiles'
  const layers: any[] = []

  const sources: Record<string, any> = {
    openmaptiles: { type: 'vector', url: VECTOR_TILES, attribution: ATTRIBUTION },
  }

  // ── Ground ─────────────────────────────────────────────────────────────────
  layers.push({ id: 'background', type: 'background', paint: { 'background-color': c.land } })

  if (o.terrain) {
    sources.relief = {
      type: 'raster', tiles: [RELIEF], tileSize: 256, maxzoom: 6,
      attribution: 'Natural Earth',
    }
    // Terrarium encoding, not Mapbox RGB. The style-spec default is 'mapbox',
    // and getting this wrong decodes to silently wrong elevations.
    sources.dem = {
      type: 'raster-dem', tiles: [DEM], tileSize: 256,
      encoding: 'terrarium', minzoom: 0, maxzoom: 11,
      attribution: 'AWS Terrain Tiles',
    }

    layers.push({
      id: 'relief-lowzoom', type: 'raster', source: 'relief', maxzoom: 7,
      paint: { 'raster-opacity': linear([0, c.reliefOpacity[0], 6, c.reliefOpacity[1]]) },
    })
    // Gone by z13: in-city terrain shading is just noise behind the street grid.
    layers.push({
      id: 'hillshade', type: 'hillshade', source: 'dem', minzoom: 4, maxzoom: 13,
      paint: {
        'hillshade-exaggeration': linear([4, 0.34, 11, 0.34, 13, 0]),
        'hillshade-shadow-color': c.demShadow,
        'hillshade-highlight-color': c.demHighlight,
        'hillshade-accent-color': 'rgba(0,0,0,0)',
      },
    })
  }

  // Residential wash gives cities a footprint before buildings load.
  layers.push({
    id: 'landuse-residential', type: 'fill', source: src, 'source-layer': 'landuse',
    maxzoom: 14, filter: ['==', ['get', 'class'], 'residential'],
    paint: { 'fill-color': c.residential, 'fill-opacity': linear([9, 0, 11, 0.85, 14, 0.35]) },
  })

  const cover = (id: string, classes: string[], color: string, opacity: number) =>
    layers.push({
      id, type: 'fill', source: src, 'source-layer': 'landcover',
      filter: classIs(...classes),
      paint: { 'fill-color': color, 'fill-opacity': opacity, 'fill-antialias': false },
    })

  cover('landcover-wood', ['wood', 'forest'], c.wood, 0.7)
  cover('landcover-grass', ['grass', 'farmland', 'scrub'], c.grass, 0.6)
  cover('landcover-sand', ['sand', 'beach'], c.sand, 0.85)
  cover('landcover-ice', ['ice', 'glacier'], c.ice, 0.85)

  layers.push({
    id: 'park', type: 'fill', source: src, 'source-layer': 'park',
    paint: { 'fill-color': c.grass, 'fill-opacity': 0.6 },
  })

  // ── Water ──────────────────────────────────────────────────────────────────
  layers.push({
    id: 'water', type: 'fill', source: src, 'source-layer': 'water',
    filter: ['!=', ['get', 'brunnel'], 'tunnel'],
    paint: { 'fill-color': c.water },
  })
  layers.push({
    id: 'waterway', type: 'line', source: src, 'source-layer': 'waterway', minzoom: 8,
    filter: SURFACE,
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': c.waterway, 'line-width': ramp(1.3, [9, 0.5, 14, 1.4, 18, 5]) },
  })

  // ── Airports ───────────────────────────────────────────────────────────────
  layers.push({
    id: 'aeroway-fill', type: 'fill', source: src, 'source-layer': 'aeroway', minzoom: 11,
    filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
    paint: { 'fill-color': c.aeroway },
  })
  layers.push({
    id: 'aeroway-runway', type: 'line', source: src, 'source-layer': 'aeroway', minzoom: 11,
    filter: classIs('runway', 'taxiway'),
    paint: { 'line-color': c.roadCasing, 'line-width': ramp(1.2, [11, 2, 18, 14]) },
  })

  // ── Buildings ──────────────────────────────────────────────────────────────
  // Fade in late. Below z14 they turn whole neighbourhoods into grey mush.
  layers.push({
    id: 'building', type: 'fill', source: src, 'source-layer': 'building', minzoom: 13,
    paint: {
      'fill-color': c.building,
      'fill-outline-color': c.buildingEdge,
      'fill-opacity': linear([13, 0, 15, 1]),
    },
  })

  // Overlays that belong beneath the street network go here.
  layers.push(anchorLayer(ANCHORS.underRoads))

  // ── Roads: every casing, then every fill ───────────────────────────────────
  // Interleaving casing and fill per class makes junctions look chewed. All
  // casings first, then all fills, is what gives clean intersections.
  const W = {
    motorwayCase: ramp(1.2, [5, 1.2, 8, 2.4, 12, 6, 16, 15, 20, 34]),
    majorCase: ramp(1.2, [7, 1, 12, 4.4, 16, 11, 20, 28]),
    minorCase: ramp(1.2, [12, 1.2, 14, 3.6, 16, 7.5, 20, 22]),
    serviceCase: ramp(1.2, [14, 1.2, 16, 3, 20, 12]),
    motorwayFill: ramp(1.2, [5, 0.6, 8, 1.4, 12, 4, 16, 11.5, 20, 30]),
    majorFill: ramp(1.2, [7, 0.5, 12, 2.8, 16, 8.5, 20, 24]),
    minorFill: ramp(1.2, [12, 0.5, 14, 2.2, 16, 5.2, 20, 18]),
    serviceFill: ramp(1.2, [14, 0.6, 16, 1.8, 20, 9]),
  }

  const roadLayer = (
    id: string, classes: string[], color: string, w: any,
    minzoom: number, extra: Record<string, any> = {},
  ) =>
    layers.push({
      id, type: 'line', source: src, 'source-layer': 'transportation', minzoom,
      filter: ['all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        classIs(...classes), SURFACE],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': w, ...extra },
    })

  layers.push({
    id: 'rail', type: 'line', source: src, 'source-layer': 'transportation', minzoom: 11,
    filter: ['all', classIs('rail', 'transit'), SURFACE],
    paint: {
      'line-color': c.rail,
      'line-width': ramp(1.4, [11, 0.5, 16, 1.4, 20, 2.6]),
      'line-dasharray': [3, 2],
    },
  })

  roadLayer('road-service-casing', ['service', 'track'], c.roadCasing, W.serviceCase, 14)
  roadLayer('road-minor-casing', ['minor'], c.roadCasing, W.minorCase, 11,
    { 'line-opacity': linear([11.5, 0, 12.5, 1]) })
  roadLayer('road-major-casing', ['secondary', 'tertiary'], c.roadCasing, W.majorCase, 7)
  roadLayer('road-primary-casing', ['primary', 'trunk'], c.roadCasingMajor, W.majorCase, 6)
  roadLayer('road-motorway-casing', ['motorway'], c.roadCasingMajor, W.motorwayCase, 4)

  roadLayer('road-path', ['path', 'pedestrian'], c.roadFill, ramp(1.2, [14, 0.9, 20, 6]), 14,
    { 'line-dasharray': [1.6, 1.1], 'line-opacity': 0.9 })
  roadLayer('road-service', ['service', 'track'], c.roadFill, W.serviceFill, 14)
  roadLayer('road-minor', ['minor'], c.roadFill, W.minorFill, 11,
    { 'line-opacity': linear([11.5, 0, 12.5, 1]) })
  roadLayer('road-major', ['secondary', 'tertiary'], c.roadFill, W.majorFill, 7)
  roadLayer('road-primary', ['primary', 'trunk'], c.roadFill, W.majorFill, 6)
  roadLayer('road-motorway', ['motorway'], c.motorway, W.motorwayFill, 4)

  // ── Boundaries ─────────────────────────────────────────────────────────────
  layers.push({
    id: 'boundary-subnational', type: 'line', source: src, 'source-layer': 'boundary', minzoom: 3,
    filter: ['all',
      ['>=', ['to-number', ['get', 'admin_level']], 3],
      ['<=', ['to-number', ['get', 'admin_level']], 6],
      ['!=', ['get', 'maritime'], 1]],
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': c.boundary,
      'line-width': linear([3, 0.5, 10, 1.6]),
      'line-dasharray': [3, 2.5],
      'line-opacity': 0.75,
    },
  })
  layers.push({
    id: 'boundary-country', type: 'line', source: src, 'source-layer': 'boundary',
    filter: ['all',
      ['==', ['to-number', ['get', 'admin_level']], 2],
      ['!=', ['get', 'maritime'], 1]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': c.boundary,
      'line-width': linear([2, 0.7, 6, 1.4, 12, 2.6]),
      'line-opacity': linear([0, 0.5, 4, 0.9]),
    },
  })

  // Facility dots, vehicles, trails. Above the roads, below the labels.
  layers.push(anchorLayer(ANCHORS.overRoads))

  // ── Labels ─────────────────────────────────────────────────────────────────
  // Small and warm-grey. Your vehicles should out-shout the street names.
  if (o.labels) {
    // A dark halo under light text is what separates a label from a mid-tone
    // road fill. It needs to be wider on dark than on light, where the halo is
    // doing less work.
    const halo = {
      'text-halo-color': c.labelHalo,
      'text-halo-width': theme === 'dark' ? 1.9 : 1.5,
      'text-halo-blur': theme === 'dark' ? 0.6 : 0.4,
    }

    layers.push({
      id: 'label-water', type: 'symbol', source: src, 'source-layer': 'water_name', minzoom: 6,
      filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
      layout: {
        'text-field': NAME, 'text-font': BASEMAP_FONT_ITALIC,
        'text-size': linear([6, 10, 12, 13]),
        'text-letter-spacing': 0.06, 'text-max-width': 6,
      },
      paint: { 'text-color': c.waterLabel, ...halo },
    })

    layers.push({
      id: 'label-road', type: 'symbol', source: src, 'source-layer': 'transportation_name',
      minzoom: 13,
      filter: classIs('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'),
      layout: {
        'symbol-placement': 'line',
        'text-field': NAME, 'text-font': BASEMAP_FONT,
        'text-size': linear([13, 10.5, 17, 12.5]),
        'text-rotation-alignment': 'map', 'text-padding': 3,
      },
      paint: { 'text-color': c.labelRoad, ...halo },
    })

    if (o.shields) {
      // Interstate and US route markers. The icons ship in the OpenFreeMap
      // sprite; a road whose ref is wider than the widest shield is skipped
      // rather than overflowing the badge.
      const shield = (
        id: string, networks: string[], minzoom: number, lineFrom: number,
      ) =>
        layers.push({
          id, type: 'symbol', source: src, 'source-layer': 'transportation_name', minzoom,
          filter: ['all',
            ['<=', ['to-number', ['get', 'ref_length']], 6],
            ['match', ['get', 'network'], networks, true, false]],
          layout: {
            'icon-image': ['concat', ['get', 'network'], '_', ['get', 'ref_length']],
            'icon-rotation-alignment': 'viewport',
            'symbol-placement': ['step', ['zoom'], 'point', lineFrom, 'line'],
            'symbol-spacing': 260,
            'text-field': ['to-string', ['get', 'ref']],
            'text-font': BASEMAP_FONT,
            'text-size': 9.5,
            'text-rotation-alignment': 'viewport',
          },
          paint: { 'text-color': c.shieldText },
        })

      shield('shield-us-interstate', ['us-interstate'], 7, 8)
      shield('shield-us-route', ['us-highway', 'us-state'], 9, 11)
    }

    if (o.poi) {
      layers.push({
        id: 'label-poi', type: 'symbol', source: src, 'source-layer': 'poi', minzoom: 15,
        filter: ['all',
          ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
          ['has', 'name']],
        layout: {
          // Rank drives draw order; collision detection thins out the rest.
          'symbol-sort-key': ['to-number', ['coalesce', ['get', 'rank'], 99]],
          'icon-image': ['coalesce', ['image', ['get', 'class']], ['image', 'circle_11_black']],
          'icon-size': 0.8,
          'text-field': NAME, 'text-font': BASEMAP_FONT, 'text-size': 11,
          'text-anchor': 'top', 'text-offset': [0, 0.7], 'text-max-width': 8,
          'text-optional': true, 'text-padding': 4,
        },
        paint: { 'text-color': c.label, ...halo },
      })
    }

    layers.push({
      id: 'label-airport', type: 'symbol', source: src, 'source-layer': 'aerodrome_label',
      minzoom: 11, filter: ['has', 'iata'],
      layout: {
        'text-field': NAME, 'text-font': BASEMAP_FONT, 'text-size': 11,
        'text-anchor': 'top', 'text-offset': [0, 0.6], 'text-max-width': 9,
      },
      paint: { 'text-color': c.label, ...halo },
    })

    layers.push({
      id: 'label-neighbourhood', type: 'symbol', source: src, 'source-layer': 'place', minzoom: 12,
      filter: classIs('suburb', 'neighbourhood', 'quarter'),
      layout: {
        'text-field': NAME, 'text-font': BASEMAP_FONT,
        'text-size': linear([12, 10.5, 16, 13]),
        'text-letter-spacing': 0.12, 'text-transform': 'uppercase', 'text-max-width': 8,
      },
      paint: { 'text-color': c.label, 'text-opacity': c.labelDim, ...halo },
    })

    layers.push({
      id: 'label-village', type: 'symbol', source: src, 'source-layer': 'place', minzoom: 10,
      filter: classIs('village', 'hamlet'),
      layout: {
        'text-field': NAME, 'text-font': BASEMAP_FONT,
        'text-size': linear([10, 10.5, 14, 13]),
      },
      paint: { 'text-color': c.label, ...halo },
    })

    layers.push({
      id: 'label-town', type: 'symbol', source: src, 'source-layer': 'place', minzoom: 7,
      filter: ['==', ['get', 'class'], 'town'],
      layout: {
        'text-field': NAME, 'text-font': BASEMAP_FONT,
        'text-size': linear([7, 11.5, 13, 15]), 'text-padding': 4,
      },
      paint: { 'text-color': c.labelStrong, ...halo },
    })

    layers.push({
      id: 'label-city', type: 'symbol', source: src, 'source-layer': 'place', minzoom: 3,
      filter: ['==', ['get', 'class'], 'city'],
      layout: {
        'text-field': NAME,
        'text-font': ['case',
          ['==', ['get', 'capital'], 2],
          ['literal', BASEMAP_FONT_BOLD],
          ['literal', BASEMAP_FONT]],
        'text-size': ramp(1.2, [4, 11.5, 8, 15, 13, 20]),
        'text-max-width': 8, 'text-padding': 6,
      },
      paint: { 'text-color': c.labelStrong, ...halo },
    })

    layers.push({
      id: 'label-state', type: 'symbol', source: src, 'source-layer': 'place',
      minzoom: 4, maxzoom: 8, filter: ['==', ['get', 'class'], 'state'],
      layout: {
        'text-field': NAME, 'text-font': BASEMAP_FONT,
        'text-size': linear([4, 10, 8, 13.5]),
        'text-letter-spacing': 0.18, 'text-transform': 'uppercase', 'text-max-width': 7,
      },
      paint: { 'text-color': c.label, 'text-opacity': c.labelDim, ...halo },
    })

    layers.push({
      id: 'label-country', type: 'symbol', source: src, 'source-layer': 'place', maxzoom: 9,
      filter: ['==', ['get', 'class'], 'country'],
      layout: {
        'text-field': NAME, 'text-font': BASEMAP_FONT_BOLD,
        'text-size': linear([2, 10, 6, 17]),
        'text-letter-spacing': 0.06, 'text-max-width': 6,
      },
      paint: { 'text-color': c.labelStrong, ...halo },
    })
  }

  return {
    version: 8,
    name: `FloakMap ${theme}`,
    sprite: SPRITE,
    glyphs: GLYPHS,
    sources,
    layers,
  } as StyleSpecification
}

/**
 * The original CartoDB raster basemap, kept as a safety net. MapView switches
 * to this if the vector tiles do not load. It declares the same anchors, so
 * every `addLayer(…, anchorFor(map, 'overRoads'))` call keeps working and our
 * overlays do not silently reorder themselves during an outage.
 */
const CARTO: Record<Theme, string[]> = {
  light: ['a', 'b', 'c', 'd'].map(
    (s) => `https://${s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png`,
  ),
  dark: ['a', 'b', 'c', 'd'].map(
    (s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png`,
  ),
}

export function rasterFallbackStyle(theme: Theme): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      basemap: {
        type: 'raster',
        tiles: CARTO[theme],
        tileSize: 256,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
          '© <a href="https://carto.com/attributions">CARTO</a>',
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': PALETTE[theme].land },
      },
      { id: 'basemap-tiles', type: 'raster', source: 'basemap' },
      anchorLayer(ANCHORS.underRoads),
      anchorLayer(ANCHORS.overRoads),
    ],
  } as StyleSpecification
}