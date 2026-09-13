'use client'

import { useState } from 'react'
import clsx from 'clsx'
import type { CategoryKey, Theme, FlyTarget } from '@/lib/types'
import { LAYER_META } from '@/lib/types'

// ── City presets ──────────────────────────────────────────────────────────────
const CITIES: Record<string, FlyTarget> = {
  'parker':            { center: [-104.762, 39.51],  zoom: 12.2 },
  'parker, co':        { center: [-104.762, 39.51],  zoom: 12.2 },
  '80134':             { center: [-104.762, 39.51],  zoom: 12.2 },
  'denver':            { center: [-104.990, 39.739], zoom: 11   },
  'denver, co':        { center: [-104.990, 39.739], zoom: 11   },
  'aurora':            { center: [-104.802, 39.729], zoom: 11   },
  'aurora, co':        { center: [-104.802, 39.729], zoom: 11   },
  'boulder':           { center: [-105.270, 40.015], zoom: 12   },
  'colorado springs':  { center: [-104.821, 38.833], zoom: 11   },
  'new york':          { center: [-74.006,  40.713], zoom: 11   },
  'los angeles':       { center: [-118.243, 34.052], zoom: 10   },
  'chicago':           { center: [-87.629,  41.878], zoom: 11   },
  'houston':           { center: [-95.369,  29.760], zoom: 10   },
  'phoenix':           { center: [-112.074, 33.448], zoom: 10   },
  'seattle':           { center: [-122.333, 47.606], zoom: 11   },
  'san francisco':     { center: [-122.419, 37.775], zoom: 12   },
  'miami':             { center: [-80.191,  25.774], zoom: 11   },
}

interface SidebarProps {
  theme: Theme
  layers: Record<CategoryKey, boolean>
  counts: Record<CategoryKey, number>
  onLayerToggle: (key: CategoryKey) => void
  onThemeToggle: () => void
  onFlyTo: (dest: FlyTarget) => void
}

function PillToggle({ on, color }: { on: boolean; color: string }) {
  return (
    <div
      className="relative flex-shrink-0 w-8 h-[18px] rounded-full transition-colors duration-200"
      style={{ background: on ? color : '#d1d5db' }}
    >
      <div
        className="absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform duration-200"
        style={{ transform: on ? 'translateX(14px)' : 'translateX(0)' }}
      />
    </div>
  )
}

export default function Sidebar({
  theme, layers, counts, onLayerToggle, onThemeToggle, onFlyTo,
}: SidebarProps) {
  const [search, setSearch] = useState('')
  const [notFound, setNotFound] = useState(false)

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const hit = CITIES[search.trim().toLowerCase()]
    if (hit) {
      onFlyTo(hit)
      setSearch('')
      setNotFound(false)
    } else {
      setNotFound(true)
    }
  }

  const isDark = theme === 'dark'

  return (
    <aside
      className={clsx(
        'flex flex-col flex-shrink-0 w-[272px] h-full overflow-y-auto overflow-x-hidden border-r z-10',
        isDark
          ? 'bg-[#161b2e] border-[#252d42] text-slate-200'
          : 'bg-white border-stone-200 text-zinc-800',
      )}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className={clsx('px-4 pt-4 pb-3 border-b', isDark ? 'border-[#252d42]' : 'border-stone-200')}>
        <div className="flex items-center gap-2.5 mb-3">
          {/* Logo mark */}
          <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br from-[#1b2a4a] to-[#2563eb] flex items-center justify-center text-white font-bold text-sm">
            FM
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm leading-tight">FloakMap</div>
            <div className={clsx('text-[11px] leading-tight', isDark ? 'text-slate-400' : 'text-zinc-400')}>
              US Parking &amp; Services
            </div>
          </div>
          {/* Theme toggle */}
          <button
            onClick={onThemeToggle}
            className={clsx(
              'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-base transition-colors',
              isDark ? 'hover:bg-slate-700' : 'hover:bg-stone-100',
            )}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>

        {/* Search */}
        <div
          className={clsx(
            'flex items-center gap-2 rounded-lg px-3 py-2 border text-sm',
            isDark ? 'bg-[#0f1525] border-[#252d42]' : 'bg-stone-50 border-stone-200',
          )}
        >
          <span className={isDark ? 'text-slate-500' : 'text-zinc-400'}>⌕</span>
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setNotFound(false) }}
            onKeyDown={handleSearch}
            placeholder="Search city or ZIP…"
            autoComplete="off"
            className={clsx(
              'flex-1 min-w-0 bg-transparent outline-none text-[12.5px] placeholder:text-zinc-400',
              isDark ? 'text-slate-200' : 'text-zinc-800',
            )}
          />
        </div>
        {notFound && (
          <p className="mt-1.5 text-[11px] text-red-400 px-1">City not found — try "Denver" or "Chicago"</p>
        )}
      </div>

      {/* ── Layers ──────────────────────────────────────────────────────────── */}
      <div className={clsx('px-4 py-3 border-b', isDark ? 'border-[#252d42]' : 'border-stone-200')}>
        <p className={clsx('text-[9.5px] font-semibold uppercase tracking-widest mb-2.5', isDark ? 'text-slate-500' : 'text-zinc-400')}>
          Map Layers
        </p>
        {LAYER_META.map(({ key, label, color }) => (
          <div
            key={key}
            role="button"
            tabIndex={0}
            onClick={() => onLayerToggle(key)}
            onKeyDown={(e) => e.key === 'Enter' && onLayerToggle(key)}
            className={clsx(
              'flex items-center gap-2.5 py-2 cursor-pointer select-none rounded transition-opacity',
              !layers[key] && 'opacity-40',
            )}
          >
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
            <span className="flex-1 text-[12.5px] font-medium">{label}</span>
            <span
              className={clsx(
                'text-[10.5px] rounded-full px-2 py-0.5',
                isDark ? 'bg-[#0f1525] text-slate-400' : 'bg-stone-100 text-zinc-400',
              )}
            >
              {counts[key]}
            </span>
            <PillToggle on={layers[key]} color={color} />
          </div>
        ))}
      </div>

      {/* ── Coverage ────────────────────────────────────────────────────────── */}
      <div className={clsx('px-4 py-3 border-b', isDark ? 'border-[#252d42]' : 'border-stone-200')}>
        <p className={clsx('text-[9.5px] font-semibold uppercase tracking-widest mb-2', isDark ? 'text-slate-500' : 'text-zinc-400')}>
          Coverage
        </p>
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
            ✓ Parker, CO
          </span>
          {['Denver, CO', 'Aurora, CO', '+ via jobs'].map((c) => (
            <span
              key={c}
              className={clsx(
                'text-[11px] px-2.5 py-1 rounded-full border',
                isDark ? 'border-[#252d42] text-slate-400 bg-[#0f1525]' : 'border-stone-200 text-zinc-400 bg-stone-50',
              )}
            >
              {c}
            </span>
          ))}
        </div>
      </div>

      {/* ── Notice ──────────────────────────────────────────────────────────── */}
      <div className="mx-4 my-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-[11px] text-amber-800 leading-relaxed">
        <strong>Seed data:</strong> Parker, CO is fully loaded. Automated OSM + Google Places collection jobs
        will add cities progressively.
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div className={clsx('mt-auto px-4 py-3 border-t text-[10.5px] leading-relaxed', isDark ? 'border-[#252d42] text-slate-500' : 'border-stone-200 text-zinc-400')}>
        Sources: OpenStreetMap · Google Places · CarWashAtlas · Town of Parker
        <br />
        Last updated: September 2026
      </div>
    </aside>
  )
}
