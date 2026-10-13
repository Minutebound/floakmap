import Link from 'next/link'
import type { ReactNode } from 'react'
import Logo from '@/components/Logo'
import MapIllustration from '@/components/MapIllustration'
import { LAYER_META } from '@/lib/types'

/**
 * Landing page. A server component: nothing here needs the browser, so it
 * ships as HTML and the map app's bundle stays on /map.
 */

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal'

const SIGNUP_INDIVIDUAL = '/signup?account=individual'
const SIGNUP_BUSINESS = '/signup?account=business'

function Eyebrow({ children, tone = 'dark' }: { children: ReactNode; tone?: 'dark' | 'light' }) {
  return (
    <p className={`font-mono text-[12.5px] tracking-[0.14em] ${tone === 'dark' ? 'text-signal-400' : 'text-signal-700'}`}>
      {children}
    </p>
  )
}

function Check({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <svg className="mt-1 h-4 w-4 flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
      <span>{children}</span>
    </li>
  )
}

const IconPerson = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
)

const IconTruck = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M2 16V7a1 1 0 0 1 1-1h11v10" /><path d="M14 10h4l4 4v2h-8" />
    <circle cx="6.5" cy="17.5" r="2" /><circle cx="17.5" cy="17.5" r="2" />
  </svg>
)

