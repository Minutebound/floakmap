export type CategoryKey = 'parking' | 'carwash' | 'ev' | 'auto'
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
  /** 24×24 stroke path, drawn with `fill="none" stroke="currentColor"`. */
  iconPath: string
}

export const LAYER_META: LayerMeta[] = [
  {
    key: 'parking',
    label: 'Parking',
    blurb: 'Garages, lots and street parking',
    color: { light: '#2563eb', dark: '#60a5fa' },
    iconPath: 'M9 19V5h4.2a4.4 4.4 0 0 1 0 8.8H9',
  },
  {
    key: 'carwash',
    label: 'Car washes',
    blurb: 'Automatic, self-serve and detailing',
    color: { light: '#0e7490', dark: '#22d3ee' },
    iconPath: 'M12 3.2c3 3.8 4.6 6.3 4.6 8.2a4.6 4.6 0 1 1-9.2 0c0-1.9 1.6-4.4 4.6-8.2z',
  },
  {
    key: 'ev',
    label: 'EV charging',
    blurb: 'Level 2 and DC fast charging',
    color: { light: '#15803d', dark: '#4ade80' },
    iconPath: 'M13 2.5 5 13.2h5.6L9.8 21.5 18 10.8h-5.6L13 2.5z',
  },
  {
    key: 'auto',
    label: 'Auto services',
    blurb: 'Repair, tyres and inspection',
    color: {
      light: '#c2410c',
      dark: '#fb923c',
    },
    iconPath:
      'M15.3 3.6a5 5 0 0 0-6.1 6.6L3.2 16.2 7.6 20.6l6.1-6.1a5 5 0 0 0 6.6-6.1l-3.1 3.1-2.8-.7-.7-2.8 3.1-3.1z',
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
  auto:    'Auto Services',
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