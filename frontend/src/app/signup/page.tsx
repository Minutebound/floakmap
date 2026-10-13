import type { Metadata } from 'next'
import AuthScreen from '@/components/AuthScreen'
import { accountFrom } from '@/lib/auth-params'
import type { SearchParams } from '@/lib/auth-params'

export const metadata: Metadata = { title: 'Sign up' }

export default async function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  return <AuthScreen initialMode="signup" initialAccount={await accountFrom(searchParams)} />
}
