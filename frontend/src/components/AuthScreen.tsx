'use client'

import clsx from 'clsx'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import Logo from '@/components/Logo'
import { authApi } from '@/lib/auth-api'
import type { AccountType } from '@/lib/auth-types'
import { useSession } from '@/hooks/useSession'
import { saveSession } from '@/lib/session'

export type AuthMode = 'login' | 'signup'

interface Props {
  initialMode: AuthMode
  initialAccount: AccountType
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal'
const FLEET_SIZES = ['1–10 vehicles', '11–50 vehicles', '51–200 vehicles', '200+ vehicles']

const COPY = {
  login: {
    individual: { heading: 'Welcome back', sub: 'Log in to your map and your nets.', submit: 'Log in', busy: 'Logging in…' },
    business:   { heading: 'Welcome back', sub: 'Log in to your organisation’s fleet.', submit: 'Log in to business', busy: 'Logging in…' },
  },
  signup: {
    individual: { heading: 'Create your account', sub: 'Find every stop and share the road with friends.', submit: 'Create personal account', busy: 'Creating account…' },
    business:   { heading: 'Set up your business', sub: 'Track vehicles and assets on one live map.', submit: 'Create business account', busy: 'Creating account…' },
  },
} as const

const SIDE = {
  individual: {
    title: 'Every stop. Everyone you’re with.',
    body: 'Parking, charging, washes, fuel and repair nearby — plus FloakNets for the people you ride with.',
  },
  business: {
    title: 'Every vehicle, live, on one map.',
    body: 'Fleet tracking, geofences and signal-lost alerts — on the same map as parking, fuel and service.',
  },
} as const

function Field({
  label, hint, children, htmlFor, aside,
}: { label: string; hint?: string; children: ReactNode; htmlFor: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink-600">{label}</label>
        {aside}
      </div>
      {children}
      {hint && <p className="text-[12.5px] text-ink-500">{hint}</p>}
    </div>
  )
}

const INPUT =
  'h-12 w-full rounded-[10px] border border-ink-200 bg-white px-3.5 text-[15px] text-ink-900 ' +
  'placeholder:text-ink-400 outline-none transition-shadow ' +
  'focus:border-signal focus:ring-4 focus:ring-signal/20'

export default function AuthScreen({ initialMode, initialAccount }: Props) {
  const router = useRouter()
  const ids = useId()
  const { session, ready, signOut } = useSession()

  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [account, setAccount] = useState<AccountType>(initialAccount)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [orgName, setOrgName] = useState('')
  const [fleetSize, setFleetSize] = useState(FLEET_SIZES[0] ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSignup = mode === 'signup'
  const isBusiness = account === 'business'
  const copy = COPY[mode][account]
  const side = SIDE[account]

  // Keep the address bar in step with the toggles so the page can be shared
  // or refreshed without losing the choice. No navigation, no remount.
  useEffect(() => {
    window.history.replaceState(null, '', `/${mode}?account=${account}`)
  }, [mode, account])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const next = isSignup
        ? await authApi.signup({
            account_type: account,
            email,
            password,
            display_name: name,
            ...(isBusiness ? { org_name: orgName, fleet_size: fleetSize } : {}),
          })
        : await authApi.login(email, password)
      saveSession(next)
      router.push('/map')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
      setBusy(false)
    }
  }

  const id = (s: string) => `${ids}-${s}`

  return (
    <div className="min-h-[100dvh] bg-ink-50 text-ink-900 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* ── Brand side (desktop) ───────────────────────────────────────── */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-ink-900 px-16 py-12 text-ink-100 lg:flex">
        <svg viewBox="0 0 600 560" preserveAspectRatio="xMidYMax slice" className="absolute inset-x-0 bottom-0 h-[58%] w-full" aria-hidden>
          <g stroke="#1a222c" strokeWidth="10" fill="none">
            <path d="M0 120 H600" /><path d="M0 360 H600" /><path d="M140 0 V560" /><path d="M420 0 V560" />
          </g>
          <path d="M0 40 L600 500" stroke="#222c37" strokeWidth="16" fill="none" />
          <g stroke="#0f141a" strokeWidth="3">
            <circle cx="230" cy="100" r="10" fill="#60a5fa" />
            <circle cx="470" cy="240" r="10" fill="#4ade80" />
            <circle cx="90" cy="290" r="10" fill="#22d3ee" />
            <circle cx="330" cy="430" r="10" fill="#fb923c" />
          </g>
          <circle cx="300" cy="260" r="54" fill="#ff5555" opacity="0.12" />
          <path d="M300 238 L316 276 L300 267 L284 276 Z" fill="#ff5555" stroke="#f5f6f8" strokeWidth="2.5" strokeLinejoin="round" />
        </svg>

        <Link href="/" className={`relative self-start rounded-md ${FOCUS}`} aria-label="FloakMap home">
          <Logo />
        </Link>
        <div className="relative mb-[40vh] flex max-w-md flex-col gap-4">
          <h2 className="font-display text-5xl font-extrabold leading-[1.02] tracking-[-0.03em] text-ink-50">{side.title}</h2>
          <p className="text-[17px] leading-relaxed text-ink-300">{side.body}</p>
        </div>
      </aside>

      {/* ── Form side ─────────────────────────────────────────────────── */}
      <main className="flex min-h-[100dvh] flex-col px-6 py-8 sm:px-10 lg:min-h-0 lg:items-center lg:justify-center">
        <Link href="/" className={`mb-10 self-start rounded-md lg:hidden ${FOCUS}`} aria-label="FloakMap home">
          <Logo tone="dark" size={28} />
        </Link>

        <div className="mx-auto flex w-full max-w-[460px] flex-col gap-7">
          {ready && session && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-100 bg-white px-4 py-3 text-sm">
              <span className="text-ink-600">
                You’re logged in as <span className="font-semibold text-ink-900">{session.display_name}</span>.
              </span>
              <span className="flex gap-3">
                <Link href="/map" className={`rounded font-semibold text-signal-700 hover:text-signal-800 ${FOCUS}`}>Open map</Link>
                <button type="button" onClick={signOut} className={`rounded font-medium text-ink-500 hover:text-ink-900 ${FOCUS}`}>Log out</button>
              </span>
            </div>
          )}

