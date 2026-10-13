import type { Metadata } from 'next'
import AuthScreen from '@/components/AuthScreen'
import { accountFrom } from '@/lib/auth-params'
import type { SearchParams } from '@/lib/auth-params'

export const metadata: Metadata = { title: 'Log in' }

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return <AuthScreen initialMode="login" initialAccount={await accountFrom(searchParams)} />
}
