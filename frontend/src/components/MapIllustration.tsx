import { SEED_DATA } from '@/lib/seed-data'
import { LAYER_META } from '@/lib/types'
import type { CategoryKey } from '@/lib/types'

/**
 * The hero's map. Drawn, not a screenshot: it stays sharp at any width, costs
 * nothing to load, and uses the same category colours as the real markers.
 * The Nearby card lists real places from the seed data.
 */
const DARK: Record<CategoryKey, string> = Object.fromEntries(
  LAYER_META.map((m) => [m.key, m.color.dark]),
) as Record<CategoryKey, string>

const NEARBY: { key: CategoryKey; name: string; city: string }[] = (
  ['parking', 'ev', 'carwash'] as const
).flatMap((key) => {
  const f = SEED_DATA[key].features[0]
  return f ? [{ key, name: f.properties.name, city: f.properties.city }] : []
})

const MARKERS: [number, number, CategoryKey][] = [
  [150, 118, 'parking'], [250, 270, 'parking'], [420, 330, 'parking'],
  [330, 170, 'ev'], [520, 250, 'ev'],
  [80, 360, 'carwash'], [340, 560, 'carwash'],
  [170, 560, 'auto'], [510, 610, 'auto'],
]

export default function MapIllustration() {
  return (
    <div className="relative aspect-[600/672] w-full overflow-hidden rounded-3xl border border-ink-700 bg-ink-850">
      <svg
        viewBox="0 0 600 672"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <path d="M-20 470 C 120 430, 200 520, 330 480 S 520 380, 640 420" stroke="#1d3446" strokeWidth="34" fill="none" />
        <rect x="360" y="90" width="150" height="110" rx="10" fill="#17261f" />
        <g stroke="#222c37" strokeWidth="10" fill="none">
          <path d="M0 140 H600" /><path d="M0 300 H600" /><path d="M0 590 H600" />
          <path d="M110 0 V672" /><path d="M290 0 V672" /><path d="M470 0 V672" />
        </g>
        <g stroke="#1c252f" strokeWidth="4" fill="none">
          <path d="M0 220 H600" /><path d="M0 380 H600" />
          <path d="M200 0 V672" /><path d="M380 0 V672" /><path d="M550 0 V672" />
        </g>
        <path d="M0 40 L600 520" stroke="#293440" strokeWidth="16" fill="none" />

        <g stroke="#0f141a" strokeWidth="3">
          {MARKERS.map(([x, y, key]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="10" fill={DARK[key]} />
          ))}
        </g>

        {/* Live vehicles with heading wedges */}
        <path d="M232 332 l26 -14 l-6 26 z" fill="#60a5fa" opacity="0.35" />
        <circle cx="236" cy="340" r="8" fill="#2563eb" stroke="#f5f6f8" strokeWidth="2.5" />
        <path d="M452 150 l-2 -30 l22 18 z" fill="#fb923c" opacity="0.35" />
        <circle cx="452" cy="156" r="8" fill="#ea580c" stroke="#f5f6f8" strokeWidth="2.5" />
        <circle cx="120" cy="486" r="8" fill="#16a34a" stroke="#f5f6f8" strokeWidth="2.5" />

        {/* You */}
        <circle cx="300" cy="420" r="46" fill="#ff5555" opacity="0.12" />
        <path d="M300 400 L314 434 L300 426 L286 434 Z" fill="#ff5555" stroke="#f5f6f8" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>

      <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900 px-3 py-2 text-xs text-ink-200">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        Live · 3 in your net
      </div>

      <div className="absolute left-[43%] top-[53%] flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900 py-1.5 pl-1.5 pr-3 text-xs text-ink-100">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-700 text-[10px] font-semibold text-ink-50">DV</span>
        Dev
      </div>

      {NEARBY.length > 0 && (
        <div className="absolute bottom-4 right-4 hidden w-[290px] flex-col gap-3 rounded-2xl border border-ink-700 bg-ink-900 p-4 sm:flex">
          <p className="text-xs font-semibold text-ink-300">Nearby</p>
          {NEARBY.map((p) => (
            <div key={p.key} className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: DARK[p.key] }} />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-50">{p.name}</span>
              <span className="flex-none text-xs text-ink-300">{p.city}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
