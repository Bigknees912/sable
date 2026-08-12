import { useState } from 'react'
import { signInWithPassword, signUpWithPassword } from '../lib/auth'
import { AuthShell, FieldLabel, TextInput, PrimaryButton, ErrorText, LIGHT, usePendingAction } from '../auth/ui'
import ForgotPasswordScreen from '../auth/ForgotPasswordScreen'

// Deliberately separate from LoginScreen.jsx (the regular company
// sign-in): no "I'm starting a new business" / "I'm joining a team"
// choices, no plan selection, nothing that leads toward the company-
// scoped dashboard. A regular owner/tech account signing in here still
// only gets a real Supabase Auth session - SuperAdminApp then checks
// is_super_admin() and rejects anyone not in the super_admins table, so
// reaching this screen (even guessing the URL) grants nothing by itself.
export default function AdminLoginScreen() {
  const [mode, setMode] = useState('signin') // signin | signup | check-email | forgot-password
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { loading, error, run, setError } = usePendingAction()

  function submit() {
    if (!email.trim() || !password) return setError('Enter your email and password.')
    run(async () => {
      if (mode === 'signup') {
        const data = await signUpWithPassword(email.trim(), password)
        if (!data.session) {
          setMode('check-email')
          return
        }
      } else {
        await signInWithPassword(email.trim(), password)
      }
      // onAuthStateChange in SuperAdminApp picks up the new session from here.
    })
  }

  if (mode === 'forgot-password') {
    return <ForgotPasswordScreen onBack={() => setMode('signin')} />
  }

  if (mode === 'check-email') {
    return (
      <AuthShell>
        <div style={{ fontSize: 17, fontWeight: 700, color: LIGHT.ink, marginBottom: 8 }}>Check your email</div>
        <div style={{ fontSize: 13.5, color: LIGHT.sub, lineHeight: 1.5 }}>
          Confirm {email} to finish creating your account, then come back and sign in. This alone does not grant
          admin access - that's a separate step.
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: LIGHT.sub, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
        Sable Platform
      </div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: LIGHT.ink, marginBottom: 20 }}>Super Admin Sign In</h1>
      <div style={{ background: LIGHT.card, borderRadius: 20, padding: 22, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <FieldLabel htmlFor="field-email-1">Email</FieldLabel>
        <TextInput id="field-email-1" value={email} onChange={setEmail} placeholder="you@runsable.com" type="email" autoComplete="username" />
        <FieldLabel htmlFor="field-password-1">Password</FieldLabel>
        <TextInput id="field-password-1" value={password} onChange={setPassword} placeholder="••••••••" type="password" autoComplete="current-password" />
        <ErrorText>{error}</ErrorText>
        <PrimaryButton onClick={submit} disabled={loading}>
          {loading ? 'Signing in…' : mode === 'signup' ? 'Create Account' : 'Sign In'}
        </PrimaryButton>
      </div>
      <button
        className="tap"
        onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError('') }}
        style={{ display: 'block', margin: '16px auto 0', fontSize: 12, color: LIGHT.sub }}
      >
        {mode === 'signup' ? 'Already have an account? Sign in' : 'Bootstrapping the first admin account? Create one'}
      </button>
      {mode === 'signin' && (
        <button
          className="tap"
          onClick={() => { setMode('forgot-password'); setError('') }}
          style={{ display: 'block', margin: '8px auto 0', fontSize: 12, color: LIGHT.sub }}
        >
          Forgot password?
        </button>
      )}
    </AuthShell>
  )
}