const FLEET = [
  { name: 'Service 9', color: '#c026d3', status: 'Signal lost', alert: true },
  { name: 'Van 12', color: '#2563eb', status: 'Moving · NE' },
  { name: 'Van 14', color: '#0891b2', status: 'In Depot yard' },
  { name: 'Flatbed 3', color: '#ea580c', status: 'Moving · S' },
  { name: 'Service 7', color: '#16a34a', status: 'Parked' },
  { name: 'Trailer B', color: '#64748b', status: 'Asset · stationary' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-900/90 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-[1440px] items-center justify-between gap-6 px-6 lg:px-20">
          <Link href="/" className={`rounded-md ${FOCUS}`} aria-label="FloakMap home">
            <Logo />
          </Link>
          <nav aria-label="Sections" className="hidden items-center gap-9 text-[15px] md:flex">
            <a href="#layers" className={`rounded text-ink-200 hover:text-ink-50 ${FOCUS}`}>The map</a>
            <a href="#floaknet" className={`rounded text-ink-200 hover:text-ink-50 ${FOCUS}`}>FloakNet</a>
            <a href="#business" className={`rounded text-ink-200 hover:text-ink-50 ${FOCUS}`}>For business</a>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/login" className={`flex h-11 items-center rounded-[10px] px-4 text-[15px] font-medium text-ink-50 hover:bg-ink-800 ${FOCUS}`}>
              Log in
            </Link>
            <Link href={SIGNUP_INDIVIDUAL} className={`flex h-11 items-center rounded-[10px] bg-signal px-5 text-[15px] font-semibold text-ink-900 hover:bg-signal-400 ${FOCUS}`}>
              Sign up
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ── Hero ────────────────────────────────────────────────────── */}
        <section className="mx-auto grid max-w-[1440px] gap-14 px-6 pb-24 pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)] lg:gap-[72px] lg:px-20 lg:pt-[88px]">
          <div className="flex flex-col gap-7">
            <Eyebrow tone="dark">
              <span className="text-ink-300">PARKING · CAR WASH · EV · FUEL · AUTO SERVICE</span>
            </Eyebrow>
            <h1 className="font-display text-5xl font-extrabold leading-[0.98] tracking-[-0.035em] text-ink-50 sm:text-6xl xl:text-[76px]">
              Every stop your car needs. Everyone you’re driving with.
            </h1>
            <p className="max-w-[540px] text-lg leading-relaxed text-ink-300 sm:text-[19px]">
              FloakMap puts parking, charging, washes, fuel and repair on one live map — then
              shows the people and vehicles you care about moving on it, in real time.
            </p>

            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Link href={SIGNUP_INDIVIDUAL} className={`group flex flex-col gap-3.5 rounded-2xl border border-ink-700 bg-ink-850 p-[22px] transition-colors hover:border-signal ${FOCUS}`}>
                <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-signal text-ink-900">{IconPerson}</span>
                <span className="flex flex-col gap-1">
                  <span className="font-display text-[21px] font-bold text-ink-50">Individual</span>
                  <span className="text-sm leading-snug text-ink-300">For drivers, commuters and road trips with friends.</span>
                </span>
                <span className="text-[14.5px] font-semibold text-signal-400">Create personal account →</span>
              </Link>
              <Link href={SIGNUP_BUSINESS} className={`group flex flex-col gap-3.5 rounded-2xl border border-ink-700 bg-ink-850 p-[22px] transition-colors hover:border-ink-200 ${FOCUS}`}>
                <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-ink-50 text-ink-900">{IconTruck}</span>
                <span className="flex flex-col gap-1">
                  <span className="font-display text-[21px] font-bold text-ink-50">Business</span>
                  <span className="text-sm leading-snug text-ink-300">For fleets, field teams and anything with a tracker.</span>
                </span>
                <span className="text-[14.5px] font-semibold text-signal-400">Set up business account →</span>
              </Link>
            </div>

            <p className="text-[14.5px] text-ink-300">
              Already have an account?{' '}
              <Link href="/login" className={`rounded font-semibold text-signal-400 hover:text-signal-300 ${FOCUS}`}>Log in</Link>
              <span className="mx-2 text-ink-600" aria-hidden>|</span>
              <Link href="/map" className={`rounded font-semibold text-ink-100 hover:text-ink-50 ${FOCUS}`}>Try the map without an account</Link>
            </p>
          </div>

          <MapIllustration />
        </section>

        {/* ── Layers ──────────────────────────────────────────────────── */}
        <section id="layers" className="scroll-mt-20 bg-ink-50 text-ink-900">
          <div className="mx-auto flex max-w-[1440px] flex-col gap-12 px-6 py-20 lg:px-20 lg:py-[100px]">
            <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end lg:gap-12">
              <h2 className="max-w-[640px] font-display text-4xl font-extrabold leading-none tracking-[-0.03em] sm:text-[56px]">
                Five layers. Switch on what you need.
              </h2>
              <p className="max-w-[460px] text-[17px] leading-relaxed text-ink-500">
                Search any city or ZIP, then toggle the layers that matter today. Colours follow the
                signs you already know — blue for parking, green for charging.
              </p>
            </div>

            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {LAYER_META.map((layer) => (
                <li key={layer.key} className="flex flex-col gap-10 rounded-2xl border border-ink-100 bg-white p-6">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: layer.color.light }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      {layer.iconPaths.map((d) => <path key={d} d={d} />)}
                    </svg>
                  </span>
                  <div className="flex flex-col gap-1.5">
                    <h3 className="text-lg font-semibold">{layer.label}</h3>
                    <p className="text-sm leading-normal text-ink-500">{layer.blurb}</p>
                  </div>
                </li>
              ))}
            </ul>

            <ul className="flex flex-col gap-3 text-[15px] text-ink-700 md:flex-row md:gap-10">
              {[
                'Nearby list sorted from where you stand',
                'Phone numbers and opening hours on every pin',
                'Dark mode that recolours the map itself',
              ].map((item) => (
                <li key={item} className="flex items-center gap-2.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-signal-600" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── FloakNet ────────────────────────────────────────────────── */}
        <section id="floaknet" className="mx-auto grid max-w-[1440px] scroll-mt-20 items-center gap-16 px-6 py-24 lg:grid-cols-[620px_minmax(0,1fr)] lg:gap-24 lg:px-20 lg:py-[110px]">
          <div className="flex flex-col gap-9">
            <Eyebrow>FLOAKNET</Eyebrow>
            <h2 className="font-display text-4xl font-extrabold leading-none tracking-[-0.03em] text-ink-50 sm:text-6xl">
              Host a net. Share a code. Watch your crew roll in.
            </h2>
            <ol className="border-t border-ink-700">
              {[
                ['Host', 'Start a net for a road trip, a convoy or a night out and get a join code.'],
                ['Join', 'Friends enter the code and their name. Nothing is shared until you say yes.'],
                ['Verify & go live', 'They read their fingerprint aloud, you check it matches, approve — and the map narrows to just your group.'],
              ].map(([title, body], i) => (
                <li key={title} className="flex gap-6 border-b border-ink-700 py-[22px]">
                  <span className="w-7 flex-none font-mono text-sm text-signal-400">{String(i + 1).padStart(2, '0')}</span>
                  <div className="flex flex-col gap-1.5">
                    <h3 className="text-[19px] font-semibold text-ink-50">{title}</h3>
                    <p className="text-[15.5px] leading-normal text-ink-300">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col gap-4" aria-label="Example of a join request">
            <div className="flex flex-col gap-[18px] rounded-[20px] border border-ink-700 bg-ink-850 p-6 sm:p-7">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] font-semibold text-ink-50">Weekend in Parker</span>
                <span className="rounded-full bg-ink-700 px-2.5 py-1 text-[12.5px] text-ink-200">You’re hosting</span>
              </div>
              <p className="text-[13.5px] leading-normal text-ink-300">
                Ask them to read their fingerprint aloud and check it matches before you approve.
              </p>
              <div className="rounded-xl border border-[#222c37] bg-ink-900 p-4 text-center font-mono text-xl tracking-[0.18em] text-signal-300 sm:text-[26px]">
                JMR-NSH-V7V
              </div>
              <p className="text-[15px] text-ink-300">
                says they are <span className="font-semibold text-ink-50">Dev</span>
              </p>
              <div className="grid grid-cols-2 gap-3" aria-hidden>
                <span className="flex h-12 items-center justify-center rounded-[10px] bg-signal text-[15px] font-semibold text-ink-900">Approve</span>
                <span className="flex h-12 items-center justify-center rounded-[10px] border border-ink-700 text-[15px] font-medium text-ink-100">Decline</span>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 rounded-2xl border border-ink-700 bg-ink-850 p-5">
                <span className="text-[15px] font-semibold text-ink-50">Codes stored hashed</span>
                <span className="text-[13.5px] leading-normal text-ink-300">Rotate yours any time to shut the door.</span>
              </div>
              <div className="flex flex-col gap-1.5 rounded-2xl border border-ink-700 bg-ink-850 p-5">
                <span className="text-[15px] font-semibold text-ink-50">Requests expire</span>
                <span className="text-[13.5px] leading-normal text-ink-300">Unanswered join requests time out on their own.</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Business ────────────────────────────────────────────────── */}
        <section id="business" className="scroll-mt-20 bg-ink-50 text-ink-900">
          <div className="mx-auto grid max-w-[1440px] items-center gap-16 px-6 py-24 lg:grid-cols-[600px_minmax(0,1fr)] lg:gap-24 lg:px-20 lg:py-[110px]">
            <div className="order-2 flex flex-col gap-1.5 rounded-[20px] border border-ink-100 bg-white p-6 lg:order-1" aria-label="Example fleet list">
              <div className="flex items-center justify-between px-2 pb-3.5 pt-1">
                <span className="text-base font-semibold">Fleet</span>
                <span className="text-[13px] text-ink-500">Your organisation</span>
              </div>
              {FLEET.map((v) => (
                <div key={v.name} className={`flex items-center gap-3 rounded-xl p-3 ${v.alert ? 'bg-signal-50' : ''}`}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: v.color }} />
                  <span className="flex-1 text-[15px] font-medium">{v.name}</span>
                  <span className={`text-[13px] ${v.alert ? 'font-semibold text-signal-800' : 'text-ink-500'}`}>{v.status}</span>
                </div>
              ))}
            </div>

            <div className="order-1 flex flex-col gap-8 lg:order-2">
              <Eyebrow tone="light">FOR BUSINESS</Eyebrow>
              <h2 className="font-display text-4xl font-extrabold leading-none tracking-[-0.03em] sm:text-6xl">
                Run your fleet on the same map your drivers use.
              </h2>
              <div className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
                {[
                  ['Live vehicles & assets', 'Every tracker streams position and heading, animated smoothly on the map.'],
                  ['Geofences', 'Draw your yard, depots or job sites and know who’s inside.'],
                  ['Signal-lost alerts', 'A tracker that goes quiet raises an alert, instead of silently freezing on the map.'],
                  ['Trips & follow mode', 'Follow one vehicle and let the map keep it centred as it drives.'],
                ].map(([title, body]) => (
                  <div key={title} className="flex flex-col gap-1.5">
                    <h3 className="text-lg font-semibold">{title}</h3>
                    <p className="text-[15px] leading-normal text-ink-500">{body}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href={SIGNUP_BUSINESS} className={`flex h-[52px] items-center rounded-xl bg-ink-900 px-6 text-base font-semibold text-white hover:bg-ink-700 ${FOCUS}`}>
                  Set up business account
                </Link>
                <Link href="/login?account=business" className={`flex h-[52px] items-center rounded-xl border border-ink-200 px-6 text-base font-medium text-ink-900 hover:border-ink-400 ${FOCUS}`}>
                  Business log in
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── Choose an account ───────────────────────────────────────── */}
        <section className="mx-auto flex max-w-[1440px] flex-col items-center gap-12 px-6 py-24 lg:px-20 lg:py-[100px]">
          <h2 className="text-center font-display text-4xl font-extrabold leading-none tracking-[-0.03em] text-ink-50 sm:text-[56px]">
            Pick how you’ll use FloakMap.
          </h2>
          <div className="grid w-full max-w-[1080px] gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-6 rounded-[20px] border border-ink-700 bg-ink-850 p-8 sm:p-9">
              <div className="flex flex-col gap-2">
                <h3 className="font-display text-[32px] font-bold text-ink-50">Individual</h3>
                <p className="text-[15.5px] text-ink-300">Your map, your people.</p>
              </div>
              <ul className="flex flex-1 flex-col gap-3 text-[15.5px] text-ink-200">
                <Check>All five map layers and nearby search</Check>
                <Check>Host and join FloakNets</Check>
                <Check>Share precise location only with people you approve</Check>
              </ul>
              <Link href={SIGNUP_INDIVIDUAL} className={`flex h-[52px] items-center justify-center rounded-xl bg-signal text-base font-semibold text-ink-900 hover:bg-signal-400 ${FOCUS}`}>
                Sign up as individual
              </Link>
            </div>
            <div className="flex flex-col gap-6 rounded-[20px] bg-ink-50 p-8 text-ink-900 sm:p-9">
              <div className="flex flex-col gap-2">
                <h3 className="font-display text-[32px] font-bold">Business</h3>
                <p className="text-[15.5px] text-ink-500">One organisation, every vehicle.</p>
              </div>
              <ul className="flex flex-1 flex-col gap-3 text-[15.5px] text-ink-700">
                <Check>Everything in Individual</Check>
                <Check>Fleet tracking for vehicles and assets</Check>
                <Check>Geofences and signal-lost alerts</Check>
              </ul>
              <Link href={SIGNUP_BUSINESS} className={`flex h-[52px] items-center justify-center rounded-xl bg-ink-900 text-base font-semibold text-white hover:bg-ink-700 ${FOCUS}`}>
                Sign up as business
              </Link>
            </div>
          </div>
          <p className="text-[15px] text-ink-300">
            Have an account?{' '}
            <Link href="/login" className={`rounded font-semibold text-signal-400 hover:text-signal-300 ${FOCUS}`}>Log in</Link>
          </p>
        </section>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-ink-800">
        <div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-8 px-6 py-12 md:flex-row md:items-start lg:px-20">
          <div className="flex flex-col gap-3">
            <Logo size={26} />
            <span className="text-[13px] text-ink-300">
              Map data ©{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className={`rounded underline underline-offset-2 hover:text-ink-100 ${FOCUS}`}>
                OpenStreetMap
              </a>{' '}
              contributors. Tiles by OpenFreeMap.
            </span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <a href="#layers" className={`rounded text-ink-200 hover:text-ink-50 ${FOCUS}`}>The map</a>
            <a href="#floaknet" className={`rounded text-ink-200 hover:text-ink-50 ${FOCUS}`}>FloakNet</a>
            <a href="#business" className={`rounded text-ink-200 hover:text-ink-50 ${FOCUS}`}>For business</a>
            <Link href="/map" className={`rounded text-ink-200 hover:text-ink-50 ${FOCUS}`}>Open the map</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
