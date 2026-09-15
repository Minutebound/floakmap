'use client';

/**
 * One hook owns all live state. Components read from it; nothing else talks to
 * the socket.
 *
 * State lives in a ref and is mirrored into React state on a 500 ms tick. At
 * 300 vehicles reporting every second, setState per frame would re-render the
 * whole panel tree a few hundred times a second for no visible benefit. The
 * map layer reads the ref directly and animates at 60 fps regardless, so the
 * throttle costs nothing where it would actually be noticed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LiveClient } from '@/lib/live-client';
import type {
  Alert, ConnectionState, Geofence, GeofenceEvent, LiveState, ServerFrame,
} from '@/lib/live-types';

const MIRROR_MS = 500;
const MAX_ALERTS = 100;

// Same source of truth as lib/api.ts, so one env var drives both.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface Options {
  wsUrl?: string;
  token: string | null;
  enabled?: boolean;
}

export interface LiveTracking {
  subjects: LiveState[];
  subjectsRef: React.MutableRefObject<Map<string, LiveState>>;
  geofences: Geofence[];
  alerts: Alert[];
  connection: ConnectionState;
  lastEvent: GeofenceEvent | null;
  following: string | null;
  follow: (subjectId: string | null) => void;
  setViewport: (bbox: [number, number, number, number]) => void;
  acknowledge: (alertId: string) => void;
  unreadCount: number;
}

export function useLiveTracking({ wsUrl, token, enabled = true }: Options): LiveTracking {
  const clientRef = useRef<LiveClient | null>(null);
  const subjectsRef = useRef<Map<string, LiveState>>(new Map());
  const dirty = useRef(false);

  const [subjects, setSubjects] = useState<LiveState[]>([]);
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('closed');
  const [lastEvent, setLastEvent] = useState<GeofenceEvent | null>(null);
  const [following, setFollowing] = useState<string | null>(null);

  const handleFrame = useCallback((frame: ServerFrame) => {
    switch (frame.type) {
      case 'snapshot': {
        const next = new Map<string, LiveState>();
        frame.data.subjects.forEach((s) => next.set(s.subject_id, s));
        subjectsRef.current = next;
        dirty.current = true;
        setGeofences(frame.data.geofences);
        setAlerts(frame.data.alerts);
        break;
      }
      case 'positions': {
        frame.data.forEach((s) => subjectsRef.current.set(s.subject_id, s));
        dirty.current = true;
        break;
      }
      case 'alert': {
        setAlerts((prev) => [frame.data, ...prev].slice(0, MAX_ALERTS));
        break;
      }
      case 'geofence_event': {
        setLastEvent(frame.data);
        break;
      }
      case 'subject_left': {
        subjectsRef.current.delete(frame.data.subject_id);
        dirty.current = true;
        break;
      }
      case 'error': {
        console.warn('[live]', frame.data.message);
        break;
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled || !token) return;
    const base = wsUrl ?? `${API_BASE.replace(/^http/, 'ws')}/ws/live`;

    const client = new LiveClient({
      url: base,
      token,
      onFrame: handleFrame,
      onState: setConnection,
      onGap: () => {
        // Frames were dropped. Rather than patch a map we know is wrong,
        // re-subscribe and take a fresh snapshot.
        client.send({ type: 'subscribe' });
      },
    });
    client.connect();
    clientRef.current = client;
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [enabled, token, wsUrl, handleFrame]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!dirty.current) return;
      dirty.current = false;
      setSubjects(Array.from(subjectsRef.current.values())
        .sort((a, b) => a.label.localeCompare(b.label)));
    }, MIRROR_MS);
    return () => clearInterval(id);
  }, []);

  const follow = useCallback((subjectId: string | null) => {
    setFollowing(subjectId);
    clientRef.current?.follow(subjectId);
  }, []);

  const setViewport = useCallback((bbox: [number, number, number, number]) => {
    clientRef.current?.setViewport(bbox);
  }, []);

  const acknowledge = useCallback((alertId: string) => {
    setAlerts((prev) => prev.map((a) =>
      a.id === alertId ? { ...a, acknowledged_by: 'you' } : a));
  }, []);

  const unreadCount = useMemo(
    () => alerts.filter((a) => !a.acknowledged_by).length,
    [alerts],
  );

  return {
    subjects, subjectsRef, geofences, alerts, connection,
    lastEvent, following, follow, setViewport, acknowledge, unreadCount,
  };
}

/**
 * Gets a token for the seeded demo org.
 *
 * Replace this with your real sign-in. Everything downstream only needs a
 * JWT carrying org_id and role, so swapping in an identity provider touches
 * this hook and nothing else.
 */
