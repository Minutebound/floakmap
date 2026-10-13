import type { GeoData } from './types'

/**
 * Demo/placeholder map data.
 *
 * Trimmed down to exactly one point per layer so it is obvious this is
 * sample data and not a real facility feed. To see how adding a new point
 * works, copy a `{ type:'Feature', ... }` entry below and paste it inside
 * the same layer's `features` array (or add it under a different layer,
 * e.g. `gas`, `ev`, `carwash`, `auto`) — each entry just needs its own
 * `coordinates: [lon, lat]` and a `name`. Delete the one you added to
 * remove it again. Once a real data source is wired up, this whole file
 * can be deleted and `SEED_DATA` replaced with that source's response.
 */
export const SEED_DATA: GeoData = {
  parking: {
    type: 'FeatureCollection',
    features: [
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7594,39.5138] }, properties:{ name:'PACE Center Parking Garage', address:'20120 E. Mainstreet', city:'Parker', state:'CO', category:'parking', type:'Garage', spaces:296, free:'Yes', ev:'10 ChargePoint + 9 EV-ready', notes:'4-story, completed Winter 2025. ADA spaces available. (Demo data point — see seed-data.ts)' } },
    ],
  },
  carwash: {
    type: 'FeatureCollection',
    features: [],
  },
  ev: {
    type: 'FeatureCollection',
    features: [],
  },
  gas: {
    type: 'FeatureCollection',
    features: [],
  },
  auto: {
    type: 'FeatureCollection',
    features: [],
  },
}
