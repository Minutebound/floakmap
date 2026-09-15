'use client';

/**
 * Draws moving subjects on the existing MapLibre map.
 *
 * The one decision that matters here: positions are interpolated, not snapped.
 * A fix arrives every second or two, and a marker that jumps between them
 * reads as broken even when the data is perfect. Interpolating along the leg
 * at constant velocity -- no easing, because a van does not ease out of a
 * corner -- makes the same data read as movement.
 *
 * Everything is drawn through four GeoJSON sources updated once per animation
 * frame. Individual HTML markers would be simpler and fall over somewhere
 * around 200 vehicles; GeoJSON layers stay smooth into the thousands.
 */
import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import type { LiveState, Geofence } from '@/lib/live-types';
import { KIND_COLOR } from '@/lib/live-types';
import { anchorFor, BASEMAP_FONT } from '@/lib/basemap';

interface Props {
  map: maplibregl.Map | null;
  subjectsRef: React.MutableRefObject<Map<string, LiveState>>;
  geofences: Geofence[];
  following: string | null;
  trail?: [number, number][];
  onSelect?: (subjectId: string) => void;
}

interface Animated {
  from: [number, number];
  to: [number, number];
  startedAt: number;
  duration: number;
  state: LiveState;
}

const MIN_LEG_MS = 400;
const MAX_LEG_MS = 4000;

type FC = GeoJSON.FeatureCollection<GeoJSON.Geometry, Record<string, unknown>>;
const empty = (): FC => ({ type: 'FeatureCollection', features: [] });

/** A small triangle pointing along `heading`, sized in metres for the zoom. */
function wedge(lon: number, lat: number, heading: number, metres: number): number[][][] {
  const latRad = (lat * Math.PI) / 180;
  const dLat = metres / 111_320;
  const dLon = metres / (111_320 * Math.cos(latRad) || 1);
  const point = (bearing: number, scale: number): [number, number] => {
    const r = (bearing * Math.PI) / 180;
    return [lon + Math.sin(r) * dLon * scale, lat + Math.cos(r) * dLat * scale];
  };
  const tip = point(heading, 1);
  const left = point(heading + 140, 0.62);
  const right = point(heading - 140, 0.62);
  return [[tip, left, right, tip]];
}

