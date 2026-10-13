'use client'

import { useCallback, useEffect, useState } from 'react'
import { authApi } from '@/lib/auth-api'
import type { Session } from '@/lib/auth-types'
import { SESSION_KEY, clearSession, loadSession, saveSession } from '@/lib/session'

/**
 * The signed-in session, for components.
 *
 * `ready` is false until the first client render has read storage AND, if
 * storage had nothing valid, tried the httpOnly refresh cookie. That second
 * step is what keeps someone signed in after their access token expires (it
 * is short-lived on purpose) or after closing and reopening the tab in a
 * fresh session where localStorage was cleared but the cookie wasn't.
 */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const stored = loadSession()
    if (stored) {
      setSession(stored)
      setReady(true)
    } else {
      // No usable access token locally — see if the refresh cookie still is.
      authApi.refresh()
        .then((fresh) => {
          if (cancelled) return
          saveSession(fresh)
          setSession(fresh)
        })
        .catch(() => { /* not signed in, or the cookie expired — fine */ })
        .finally(() => { if (!cancelled) setReady(true) })
    }

    // Signing out in one tab signs out the others.
    const onStorage = (e: StorageEvent) => { if (e.key === SESSION_KEY) setSession(loadSession()) }
    window.addEventListener('storage', onStorage)
    return () => { cancelled = true; window.removeEventListener('storage', onStorage) }
  }, [])

  const signOut = useCallback(() => {
    clearSession()
    setSession(null)
    // Best-effort: revoke the refresh token server-side too. Local state is
    // already cleared either way, so a network failure here doesn't block
    // the person from appearing signed out.
    authApi.logout().catch(() => { /* already signed out locally */ })
  }, [])

  return { session, ready, signOut }
}
