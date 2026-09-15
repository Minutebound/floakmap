export type CategoryKey = 'parking' | 'carwash' | 'ev' | 'gas' | 'auto'
export type Theme = 'light' | 'dark'

export interface FacilityProperties {
  name: string
  address: string
  city: string
  state: string
  category: CategoryKey
  type?: string
  phone?: string
  hours?: string
  notes?: string
  spaces?: number
  free?: string
  ev?: string
  network?: string
  ports?: number
  level?: string
}

export interface GeoFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: FacilityProperties
}

export interface FeatureCollection {
  type: 'FeatureCollection'
  features: GeoFeature[]
}

export type GeoData = Record<CategoryKey, FeatureCollection>

export interface FlyTarget {
  center: [number, number]
  zoom: number
}

export interface LayerMeta {
  key: CategoryKey
  label: string
  /** One line for the Nearby list and the layer filter. */
  blurb: string
  /**
   * Category colour, per theme.
   *
   * The hues follow signage conventions people already carry around, so the
   * legend does most of its work before anyone reads it: blue for parking (the
   * international P sign is white on blue), green for EV charging, water-cyan
   * for car washes, amber for mechanical services.
   *
   * Two values rather than one because a mid-tone tuned for white paper goes
   * muddy on a near-black map. Light mode uses the 700-weight of each hue for
   * contrast against white; dark mode uses the 400-weight so the dots stay
   * bright on #0f141a.
   */
  color: Record<Theme, string>
  /**
   * 24×24 stroke paths, drawn with `fill="none" stroke="currentColor"`.
   *
   * A list rather than one string because the glyphs that actually read at
   * marker size are built from two or three separate strokes — a car under a
   * spray, a pump beside its hose — and merging those into one path forces
   * fake joins that look like smudges at 14px.
   */
  iconPaths: string[]
}

export const LAYER_META: LayerMeta[] = [
  {
    key: 'parking',
    label: 'Parking',
    blurb: 'Garages, lots and street parking',
    color: { light: '#2563eb', dark: '#60a5fa' },
    iconPaths: ['M9 19V5h4.2a4.4 4.4 0 0 1 0 8.8H9'],
  },
  {
    key: 'carwash',
    label: 'Car washes',
    blurb: 'Automatic, self-serve and detailing',
    color: { light: '#0e7490', dark: '#22d3ee' },
    // A car under a spray of water. The old lone droplet was indistinguishable
    // from any other water-related pin; the car is what makes it a car wash.
    iconPaths: [
      'M4.2 16.8 5.8 12.4A2 2 0 0 1 7.7 11h8.6a2 2 0 0 1 1.9 1.4l1.6 4.4',
      'M3.4 16.8h17.2M6.6 16.8v1.7M17.4 16.8v1.7',
      'M4 7.2c1.1-1.1 2.2-1.1 3.3 0s2.2 1.1 3.3 0 2.2-1.1 3.3 0 2.2 1.1 3.3 0 2.2-1.1 3.3 0',
    ],
  },
  {
    key: 'ev',
    label: 'EV charging',
    blurb: 'Level 2 and DC fast charging',
    color: { light: '#15803d', dark: '#4ade80' },
    iconPaths: ['M13 2.5 5 13.2h5.6L9.8 21.5 18 10.8h-5.6L13 2.5z'],
  },
  {
    key: 'gas',
    label: 'Gas stations',
    blurb: 'Fuel, diesel and air',
    // Violet, because every conventional fuel colour is taken: green reads as
    // EV here, red is the app's alert colour, and orange is auto services.
    // Distinctness beats convention when convention would collide.
    color: { light: '#7c3aed', dark: '#a78bfa' },
    iconPaths: [
      'M4.6 20V5.8A1.8 1.8 0 0 1 6.4 4h5.3a1.8 1.8 0 0 1 1.8 1.8V20',
      'M3.2 20h12.1M6.9 8.6h4.3',
      'M13.5 11.6h2.1a1.5 1.5 0 0 1 1.5 1.5v3.1a1.6 1.6 0 0 0 3.2 0V10l-2.2-2.2',
    ],
  },
  {
    key: 'auto',
    label: 'Auto services',
    blurb: 'Repair, tyres and inspection',
    color: {
      light: '#c2410c',
      dark: '#fb923c',
    },
    iconPaths: [
      'M15.3 3.6a5 5 0 0 0-6.1 6.6L3.2 16.2 7.6 20.6l6.1-6.1a5 5 0 0 0 6.6-6.1l-3.1 3.1-2.8-.7-.7-2.8 3.1-3.1z',
    ],
  },
]

/** Fast lookup by key, for the many places that have a key and need the rest. */
export const LAYER_BY_KEY: Record<CategoryKey, LayerMeta> = LAYER_META.reduce(
  (acc, meta) => { acc[meta.key] = meta; return acc },
  {} as Record<CategoryKey, LayerMeta>,
)

/** Category colour for a theme. The one place any component should get it. */
export const layerColor = (key: CategoryKey, theme: Theme): string =>
  LAYER_BY_KEY[key].color[theme]

