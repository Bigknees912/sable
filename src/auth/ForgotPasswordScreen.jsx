import { useState } from 'react'
import { Mail } from 'lucide-react'
import { resetPasswordForEmail } from '../lib/auth'
import { AuthShell, BackRow, FieldLabel, TextInput, PrimaryButton, ErrorText, LIGHT, usePendingAction } from './ui'

export default function ForgotPasswordScreen({ onBack }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const { loading, error, run } = usePendingAction()

  function submit() {
    run(async () => {
      await resetPasswordForEmail(email)
      setSent(true)
    })
  }

  if (sent) {
    return (
      <AuthShell>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: LIGHT.infoSoft, margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Mail size={24} color={LIGHT.info} />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: LIGHT.ink, marginBottom: 8 }}>Check your email</h1>
          <div style={{ fontSize: 14, color: LIGHT.sub, lineHeight: 1.5, marginBottom: 24 }}>
            If <strong style={{ color: LIGHT.ink }}>{email}</strong> has an account, a password reset link is on its way.
          </div>
          <button className="tap" onClick={onBack} style={{ background: LIGHT.ink, color: '#fff', border: 'none', borderRadius: 10, padding: '12px 20px', fontSize: 14, fontWeight: 600 }}>
            Back to Sign In
          </button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <BackRow onBack={onBack} />
      <h1 style={{ fontSize: 20, fontWeight: 700, color: LIGHT.ink, marginBottom: 8 }}>Reset your password</h1>
      <div style={{ fontSize: 13.5, color: LIGHT.sub, marginBottom: 20 }}>We'll email you a link to set a new one.</div>
      <div style={{ background: LIGHT.card, borderRadius: 20, padding: 22, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <FieldLabel htmlFor="field-email-3">Email</FieldLabel>
        <TextInput id="field-email-3" value={email} onChange={setEmail} placeholder="you@company.com" type="email" autoComplete="email" />
        <ErrorText>{error}</ErrorText>
        <PrimaryButton onClick={submit} disabled={loading || !email}>
          {loading ? 'Sending…' : 'Send Reset Link'}
        </PrimaryButton>
      </div>
    </AuthShell>
  )
}
