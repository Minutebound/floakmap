'use client';

/**
 * Draw a zone by clicking corners on the map; double-click or press Enter to
 * close it. Escape cancels, Backspace removes the last corner.
 *
 * No drawing library. maplibre-gl-draw pulls in a large dependency for a
 * polygon tool, and a polygon tool is roughly a hundred lines of click
 * handling.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import type { Geofence } from '@/lib/live-types';
import { anchorFor } from '@/lib/basemap';

interface Props {
  map: maplibregl.Map | null;
  apiBase: string;
  token: string;
  onSaved: (fence: Geofence) => void;
  onClose: () => void;
}

const DRAFT_SOURCE = 'geofence-draft';

export default function GeofenceEditor({ map, apiBase, token, onSaved, onClose }: Props) {
  const [points, setPoints] = useState<[number, number][]>([]);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;

  // draft rendering
  useEffect(() => {
    if (!map) return;
    if (!map.getSource(DRAFT_SOURCE)) {
      map.addSource(DRAFT_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      // The draft is the thing the user is manipulating, so unlike saved
      // geofences it goes above the roads rather than under them.
      const before = anchorFor(map, 'overRoads');

      map.addLayer({
        id: 'geofence-draft-fill', type: 'fill', source: DRAFT_SOURCE,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': '#7c5cff', 'fill-opacity': 0.12 },
      }, before);
      map.addLayer({
        id: 'geofence-draft-line', type: 'line', source: DRAFT_SOURCE,
        paint: { 'line-color': '#7c5cff', 'line-width': 2, 'line-dasharray': [2, 1.5] },
      }, before);
      map.addLayer({
        id: 'geofence-draft-vertex', type: 'circle', source: DRAFT_SOURCE,
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#ffffff',
          'circle-stroke-color': '#7c5cff',
          'circle-stroke-width': 2,
        },
      }, before);
    }
    map.getCanvas().style.cursor = 'crosshair';
    return () => {
      map.getCanvas().style.cursor = '';
      ['geofence-draft-fill', 'geofence-draft-line', 'geofence-draft-vertex']
        .forEach((id) => map.getLayer(id) && map.removeLayer(id));
      if (map.getSource(DRAFT_SOURCE)) map.removeSource(DRAFT_SOURCE);
    };
  }, [map]);

  useEffect(() => {
    const src = map?.getSource(DRAFT_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const features: GeoJSON.Feature[] = points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: p },
      properties: {},
    }));
    if (points.length >= 3) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[...points, points[0]]] },
        properties: {},
      });
    } else if (points.length === 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: points },
        properties: {},
      });
    }
    src.setData({ type: 'FeatureCollection', features });
  }, [map, points]);

  // map interaction
  useEffect(() => {
    if (!map) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      setPoints((prev) => [...prev, [e.lngLat.lng, e.lngLat.lat]]);
    };
    const onDouble = (e: maplibregl.MapMouseEvent) => { e.preventDefault(); };
    map.on('click', onClick);
    map.on('dblclick', onDouble);
    map.doubleClickZoom.disable();
    return () => {
      map.off('click', onClick);
      map.off('dblclick', onDouble);
      map.doubleClickZoom.enable();
    };
  }, [map]);

  const save = useCallback(async () => {
    const ring = pointsRef.current;
    if (ring.length < 3) {
      setError('A zone needs at least three corners.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/fleet/geofences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: '', org_id: '', name: name.trim() || 'Untitled zone',
          polygon: [[...ring, ring[0]]],
          trigger: 'both', dwell_minutes: 10, subject_ids: [], active: true,
          color: '#7c5cff',
        }),
      });
      if (!res.ok) throw new Error((await res.json()).detail ?? 'Could not save the zone');
      onSaved(await res.json());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the zone');
    } finally {
      setSaving(false);
    }
  }, [apiBase, token, name, onSaved, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter') save();
      if (e.key === 'Backspace') setPoints((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, save]);

  return (
    <div className="absolute left-1/2 top-4 z-20 w-[22rem] -translate-x-1/2 rounded-lg border border-neutral-200 bg-white p-4 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
      <p className="text-sm text-neutral-700 dark:text-neutral-300">
        Click the map to place corners. Press Enter to save, Backspace to undo a
        corner, Escape to cancel.
      </p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Zone name, e.g. Depot yard"
        className="mt-3 w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
      />
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs tabular-nums text-neutral-500">
          {points.length} {points.length === 1 ? 'corner' : 'corners'}
        </span>
        <button
          onClick={() => setPoints([])}
          className="ml-auto rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Clear
        </button>
        <button
          onClick={save}
          disabled={saving || points.length < 3}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {saving ? 'Saving' : 'Save zone'}
        </button>
      </div>
    </div>
  );
}