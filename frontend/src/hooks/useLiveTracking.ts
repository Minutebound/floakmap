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
