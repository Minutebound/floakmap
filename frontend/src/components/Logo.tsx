import clsx from 'clsx'

interface LogoProps {
  /** Colour of the wordmark and the pin's cut-out. */
  tone?: 'light' | 'dark'
  /** Pin height in px. The wordmark scales with it. */
  size?: number
  showWordmark?: boolean
  className?: string
}

/**
 * The pin mark and wordmark. `tone="light"` is for dark surfaces (landing,
 * dark theme); `tone="dark"` for light ones.
 */
export default function Logo({
  tone = 'light', size = 30, showWordmark = true, className,
}: LogoProps) {
  const hole = tone === 'light' ? '#0f141a' : '#ffffff'
  return (
    <span className={clsx('inline-flex items-center gap-2.5', className)}>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
        <path d="M16 29s-9-8.4-9-15a9 9 0 0 1 18 0c0 6.6-9 15-9 15z" fill="#ff5555" />
        <circle cx="16" cy="14" r="3.4" fill={hole} />
      </svg>
      {showWordmark && (
        <span
          className={clsx(
            'font-display font-extrabold tracking-[-0.02em]',
            tone === 'light' ? 'text-ink-50' : 'text-ink-900',
          )}
          style={{ fontSize: Math.round(size * 0.77) }}
        >
          FloakMap
        </span>
      )}
    </span>
  )
}
