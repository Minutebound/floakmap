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
  color: string
}

export const LAYER_META: LayerMeta[] = [
  { key: 'parking', label: 'Parking Facilities', color: '#2563eb' },
  { key: 'carwash', label: 'Car Washes',          color: '#0891b2' },
  { key: 'ev',      label: 'EV Charging',          color: '#16a34a' },
  { key: 'auto',    label: 'Auto Services',        color: '#ea580c' },
]

export const LAYER_LABELS: Record<CategoryKey, string> = {
  parking: 'Parking',
  carwash: 'Car Wash',
  ev:      'EV Charging',
  auto:    'Auto Services',
}
