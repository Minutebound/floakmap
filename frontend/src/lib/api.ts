import type { FeatureCollection, CategoryKey, GeoData } from './types'
import { SEED_DATA } from './seed-data'

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

/** Fetch GeoJSON for one category from the FastAPI backend. */
export async function fetchCategory(
  category: CategoryKey,
  city?: string,
  state?: string,
): Promise<FeatureCollection> {
  const params = new URLSearchParams({ category })
  if (city)  params.set('city', city)
  if (state) params.set('state', state)

  const res = await fetch(`${API_BASE}/api/v1/facilities?${params}`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json() as Promise<FeatureCollection>
}

/**
 * Load all 4 categories.
 * Falls back to bundled seed data if the backend is unreachable.
 */
export async function fetchAllCategories(
  city?: string,
  state?: string,
): Promise<GeoData> {
  try {
    const keys: CategoryKey[] = ['parking', 'carwash', 'ev', 'auto']
    const results = await Promise.all(
      keys.map((k) => fetchCategory(k, city, state)),
    )
    return Object.fromEntries(
      keys.map((k, i) => [k, results[i]]),
    ) as GeoData
  } catch {
    // Backend offline — use bundled seed data
    console.warn('[floakmap] API unreachable, using seed data')
    return SEED_DATA
  }
}
