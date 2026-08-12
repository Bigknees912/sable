import { useState } from 'react'
import { signInWithPassword, signInWithGoogle } from '../lib/auth'
import { AuthShell, GoogleG, FieldLabel, TextInput, PrimaryButton, ErrorText, LIGHT, usePendingAction } from './ui'

export default function LoginScreen({ onSignup, onForgotPassword }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { loading, error, run } = usePendingAction()

  function submit() {
    run(() => signInWithPassword(email, password))
    // On success, App.jsx's onAuthStateChange listener picks up the new
    // session and re-renders - no local state change needed here.
  }

  return (
    <AuthShell>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: LIGHT.accent, margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', fontSize: 22 }}>S</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: LIGHT.ink, margin: '0 0 4px 0' }}>Welcome to Sable</h1>
        <div style={{ fontSize: 14, color: LIGHT.sub }}>Sign in to your dashboard</div>
      </div>
      <div style={{ background: LIGHT.card, borderRadius: 20, padding: 24, boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)' }}>
        <button className="tap" onClick={() => run(signInWithGoogle)} disabled={loading} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, border: `1px solid ${LIGHT.border}`, borderRadius: 12, padding: '12px 0', marginBottom: 16, fontSize: 14.5, fontWeight: 600, color: LIGHT.ink, background: '#fff' }}>
          <GoogleG /> Continue with Google
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0' }}><div style={{ flex: 1, height: 1, background: LIGHT.border }} /><span style={{ fontSize: 12, color: LIGHT.sub }}>or</span><div style={{ flex: 1, height: 1, background: LIGHT.border }} /></div>

        <FieldLabel htmlFor="field-email-4">Email</FieldLabel>
        <TextInput id="field-email-4" value={email} onChange={setEmail} placeholder="you@company.com" type="email" autoComplete="email" />
        <FieldLabel htmlFor="field-password-3">Password</FieldLabel>
        <TextInput id="field-password-3" value={password} onChange={setPassword} placeholder="••••••••" type="password" autoComplete="current-password" />
        <ErrorText>{error}</ErrorText>
        <PrimaryButton onClick={submit} disabled={loading || !email || !password}>
          {loading ? 'Signing in…' : 'Sign In'}
        </PrimaryButton>
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button type="button" className="tap" onClick={onForgotPassword} style={{ fontSize: 12.5, color: LIGHT.sub }}>Forgot password?</button>
        </div>
      </div>
      <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: LIGHT.sub }}>
        New here? <button type="button" className="tap" onClick={onSignup} style={{ color: LIGHT.accent, fontWeight: 700, display: 'inline' }}>Create an account</button>
      </div>
    </AuthShell>
  )
}
