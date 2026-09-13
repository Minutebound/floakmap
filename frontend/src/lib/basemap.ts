/**
 * Felt-like basemap.
 *
 * Built rather than borrowed. The look that reads as "Felt" is a specific set
 * of choices — warm off-white land instead of grey, sage green instead of
 * saturated park green, white road fills over a warm casing so streets read as
 * ribbons rather than lines, and labels quiet enough that your own data is the
 * loudest thing on screen. Those choices live in PALETTE below, so you can
 * change the whole map by editing eleven colours.
 *
 * Tiles come from OpenFreeMap (OpenMapTiles schema, no API key, no signup).
 * That is a free public service, so `RASTER_FALLBACK` keeps the old CartoDB
 * raster ready: MapView swaps to it automatically if the vector tiles fail.
 * A map that goes blank is worse than a map that looks slightly different.
 */
import type { StyleSpecification } from 'maplibre-gl'
import type { Theme } from './types'

const VECTOR_TILES = 'https://tiles.openfreemap.org/planet'
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ' +
  '<a href="https://openfreemap.org">OpenFreeMap</a>'

interface Palette {
  land: string
  water: string
  grass: string
  wood: string
  sand: string
  building: string
  buildingEdge: string
  roadFill: string
  roadCasing: string
  motorway: string
  rail: string
  boundary: string
  label: string
  labelHalo: string
  waterLabel: string
}

/**
 * Light is warm and paper-like; dark is cool and near-black so coloured
 * vehicle dots stay legible on it. Deliberately different temperatures —
 * a dark mode that is just the light palette inverted looks muddy.
 */
export const PALETTE: Record<Theme, Palette> = {
  light: {
    land:         '#f6f2ea',
    water:        '#b4d2e0',
    grass:        '#e0e7d5',
    wood:         '#d3dfc4',
    sand:         '#f0e7d2',
    building:     '#ece6dc',
    buildingEdge: '#ded6c9',
    roadFill:     '#ffffff',
    roadCasing:   '#e3dbcd',
    motorway:     '#fdf3e0',
    rail:         '#d8d1c4',
    boundary:     '#c7bfb1',
    label:        '#6b6358',
    labelHalo:    '#f9f6f0',
    waterLabel:   '#6d94a8',
  },
  dark: {
    land:         '#0d1117',
    water:        '#101d28',
    grass:        '#121a15',
    wood:         '#14201a',
    sand:         '#1a1913',
    building:     '#161b22',
    buildingEdge: '#1f2630',
    roadFill:     '#272e38',
    roadCasing:   '#161b22',
    motorway:     '#39424f',
    rail:         '#232a33',
    boundary:     '#2c3440',
    label:        '#8b939d',
    labelHalo:    '#0d1117',
    waterLabel:   '#5d7f93',
  },
}

const FONT = ['Noto Sans Regular']
const FONT_BOLD = ['Noto Sans Bold']

/** Zoom-interpolated line width: [z, w, z, w, …]. */
const width = (stops: number[]): any => [
  'interpolate', ['exponential', 1.4], ['zoom'], ...stops,
]

