import type { Metadata } from 'next'

// map/page.tsx is a client component and cannot export metadata itself.
export const metadata: Metadata = { title: 'Map' }

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return children
}
