import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { listPlans } from '../lib/plans'
import { AuthShell, BackRow, PrimaryButton, LIGHT } from './ui'
import { ErrorState, LoadingState } from '../dashboard/ui'

// New step in the self-serve signup wizard, between RoleChoiceScreen and
// OwnerOnboardingScreen: pick a plan before answering business-profile
// questions. Doesn't touch Stripe or the database itself - just collects
// the choice and hands it up to App.jsx, which passes it into
// OwnerOnboardingScreen's submit (create_company_and_owner, then Stripe
// Checkout for a paid plan). Plans are fetched live from the `plans`
// table (super-admin-editable) rather than hardcoded - see lib/plans.js.
export default function PlanSelectionScreen({ onBack, onContinue }) {
  const [selected, setSelected] = useState('starter')
  const [plans, setPlans] = useState(undefined)
  const [error, setError] = useState('')

  function load() {
    setError('')
    setPlans(undefined)
    listPlans()
      .then((data) => {
        setPlans(data)
        if (data.length && !data.some((p) => p.key === selected)) setSelected(data[0].key)
      })
      .catch((err) => setError(err.message || String(err)))
  }

  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthShell maxWidth={440}>
      <BackRow onBack={onBack} />
      <h1 style={{ fontSize: 20, fontWeight: 700, color: LIGHT.ink, marginBottom: 4 }}>Choose your plan</h1>
      <div style={{ fontSize: 13.5, color: LIGHT.sub, marginBottom: 22 }}>
        You can change this later. Nothing is charged until you finish setup.
      </div>

      {error && <ErrorState message={`Couldn't load plans: ${error}`} onRetry={load} />}
      {!error && plans === undefined && <LoadingState>Loading plans…</LoadingState>}

      {plans && (
        <div role="radiogroup" aria-label="Plan" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
          {plans.map((p) => {
            const active = p.key === selected
            return (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={active}
                className="tap"
                onClick={() => setSelected(p.key)}
                style={{
                  background: LIGHT.card,
                  borderRadius: 16,
                  padding: 16,
                  border: `1.5px solid ${active ? LIGHT.accent : LIGHT.border}`,
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: LIGHT.ink }}>{p.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: LIGHT.accent }}>{p.price}</div>
                  </div>
                  <div aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 10, border: `1.5px solid ${active ? LIGHT.accent : LIGHT.border}`, background: active ? LIGHT.accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {active && <Check size={12} color="#fff" strokeWidth={3} />}
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: LIGHT.sub, marginBottom: 8 }}>{p.blurb}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {p.features.map((f) => (
                    <div key={f} style={{ fontSize: 11.5, color: LIGHT.sub, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Check size={11} color={LIGHT.accent} aria-hidden="true" /> {f}
                    </div>
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      )}

      <PrimaryButton onClick={() => onContinue(selected)} disabled={!plans}>Continue</PrimaryButton>
    </AuthShell>
  )
}
