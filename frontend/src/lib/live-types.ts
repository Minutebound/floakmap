// Mirrors backend/models/live.py. Keep the two in step.

export type SubjectKind = 'person' | 'vehicle' | 'asset';
export type ShareMode = 'precise' | 'approximate' | 'paused' | 'off';

export interface LiveState {
  subject_id: string;
  label: string;
  kind: SubjectKind;
  lat: number;
  lon: number;
  heading_deg?: number | null;
  speed_kmh?: number | null;
  battery_pct?: number | null;
  accuracy_m?: number | null;
  recorded_at: string;
  stale: boolean;
  share_mode: ShareMode;
  color?: string | null;
  telemetry: Record<string, unknown>;
}

export interface Geofence {
  id: string;
  org_id: string;
  name: string;
  polygon: number[][][];
  trigger: 'enter' | 'exit' | 'both' | 'dwell';
  dwell_minutes: number;
  subject_ids: string[];
  active: boolean;
  color: string;
}

export type AlertKind =
  | 'speeding' | 'idling' | 'signal_lost'
  | 'low_battery' | 'geofence' | 'off_route' | 'sos';

export interface Alert {
  id: string;
  subject_id: string;
  subject_label: string;
  kind: AlertKind;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  lat?: number | null;
  lon?: number | null;
  raised_at: string;
  acknowledged_by?: string | null;
}

export interface GeofenceEvent {
  geofence_id: string;
  geofence_name: string;
  subject_id: string;
  kind: 'enter' | 'exit' | 'dwell';
  lat: number;
  lon: number;
  occurred_at: string;
}

export type ServerFrame =
  | { type: 'snapshot'; seq: number; at: string;
      data: { subjects: LiveState[]; geofences: Geofence[]; alerts: Alert[] } }
  | { type: 'positions'; seq: number; at: string; data: LiveState[] }
  | { type: 'alert'; seq: number; at: string; data: Alert }
  | { type: 'geofence_event'; seq: number; at: string; data: GeofenceEvent }
  | { type: 'subject_left'; seq: number; at: string; data: { subject_id: string } }
  | { type: 'pong'; seq: number; at: string; data: null }
  | { type: 'error'; seq: number; at: string; data: { message: string } };

export type ConnectionState = 'connecting' | 'live' | 'retrying' | 'closed';

// Fallback palette when a subject has no colour of its own.
export const KIND_COLOR: Record<SubjectKind, string> = {
  person: '#e0507a',
  vehicle: '#2563eb',
  asset: '#64748b',
};
