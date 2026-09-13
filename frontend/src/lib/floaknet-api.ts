/**
 * FloakNet client.
 *
 * Split in two on purpose. `hostApi` calls need a bearer token; `joinApi`
 * calls are made by someone who has no account yet and carry a claim secret
 * instead. Keeping them apart makes it hard to accidentally send a token to
 * an endpoint that should not need one, or forget one where it matters.
 */
import type {
  ClaimResult, FloakNet, JoinSubmitted, NetMember, PendingRequest,
} from './floaknet-types'
import type { LiveState } from './live-types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `Request failed (${res.status})`)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

/** Anyone with a code. No account, no token. */
export const joinApi = {
  ask: (code: string, displayName: string) =>
    call<JoinSubmitted>('/api/v1/nets/join', {
      method: 'POST',
      body: JSON.stringify({ code, display_name: displayName }),
    }),

  check: (requestId: string, claimSecret: string) =>
    call<ClaimResult>(
      `/api/v1/nets/requests/${requestId}?claim=${encodeURIComponent(claimSecret)}`,
    ),

  withdraw: (requestId: string, claimSecret: string) =>
    call<void>(
      `/api/v1/nets/requests/${requestId}?claim=${encodeURIComponent(claimSecret)}`,
      { method: 'DELETE' },
    ),
}

/** Members and hosts. */
export const netApi = {
  create: (token: string, name: string, requireApproval = true) =>
    call<{ net: FloakNet; join_code: string; note: string }>('/api/v1/nets', {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ name, require_approval: requireApproval }),
    }),

  mine: (token: string) =>
    call<FloakNet[]>('/api/v1/nets', { headers: auth(token) }),

  members: (token: string, netId: string) =>
    call<NetMember[]>(`/api/v1/nets/${netId}/members`, { headers: auth(token) }),

  live: (token: string, netId: string) =>
    call<LiveState[]>(`/api/v1/nets/${netId}/live`, { headers: auth(token) }),

  queue: (token: string, netId: string) =>
    call<PendingRequest[]>(`/api/v1/nets/${netId}/requests`, { headers: auth(token) }),

  approve: (token: string, netId: string, requestId: string) =>
    call<{ status: string; display_name: string; subject_id: string }>(
      `/api/v1/nets/${netId}/requests/${requestId}/approve`,
      { method: 'POST', headers: auth(token) },
    ),

  deny: (token: string, netId: string, requestId: string, note?: string) =>
    call<{ status: string; display_name: string }>(
      `/api/v1/nets/${netId}/requests/${requestId}/deny`,
      { method: 'POST', headers: auth(token), body: JSON.stringify({ note }) },
    ),

  rotateCode: (token: string, netId: string) =>
    call<{ join_code: string; note: string }>(`/api/v1/nets/${netId}/rotate-code`, {
      method: 'POST',
      headers: auth(token),
    }),

  revoke: (token: string, netId: string, subjectId: string) =>
    call<NetMember>(`/api/v1/nets/${netId}/members/${subjectId}/revoke`, {
      method: 'POST',
      headers: auth(token),
    }),
}
