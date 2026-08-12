import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { updatePassword } from '../lib/auth'
import { AuthShell, FieldLabel, TextInput, PrimaryButton, ErrorText, LIGHT, usePendingAction } from './ui'

// Rendered whenever App.jsx sees a PASSWORD_RECOVERY auth event, in place
// of the normal session/profile flow - regardless of whether a profile
// exists yet, since a recovery-link click always produces a session but
// the user hasn't "really" signed in until they set a new password.
const MIN_PASSWORD_LENGTH = 8

export default function ResetPasswordScreen({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const { loading, error, run, setError } = usePendingAction()

  function submit() {
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    if (password !== confirm) return setError("Passwords don't match.")
    run(async () => {
      await updatePassword(password)
      onDone()
    })
  }

  return (
    <AuthShell>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: LIGHT.infoSoft, margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <KeyRound size={24} color={LIGHT.info} />
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: LIGHT.ink, marginBottom: 4 }}>Set a new password</h1>
      </div>
      <div style={{ background: LIGHT.card, borderRadius: 20, padding: 22, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <FieldLabel htmlFor="field-new-password-1">New password</FieldLabel>
        <TextInput id="field-new-password-1" value={password} onChange={setPassword} placeholder="At least 8 characters" type="password" autoComplete="new-password" />
        <FieldLabel htmlFor="field-confirm-new-password-1">Confirm new password</FieldLabel>
        <TextInput id="field-confirm-new-password-1" value={confirm} onChange={setConfirm} placeholder="Re-enter password" type="password" autoComplete="new-password" />
        <ErrorText>{error}</ErrorText>
        <PrimaryButton onClick={submit} disabled={loading || !password || !confirm}>
          {loading ? 'Saving…' : 'Save New Password'}
        </PrimaryButton>
      </div>
    </AuthShell>
  )
}
