import type { AccountType } from './auth-types'

type Params = { account?: string | string[] }

/**
 * Next 14 passes searchParams as an object, Next 15 as a Promise. Awaiting
 * works for both, so these pages survive the upgrade unchanged.
 */
export type SearchParams = Params | Promise<Params>

export async function accountFrom(searchParams: SearchParams): Promise<AccountType> {
  const { account } = await searchParams
  return account === 'business' ? 'business' : 'individual'
}
