// Mirrors the auth shapes in backend/routers/auth.py.

export type AccountType = 'individual' | 'business'

export interface Session {
  access_token: string
  token_type: 'bearer'
  org_id: string
  subject_id: string
  role: string
  account_type: AccountType
  display_name: string
  org_name: string | null
}

export interface SignupInput {
  account_type: AccountType
  email: string
  password: string
  display_name: string
  org_name?: string
  fleet_size?: string
}
