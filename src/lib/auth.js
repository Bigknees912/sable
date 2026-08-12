import { supabase } from './supabaseClient'

// Real Supabase Auth wrappers. These replace app-demo.jsx's fake
// `loginDemo(role)` / local-state signup handlers.

// Turns Supabase's terse, sometimes security-deliberately-vague auth errors
// into copy a tradesperson can act on. Note: Supabase intentionally returns
// the SAME "Invalid login credentials" for both a wrong password and an
// email with no account, to avoid leaking which emails are registered
// (account enumeration). We keep that single message rather than splitting
// it into "wrong password" vs "no account" - the vaguer message is the
// secure behavior, so the copy covers both cases in one friendly line.
export function mapAuthError(error) {
  const raw = (error && (error.message || error.error_description || String(error))) || 'Something went wrong.'
  const m = raw.toLowerCase()
  if (m.includes('invalid login credentials')) return "That email and password don't match. Double-check both and try again."
  if (m.includes('email not confirmed')) return 'Please confirm your email first — check your inbox for the verification link.'
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('user already')) return 'An account with this email already exists. Try signing in instead.'
  if (m.includes('password should be') || m.includes('password is too short') || m.includes('at least 6')) return 'Your password is too short. Use at least 8 characters.'
  if (m.includes('unable to validate email') || m.includes('invalid email') || m.includes('valid email')) return 'That doesn’t look like a valid email address.'
  if (m.includes('rate limit') || m.includes('too many') || m.includes('for security purposes')) return 'Too many attempts. Please wait a minute and try again.'
  if (m.includes('provider is not enabled') || m.includes('oauth')) return 'Google sign-in isn’t finished being set up yet. Try email and password for now.'
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to fetch')) return 'Network problem — check your connection and try again.'
  return raw // already human-readable (e.g. our own RPC messages), pass through
}

export async function signUpWithPassword(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw new Error(mapAuthError(error))
  // data.session is null when the project requires email confirmation -
  // callers must handle that case (show a "check your email" screen).
  return data
}

export async function signInWithPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(mapAuthError(error))
  return data
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
  if (error) throw new Error(mapAuthError(error))
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// Sends a password-reset email. Supabase always resolves this (it never
// reveals whether the address has an account, to avoid leaking which
// emails are registered), so the UI should show the same "check your
// email" message regardless of the outcome. Clicking the emailed link
// lands back on this app with a recovery session already established and
// fires a 'PASSWORD_RECOVERY' auth event - see App.jsx.
export async function resetPasswordForEmail(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  })
  if (error) throw new Error(mapAuthError(error))
}

// Sets a new password for the currently-authenticated session - only
// meaningful right after a PASSWORD_RECOVERY event, which is the one time
// a session exists without the user having "really" signed in.
export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw new Error(mapAuthError(error))
}

// Returns the caller's profile row (joined with their company), or null if
// they're authenticated but haven't finished company setup yet.
export async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*, companies(*)')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

// Wraps the create_company_and_owner RPC (migration 006, extended in 029
// with plan + Google review link for self-serve onboarding). Requires an
// active session - call only after auth.uid() resolves to a real user.
export async function createCompanyAndOwner({ businessName, ownerName, trade, teamSize, serviceArea, plan, googleReviewLink }) {
  const { data, error } = await supabase.rpc('create_company_and_owner', {
    p_business_name: businessName,
    p_owner_name: ownerName,
    p_trade: trade,
    p_team_size: teamSize,
    p_service_area: serviceArea,
    p_plan: plan || 'starter',
    p_google_review_link: googleReviewLink || null,
  })
  if (error) throw error
  return data
}

// Wraps the join_company RPC (renamed from join_company_as_tech in
// migration 042, extended in migration 055 with p_role for the
// Technician/Office Admin choice). Surfaces "invalid join code" as a plain
// error message, same as app-demo.jsx's EmployeeSignup validation. The
// caller becomes 'owner' if the company has no owner yet (hand-onboarded
// via the super-admin panel's "add a company" flow); otherwise they get
// whichever of 'tech' / 'office_admin' they picked - the server enforces
// that 'owner' can't be requested directly.
export async function joinCompany({ joinCode, name, role }) {
  const { data, error } = await supabase.rpc('join_company', {
    p_join_code: joinCode,
    p_name: name,
    p_role: role || 'tech',
  })
  if (error) {
    const m = (error.message || '').toLowerCase()
    if (m.includes('invalid') && m.includes('code')) throw new Error("That join code doesn't match any company. Double-check it with your employer.")
    if (m.includes('too many') || m.includes('rate')) throw new Error('Too many attempts with that code. Please wait a bit and try again.')
    throw new Error(mapAuthError(error))
  }
  return data
}