export function buildBasemapStyle(theme: Theme): StyleSpecification {
  const c = PALETTE[theme]

  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      openmaptiles: { type: 'vector', url: VECTOR_TILES, attribution: ATTRIBUTION },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': c.land } },

      // ── Land cover ────────────────────────────────────────────────────────
      {
        id: 'landcover-wood',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'wood'],
        paint: { 'fill-color': c.wood, 'fill-opacity': 0.7 },
      },
      {
        id: 'landcover-grass',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['grass', 'farmland', 'scrub']]],
        paint: { 'fill-color': c.grass, 'fill-opacity': 0.6 },
      },
      {
        id: 'landcover-sand',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['sand', 'beach']]],
        paint: { 'fill-color': c.sand },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'park',
        paint: { 'fill-color': c.grass, 'fill-opacity': 0.55 },
      },

      // ── Water ─────────────────────────────────────────────────────────────
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: { 'fill-color': c.water },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        minzoom: 8,
        paint: { 'line-color': c.water, 'line-width': width([9, 0.6, 16, 3]) },
      },

      // ── Buildings ─────────────────────────────────────────────────────────
      // Fade in late. Below z14 they turn whole neighbourhoods into grey mush.
      {
        id: 'building',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 13,
        paint: {
          'fill-color': c.building,
          'fill-outline-color': c.buildingEdge,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 1],
        },
      },

      // ── Roads: casing beneath, fill on top ────────────────────────────────
      {
        id: 'road-rail',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'rail'],
        minzoom: 11,
        paint: {
          'line-color': c.rail,
          'line-width': width([11, 0.5, 16, 2]),
          'line-dasharray': [3, 2],
        },
      },
      {
        id: 'road-minor-casing',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'track']]],
        minzoom: 12,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.roadCasing, 'line-width': width([12, 1.4, 18, 14]) },
      },
      {
        id: 'road-major-casing',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'tertiary', 'trunk']]],
        minzoom: 7,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.roadCasing, 'line-width': width([7, 1.2, 12, 4, 18, 24]) },
      },
      {
        id: 'road-motorway-casing',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'motorway'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.roadCasing, 'line-width': width([5, 1.4, 12, 6, 18, 30]) },
      },
      {
        id: 'road-minor',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'track']]],
        minzoom: 12,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.roadFill, 'line-width': width([12, 0.6, 18, 11]) },
      },
      {
        id: 'road-major',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'tertiary', 'trunk']]],
        minzoom: 7,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.roadFill, 'line-width': width([7, 0.5, 12, 2.4, 18, 20]) },
      },
      {
        id: 'road-motorway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'motorway'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.motorway, 'line-width': width([5, 0.7, 12, 4, 18, 26]) },
      },
      {
        id: 'road-path',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['path', 'pedestrian']]],
        minzoom: 14,
        paint: {
          'line-color': c.roadCasing,
          'line-width': width([14, 0.6, 18, 2.5]),
          'line-dasharray': [2, 2],
        },
      },

      // ── Boundaries ────────────────────────────────────────────────────────
      {
        id: 'boundary-state',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        filter: ['==', ['get', 'admin_level'], 4],
        minzoom: 3,
        paint: {
          'line-color': c.boundary,
          'line-width': width([3, 0.5, 10, 1.6]),
          'line-dasharray': [4, 3],
        },
      },
      {
        id: 'boundary-country',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        filter: ['<=', ['get', 'admin_level'], 2],
        paint: { 'line-color': c.boundary, 'line-width': width([2, 0.7, 10, 2.2]) },
      },

      // ── Labels ────────────────────────────────────────────────────────────
      // Small and warm-grey. Your vehicles should out-shout the street names.
      {
        id: 'label-water',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'water_name',
        minzoom: 9,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': 11,
          'text-letter-spacing': 0.1,
        },
        paint: {
          'text-color': c.waterLabel,
          'text-halo-color': c.labelHalo,
          'text-halo-width': 1,
        },
      },
      {
        id: 'label-road',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        minzoom: 13,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': 10.5,
          'symbol-placement': 'line',
          'text-letter-spacing': 0.02,
        },
        paint: {
          'text-color': c.label,
          'text-halo-color': c.labelHalo,
          'text-halo-width': 1.6,
        },
      },
      {
        id: 'label-place-minor',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        filter: ['in', ['get', 'class'], ['literal', ['suburb', 'neighbourhood', 'village', 'hamlet']]],
        minzoom: 11,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': 11,
          'text-letter-spacing': 0.06,
        },
        paint: {
          'text-color': c.label,
          'text-halo-color': c.labelHalo,
          'text-halo-width': 1.6,
        },
      },
      {
        id: 'label-place-major',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT_BOLD,
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 12, 16],
          'text-letter-spacing': 0.04,
        },
        paint: {
          'text-color': c.label,
          'text-halo-color': c.labelHalo,
          'text-halo-width': 1.8,
        },
      },
    ],
  } as StyleSpecification
}

/**
 * The original CartoDB raster basemap, kept as a safety net. MapView switches
 * to this if the vector tiles do not load.
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
        paint: { 'background-color': theme === 'dark' ? '#0d1117' : '#ddd9d0' },
      },
      { id: 'basemap-tiles', type: 'raster', source: 'basemap' },
    ],
  }
}
