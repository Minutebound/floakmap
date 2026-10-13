/**
 * Where the signed-in session lives on the client. Plain functions, no React;
 * the hook that components use is hooks/useSession.ts.
 *
 * localStorage keeps this simple and works with the existing bearer-token
 * API and websocket. Before launch, move the token into an httpOnly cookie set
 * by the API: anything in localStorage is readable by any script that runs on
 * the page.
 */
import type { Session } from './auth-types'

export const SESSION_KEY = 'floakmap.session'

/** Seconds since epoch from the JWT's `exp`, or null if it has none. */
function expiryOf(token: string): number | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    const exp = (JSON.parse(json) as { exp?: unknown }).exp
    return typeof exp === 'number' ? exp : null
  } catch {
    return null
  }
}

export function loadSession(): Session | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as Session
    const exp = expiryOf(session.access_token)
    if (exp !== null && exp * 1000 <= Date.now()) {
      window.localStorage.removeItem(SESSION_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

export function saveSession(session: Session): void {
  try { window.localStorage.setItem(SESSION_KEY, JSON.stringify(session)) } catch { /* private mode */ }
}

export function clearSession(): void {
  try { window.localStorage.removeItem(SESSION_KEY) } catch { /* private mode */ }
}
