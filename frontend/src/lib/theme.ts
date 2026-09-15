/**
 * Semantic surface tokens.
 *
 * Components ask for `panel` or `border`, never for a hex or a Tailwind grey.
 * That is what makes a palette change a one-file edit instead of a search and
 * replace across every component, and it is why light and dark stay in step:
 * both are derived from the same ink ramp.
 */
import type { Theme } from './types'

export interface UITokens {
  /** Raised surface: sidebar, panels, popovers. */
  panel: string
  /** Recessed surface: inputs, chips, the page behind a panel. */
  base: string
  /** Hairline between regions. */
  border: string
  /** Primary reading text. */
  text: string
  /** Secondary text: counts, captions, values. */
  muted: string
  /** Tertiary text: section headings, attribution. */
  faint: string
  /** Hover wash on an interactive row. */
  hover: string
  /** Small count or tag. */
  chip: string
  /** Selected state on a tab or segmented control. */
  selected: string
}

const LIGHT: UITokens = {
  panel:    'bg-white',
  base:     'bg-ink-50',
  border:   'border-ink-100',
  text:     'text-ink-900',
  muted:    'text-ink-400',
  faint:    'text-ink-300',
  hover:    'hover:bg-ink-50',
  chip:     'bg-ink-50 text-ink-400',
  selected: 'bg-ink-900 text-white',
}

const DARK: UITokens = {
  panel:    'bg-ink-850',
  base:     'bg-ink-900',
  border:   'border-ink-700',
  text:     'text-ink-100',
  muted:    'text-ink-300',
  faint:    'text-ink-400',
  hover:    'hover:bg-ink-800',
  chip:     'bg-ink-800 text-ink-300',
  selected: 'bg-ink-100 text-ink-900',
}

export const ui = (theme: Theme): UITokens => (theme === 'dark' ? DARK : LIGHT)