export function useDemoToken(
  subjectId = 'usr_maya',
  role = 'dispatcher',
): string | null {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/v1/auth/demo-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject_id: subjectId, role }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`API ${r.status}`))))
      .then((d) => { if (!cancelled) setToken(d.access_token); })
      .catch(() => console.warn('[floakmap] backend offline, live tracking disabled'));
    return () => { cancelled = true; };
  }, [subjectId, role]);

  return token;
}

/* ──────────────────────────────────────────────────────────────────────────
   Device location.

   This app is a map of things near you, so the user's own position is the
   first thing it needs, not an enhancement. The hook therefore asks on mount
   rather than waiting for a button, and reports a status the UI can act on —
   a denied permission has to surface immediately and explain itself, because
   nothing else on screen makes sense without it.

   watchPosition rather than getCurrentPosition: a stationary dot that never
   updates is worse than no dot, and the watch also gives us heading, which is
   what lets the marker point the way the person is facing.
   ────────────────────────────────────────────────────────────────────────── */

export type GeoStatus =
  | 'idle'          // not asked yet (SSR / first paint)
  | 'prompting'     // browser dialog is open, or we are waiting for a first fix
  | 'granted'       // we have a position
  | 'denied'        // the person said no, or the browser blocks it
  | 'unavailable'   // no geolocation API, or an insecure origin
  | 'error';        // timeout or position-unavailable

export interface GeoFix {
  /** [lon, lat] — GeoJSON order, ready to hand straight to MapLibre. */
  coords: [number, number];
  /** Metres. */
  accuracy: number;
  /** Degrees clockwise from true north, or null when standing still. */
  heading: number | null;
  /** Metres per second, or null. */
  speed: number | null;
  at: number;
}

export interface GeoResult {
  status: GeoStatus;
  fix: GeoFix | null;
  message: string | null;
  /** Ask again after a denial, or kick off a retry after an error. */
  request: () => void;
}

export function useGeolocation(enabled = true): GeoResult {
  const [status, setStatus] = useState<GeoStatus>('idle');
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Heading is null whenever the device is not moving, which would make the
  // arrow snap back to north every time someone stops at a light. Remember the
  // last real bearing instead.
  const lastHeading = useRef<number | null>(null);

  const request = useCallback(() => {
    setAttempt((n) => n + 1);
    setStatus('prompting');
    setMessage(null);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable');
      setMessage('This browser has no location support.');
      return;
    }
    // Chrome and Safari both refuse geolocation outside a secure context, and
    // the failure looks identical to a denial unless we say so.
    if (typeof window !== 'undefined'
        && !window.isSecureContext
        && window.location.hostname !== 'localhost') {
      setStatus('unavailable');
      setMessage('Location needs HTTPS. Open this site over a secure connection.');
      return;
    }

    setStatus((s) => (s === 'granted' ? s : 'prompting'));

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const h = pos.coords.heading;
        if (typeof h === 'number' && !Number.isNaN(h)) lastHeading.current = h;
        setFix({
          coords: [pos.coords.longitude, pos.coords.latitude],
          accuracy: pos.coords.accuracy ?? 0,
          heading: lastHeading.current,
          speed: pos.coords.speed ?? null,
          at: pos.timestamp,
        });
        setStatus('granted');
        setMessage(null);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus('denied');
          setMessage('Location is blocked for this site.');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setStatus('error');
          setMessage('No position available. Check that location services are on.');
        } else {
          setStatus('error');
          setMessage('Timed out waiting for a fix.');
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );

    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, attempt]);

  return { status, fix, message, request };
}