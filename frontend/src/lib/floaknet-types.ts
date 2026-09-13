// Mirrors backend/models/floaknet.py.

export type NetRole = 'host' | 'member' | 'viewer'
export type RequestStatus =
  | 'pending' | 'approved' | 'denied' | 'expired' | 'withdrawn'

export interface FloakNet {
  id: string
  org_id: string
  name: string
  host_subject_id: string
  code_rotated_at: string
  require_approval: boolean
  max_members: number
  default_role: NetRole
  created_at: string
  archived_at?: string | null
}

export interface NetMember {
  net_id: string
  subject_id: string
  display_name: string
  role: NetRole
  joined_at: string
  revoked_at?: string | null
  approved_by?: string | null
}

export interface PendingRequest {
  id: string
  display_name: string
  fingerprint: string
  requested_at: string
  expires_at: string
}

export interface JoinSubmitted {
  request_id: string
  net_name: string
  fingerprint: string
  claim_secret: string
  status: RequestStatus
  expires_at: string
  note: string
}

export interface ClaimResult {
  status: RequestStatus
  net_id?: string | null
  net_name?: string | null
  subject_id?: string | null
  access_token?: string | null
  role?: NetRole | null
  note?: string | null
}