export const LAYER_LABELS: Record<CategoryKey, string> = {
  parking: 'Parking',
  carwash: 'Car Wash',
  ev:      'EV Charging',
  gas:     'Gas Station',
  auto:    'Auto Services',
}

/* ──────────────────────────────────────────────────────────────────────────
   Where am I?

   A local nearest-city lookup, standing in for a reverse-geocoding call. It
   is deliberately shaped like the async API that will replace it — give it a
   coordinate, get back a city and a state — so swapping in Nominatim, Mapbox
   or your own Photon instance is a change inside this one function and
   nothing else moves.

   Accurate to "which metro am I in", which is all the status pill claims.
   ────────────────────────────────────────────────────────────────────────── */

interface Place { city: string; state: string; at: [number, number] }

const PLACES: Place[] = [
  { city: 'Parker',           state: 'CO', at: [-104.7614, 39.5186] },
  { city: 'Lone Tree',        state: 'CO', at: [-104.8861, 39.5511] },
  { city: 'Castle Rock',      state: 'CO', at: [-104.8561, 39.3722] },
  { city: 'Aurora',           state: 'CO', at: [-104.8319, 39.7294] },
  { city: 'Denver',           state: 'CO', at: [-104.9903, 39.7392] },
  { city: 'Boulder',          state: 'CO', at: [-105.2705, 40.0150] },
  { city: 'Colorado Springs', state: 'CO', at: [-104.8214, 38.8339] },
  { city: 'Fort Collins',     state: 'CO', at: [-105.0844, 40.5853] },
  { city: 'Albuquerque',      state: 'NM', at: [-106.6504, 35.0844] },
  { city: 'Salt Lake City',   state: 'UT', at: [-111.8910, 40.7608] },
  { city: 'Phoenix',          state: 'AZ', at: [-112.0740, 33.4484] },
  { city: 'Las Vegas',        state: 'NV', at: [-115.1398, 36.1699] },
  { city: 'Los Angeles',      state: 'CA', at: [-118.2437, 34.0522] },
  { city: 'San Francisco',    state: 'CA', at: [-122.4194, 37.7749] },
  { city: 'Seattle',          state: 'WA', at: [-122.3321, 47.6062] },
  { city: 'Portland',         state: 'OR', at: [-122.6784, 45.5152] },
  { city: 'Dallas',           state: 'TX', at: [-96.7970,  32.7767] },
  { city: 'Houston',          state: 'TX', at: [-95.3698,  29.7604] },
  { city: 'Austin',           state: 'TX', at: [-97.7431,  30.2672] },
  { city: 'Kansas City',      state: 'MO', at: [-94.5786,  39.0997] },
  { city: 'Chicago',          state: 'IL', at: [-87.6298,  41.8781] },
  { city: 'Minneapolis',      state: 'MN', at: [-93.2650,  44.9778] },
  { city: 'Atlanta',          state: 'GA', at: [-84.3880,  33.7490] },
  { city: 'Miami',            state: 'FL', at: [-80.1918,  25.7617] },
  { city: 'New York',         state: 'NY', at: [-74.0060,  40.7128] },
  { city: 'Boston',           state: 'MA', at: [-71.0589,  42.3601] },
  { city: 'Washington',       state: 'DC', at: [-77.0369,  38.9072] },
]

/** Nothing within 120 km is close enough to name honestly. */
const NAMEABLE_M = 120_000

export interface PlaceName { city: string; state: string; label: string }

export async function reverseGeocode(
  coords: [number, number],
): Promise<PlaceName | null> {
  let best: Place | null = null
  let bestD = Infinity
  for (const place of PLACES) {
    const d = distanceMeters(coords, place.at)
    if (d < bestD) { bestD = d; best = place }
  }
  if (!best || bestD > NAMEABLE_M) return null
  return { city: best.city, state: best.state, label: `${best.city}, ${best.state}` }
}

/**
 * The most useful sentence we can assemble about a facility from whatever
 * fields it happens to have. Seed rows are uneven — some carry hours, some
 * carry port counts, some only a type — so this picks the two or three facts
 * that actually distinguish one row from the next rather than printing empty
 * labels for the fields that are missing.
 */
export function describeFacility(p: FacilityProperties): string {
  const bits: string[] = []
  if (p.type) bits.push(p.type)
  if (p.spaces) bits.push(`${p.spaces} spaces`)
  if (p.ports) bits.push(`${p.ports} ports`)
  if (p.level) bits.push(p.level)
  if (p.network) bits.push(p.network)
  if (p.free) bits.push(p.free)
  if (bits.length < 2 && p.hours) bits.push(p.hours)
  if (bits.length === 0 && p.notes) return p.notes
  return bits.join(' · ')
}

/** Metres between two lon/lat points. Haversine; good enough under ~100 km. */
export function distanceMeters(
  a: [number, number], b: [number, number],
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLon = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

export type DistanceUnit = 'mi' | 'km'

export function formatDistance(meters: number, unit: DistanceUnit): string {
  if (unit === 'km') {
    return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
  }
  const feet = meters * 3.28084
  return feet < 1000 ? `${Math.round(feet)} ft` : `${(meters / 1609.34).toFixed(1)} mi`
}