          <div role="group" aria-label="Log in or sign up" className="grid grid-cols-2 gap-1 rounded-xl bg-ink-100 p-1">
            {(['login', 'signup'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => { setMode(m); setError(null) }}
                className={clsx(
                  'h-11 rounded-[9px] text-[15px] font-semibold transition-colors',
                  FOCUS,
                  mode === m ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900',
                )}
              >
                {m === 'login' ? 'Log in' : 'Sign up'}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <h1 className="font-display text-[38px] font-extrabold leading-tight tracking-[-0.025em]">{copy.heading}</h1>
            <p className="text-[15px] text-ink-500">{copy.sub}</p>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-7">
            <fieldset className="flex flex-col gap-2.5">
              <legend className="mb-2.5 text-[13px] font-semibold text-ink-600">Account type</legend>
              <div className="grid grid-cols-2 gap-3">
                {([
                  ['individual', 'Individual', 'Drivers & friends', <path key="p" d="M4 21a8 8 0 0 1 16 0M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0" />],
                  ['business', 'Business', 'Fleets & teams', <path key="p" d="M2 16V7a1 1 0 0 1 1-1h11v10M14 10h4l4 4v2h-8M8.5 17.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0M19.5 17.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0" />],
                ] as const).map(([value, label, hint, icon]) => {
                  const on = account === value
                  return (
                    <label
                      key={value}
                      className={clsx(
                        'flex cursor-pointer flex-col items-start gap-1.5 rounded-[14px] border-2 bg-white p-4 transition-shadow',
                        'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-signal',
                        on ? 'border-signal ring-4 ring-signal/15' : 'border-ink-100 hover:border-ink-200',
                      )}
                    >
                      <input
                        type="radio"
                        name="account_type"
                        value={value}
                        checked={on}
                        onChange={() => { setAccount(value); setError(null) }}
                        className="sr-only"
                      />
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        {icon}
                      </svg>
                      <span className="text-base font-semibold">{label}</span>
                      <span className="text-[13px] leading-snug text-ink-500">{hint}</span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <div className="flex flex-col gap-4">
              {isSignup && isBusiness && (
                <Field label="Company name" htmlFor={id('org')}>
                  <input id={id('org')} className={INPUT} type="text" autoComplete="organization" required
                         value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Acme Field Services" />
                </Field>
              )}

              {isSignup && (
                <Field
                  label={isBusiness ? 'Your name' : 'Display name'}
                  htmlFor={id('name')}
                  hint="What a net host sees next to your join request."
                >
                  <input id={id('name')} className={INPUT} type="text" autoComplete="name" required maxLength={60}
                         value={name} onChange={(e) => setName(e.target.value)} placeholder="Maya Ortiz" />
                </Field>
              )}

              <Field label={isBusiness ? 'Work email' : 'Email'} htmlFor={id('email')}>
                <input id={id('email')} className={INPUT} type="email" autoComplete="email" required
                       value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </Field>

              {isSignup && isBusiness && (
                <Field label="Fleet size" htmlFor={id('fleet')}>
                  <select id={id('fleet')} className={INPUT} value={fleetSize} onChange={(e) => setFleetSize(e.target.value)}>
                    {FLEET_SIZES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
              )}

              <Field
                label="Password"
                htmlFor={id('password')}
                hint={isSignup ? 'At least 8 characters.' : undefined}
              >
                <input id={id('password')} className={INPUT} type="password" required
                       minLength={isSignup ? 8 : undefined}
                       autoComplete={isSignup ? 'new-password' : 'current-password'}
                       value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            </div>

            {error && (
              <p role="alert" className="rounded-xl border border-signal-200 bg-signal-50 px-4 py-3 text-sm text-signal-800">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-3.5">
              <button
                type="submit"
                disabled={busy}
                className={clsx(
                  'h-[52px] rounded-xl bg-signal text-base font-semibold text-ink-900 transition-colors hover:bg-signal-400 disabled:cursor-wait disabled:opacity-70',
                  FOCUS,
                )}
              >
                {busy ? copy.busy : copy.submit}
              </button>
              <p className="text-center text-sm text-ink-500">
                {isSignup ? 'Already have an account? ' : 'New to FloakMap? '}
                <button
                  type="button"
                  onClick={() => { setMode(isSignup ? 'login' : 'signup'); setError(null) }}
                  className={`rounded font-semibold text-signal-700 hover:text-signal-800 ${FOCUS}`}
                >
                  {isSignup ? 'Log in' : 'Sign up'}
                </button>
              </p>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
