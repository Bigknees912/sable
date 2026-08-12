import { useState } from 'react'
import { ClipboardList, Headset } from 'lucide-react'
import { joinCompany } from '../lib/auth'
import { AuthShell, BackRow, FieldLabel, TextInput, PrimaryButton, ErrorText, LIGHT, usePendingAction } from './ui'

const ROLE_OPTIONS = [
  { value: 'tech', label: 'Technician', sub: 'Get assigned jobs, run the calendar', icon: ClipboardList },
  { value: 'office_admin', label: 'Office Admin', sub: 'Manage jobs, calendar & clients - no billing or settings', icon: Headset },
]

// Ported from app-demo.jsx's EmployeeSignup, minus the email/password
// fields (already collected on SignupScreen pre-auth). Wired to the real
// join_company_as_tech RPC - an invalid code surfaces the same "doesn't
// match any company" message the demo showed for its local-state check.
// Migration 055 added a role choice here: everyone redeeming a join code
// after the first (who always becomes owner) picks Technician or Office
// Admin - the server rejects any other value.
export default function EmployeeJoinScreen({ onBack, onDone }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [role, setRole] = useState('tech')
  const { loading, error, run, setError } = usePendingAction()

  function submit() {
    if (!name.trim()) return setError('Enter your name.')
    if (!code.trim()) return setError('Enter your company join code.')
    run(async () => {
      try {
        await joinCompany({ joinCode: code, name, role })
        onDone()
      } catch (err) {
        if (err.message.includes('invalid join code')) {
          throw new Error("That join code doesn't match any company. Double-check with your employer.")
        }
        if (err.message.includes('seat_limit_reached')) {
          throw new Error("This company's plan is at its team-member limit. Ask your employer to upgrade their plan before you can join.")
        }
        throw err
      }
    })
  }

  return (
    <AuthShell>
      <BackRow onBack={onBack} />
      <h1 style={{ fontSize: 20, fontWeight: 700, color: LIGHT.ink, marginBottom: 20 }}>Join your team</h1>
      <div style={{ background: LIGHT.card, borderRadius: 20, padding: 22, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <FieldLabel htmlFor="field-your-name-1">Your name</FieldLabel>
        <TextInput id="field-your-name-1" value={name} onChange={setName} placeholder="Dave Martinez" />
        <FieldLabel htmlFor="field-company-join-code-1">Company join code</FieldLabel>
        <TextInput id="field-company-join-code-1" value={code} onChange={setCode} placeholder="A1B2-C3D4" />
        <div role="group" aria-label="Your role" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <FieldLabel>Your role</FieldLabel>
          {ROLE_OPTIONS.map((opt) => {
            const Icon = opt.icon
            const selected = role === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                className="tap"
                onClick={() => setRole(opt.value)}
                aria-pressed={selected}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, textAlign: 'left',
                  background: selected ? LIGHT.accentSoft : LIGHT.bg,
                  border: `1.5px solid ${selected ? LIGHT.accent : LIGHT.border}`,
                }}
              >
                <Icon size={17} color={selected ? LIGHT.accent : LIGHT.sub} aria-hidden="true" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: LIGHT.ink }}>{opt.label}</div>
                  <div style={{ fontSize: 11.5, color: LIGHT.sub }}>{opt.sub}</div>
                </div>
              </button>
            )
          })}
        </div>
        <ErrorText>{error}</ErrorText>
        <PrimaryButton onClick={submit} disabled={loading}>
          {loading ? 'Joining…' : 'Join Company'}
        </PrimaryButton>
      </div>
    </AuthShell>
  )
}