export default function LiveLayer({
  map, subjectsRef, geofences, following, trail, onSelect,
}: Props) {
  const animated = useRef<Map<string, Animated>>(new Map());
  const raf = useRef<number>();

  // --- sources and layers, added once ------------------------------------
  useEffect(() => {
    if (!map) return;

    const install = () => {
      if (map.getSource('live-subjects')) return;

      // Geofences tuck under the street network; everything live sits above
      // the roads and below the place labels. See ANCHORS in lib/basemap.
      const underRoads = anchorFor(map, 'underRoads');
      const overRoads = anchorFor(map, 'overRoads');

      map.addSource('geofences', { type: 'geojson', data: empty() });
      map.addSource('live-trail', { type: 'geojson', data: empty() });
      map.addSource('live-heading', { type: 'geojson', data: empty() });
      map.addSource('live-subjects', { type: 'geojson', data: empty() });

      map.addLayer({
        id: 'geofence-fill', type: 'fill', source: 'geofences',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.08 },
      }, underRoads);
      map.addLayer({
        id: 'geofence-line', type: 'line', source: 'geofences',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 1.5,
          'line-dasharray': [3, 2],
          'line-opacity': 0.7,
        },
      }, underRoads);

      map.addLayer({
        id: 'live-trail-line', type: 'line', source: 'live-trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3,
          // Fades toward the oldest end, so the shape reads as direction.
          'line-opacity': 0.55,
          'line-blur': 0.5,
        },
      }, overRoads);

      map.addLayer({
        id: 'live-heading-wedge', type: 'fill', source: 'live-heading',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.9 },
      }, overRoads);

      map.addLayer({
        id: 'live-halo', type: 'circle', source: 'live-subjects',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 10, 16, 26],
          'circle-opacity': ['case', ['get', 'stale'], 0.06, 0.18],
        },
      }, overRoads);
      map.addLayer({
        id: 'live-dot', type: 'circle', source: 'live-subjects',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4.5, 16, 8],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': ['case', ['get', 'stale'], 0.45, 1],
          'circle-stroke-opacity': ['case', ['get', 'stale'], 0.5, 1],
        },
      }, overRoads);
      map.addLayer({
        id: 'live-label', type: 'symbol', source: 'live-subjects',
        layout: {
          'text-field': ['get', 'label'],
          // Without an explicit stack MapLibre asks for its built-in default
          // ('Open Sans Regular'), which the tile server has no glyphs for,
          // and every vehicle label silently fails to render.
          'text-font': BASEMAP_FONT,
          'text-size': 12,
          'text-offset': [0, 1.5],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': ['get', 'color'],
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
          'text-opacity': ['case', ['get', 'stale'], 0.5, 1],
        },
      });

      const click = (e: maplibregl.MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.subject_id as string | undefined;
        if (id) onSelect?.(id);
      };
      map.on('click', 'live-dot', click);
      map.on('mouseenter', 'live-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'live-dot', () => { map.getCanvas().style.cursor = ''; });
    };

    if (map.isStyleLoaded()) install();
    else map.once('load', install);

    // Re-add after a basemap swap: changing the style wipes custom layers.
    map.on('styledata', install);
    return () => { map.off('styledata', install); };
  }, [map, onSelect]);

  // --- geofences ---------------------------------------------------------
  useEffect(() => {
    const src = map?.getSource('geofences') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: geofences.map((g) => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: g.polygon },
        properties: { id: g.id, name: g.name, color: g.color },
      })),
    } as FC);
  }, [map, geofences]);

  // --- trail -------------------------------------------------------------
  useEffect(() => {
    const src = map?.getSource('live-trail') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const colour = following
      ? subjectsRef.current.get(following)?.color ?? KIND_COLOR.vehicle
      : KIND_COLOR.vehicle;
    src.setData(
      trail && trail.length > 1
        ? {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: trail },
              properties: { color: colour },
            }],
          } as FC
        : empty(),
    );
  }, [map, trail, following, subjectsRef]);

  // --- animation loop ----------------------------------------------------
  useEffect(() => {
    if (!map) return;

    const tick = () => {
      raf.current = requestAnimationFrame(tick);
      const subjectSrc = map.getSource('live-subjects') as maplibregl.GeoJSONSource | undefined;
      const headingSrc = map.getSource('live-heading') as maplibregl.GeoJSONSource | undefined;
      if (!subjectSrc || !headingSrc) return;

      const now = performance.now();

      // Fold any new fixes into the animation table.
      subjectsRef.current.forEach((state, id) => {
        const current = animated.current.get(id);
        const target: [number, number] = [state.lon, state.lat];
        if (!current) {
          animated.current.set(id, {
            from: target, to: target, startedAt: now, duration: 1, state,
          });
          return;
        }
        if (current.state.recorded_at === state.recorded_at) {
          current.state = state;
          return;
        }
        const progress = Math.min(1, (now - current.startedAt) / current.duration);
        const rendered: [number, number] = [
          current.from[0] + (current.to[0] - current.from[0]) * progress,
          current.from[1] + (current.to[1] - current.from[1]) * progress,
        ];
        // Animate over the gap the data actually had, clamped so a device
        // that was offline for an hour does not crawl across the map.
        const gap = new Date(state.recorded_at).getTime()
          - new Date(current.state.recorded_at).getTime();
        animated.current.set(id, {
          from: rendered,
          to: target,
          startedAt: now,
          duration: Math.min(Math.max(gap || MIN_LEG_MS, MIN_LEG_MS), MAX_LEG_MS),
          state,
        });
      });

      animated.current.forEach((_v, id) => {
        if (!subjectsRef.current.has(id)) animated.current.delete(id);
      });

      // Wedge size in metres, so it holds a constant on-screen size.
      const metresPerPixel =
        (156543.03392 * Math.cos((map.getCenter().lat * Math.PI) / 180))
        / 2 ** map.getZoom();
      const wedgeMetres = metresPerPixel * 16;

      const dots: GeoJSON.Feature[] = [];
      const wedges: GeoJSON.Feature[] = [];

      animated.current.forEach((a, id) => {
        const t = Math.min(1, (now - a.startedAt) / a.duration);
        const lon = a.from[0] + (a.to[0] - a.from[0]) * t;
        const lat = a.from[1] + (a.to[1] - a.from[1]) * t;
        const color = a.state.color ?? KIND_COLOR[a.state.kind];

        dots.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: {
            subject_id: id,
            label: a.state.label,
            color,
            stale: a.state.stale,
            kind: a.state.kind,
          },
        });

        if (a.state.kind !== 'person' && a.state.heading_deg != null && !a.state.stale) {
          wedges.push({
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: wedge(lon, lat, a.state.heading_deg, wedgeMetres),
            },
            properties: { color },
          });
        }
      });

      subjectSrc.setData({ type: 'FeatureCollection', features: dots } as FC);
      headingSrc.setData({ type: 'FeatureCollection', features: wedges } as FC);

      if (following) {
        const target = animated.current.get(following);
        if (target) {
          const t = Math.min(1, (now - target.startedAt) / target.duration);
          map.easeTo({
            center: [
              target.from[0] + (target.to[0] - target.from[0]) * t,
              target.from[1] + (target.to[1] - target.from[1]) * t,
            ],
            duration: 0,
          });
        }
      }
    };

    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [map, subjectsRef, following]);

  return null;
}