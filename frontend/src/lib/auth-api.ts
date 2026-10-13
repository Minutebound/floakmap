/**
 * Sign-up and log-in. Returns the same token the live map already uses, plus
 * enough about the person to render their name without another round trip.
 *
 * The refresh token lives in an httpOnly cookie the API sets on signup/login
 * and reads back on /refresh and /logout — every call here goes through
 * `fetch` with `credentials: 'include'` so the browser actually attaches and
 * stores it. Without that, the cookie header is silently dropped, signup
 * looks like it works but the session can never be refreshed.
 */
import type { Session, SignupInput } from './auth-types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

async function post<T>(path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('Can’t reach FloakMap right now. Check your connection and try again.')
  }

  if (!res.ok) {
    const data: { detail?: unknown } = await res.json().catch(() => ({}))
    const { detail } = data
    // FastAPI sends a string for HTTPException and a list for validation errors.
    const message =
      typeof detail === 'string' ? detail
      : Array.isArray(detail) && typeof detail[0]?.msg === 'string' ? detail[0].msg
      : `Something went wrong (${res.status}). Try again.`
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const authApi = {
  signup: (input: SignupInput) => post<Session>('/api/v1/auth/signup', input),
  login: (email: string, password: string) =>
    post<Session>('/api/v1/auth/login', { email, password }),
  /** Trades the httpOnly refresh cookie for a new access token + session. */
  refresh: () => post<Session>('/api/v1/auth/refresh'),
  /** Revokes the refresh token and clears its cookie server-side. */
  logout: () => post<void>('/api/v1/auth/logout'),
}
