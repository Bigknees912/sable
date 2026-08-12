import { useState } from 'react'
import { createCompanyAndOwner } from '../lib/auth'
import { planRequiresCheckout, createSubscriptionCheckout } from '../lib/plans'
import { AuthShell, BackRow, FieldLabel, TextInput, ChipRow, PrimaryButton, ErrorText, LIGHT, usePendingAction } from './ui'

// Combines app-demo.jsx's OwnerSignup (business name, your name) and
// Onboarding (trade, team size, service area) into one post-auth screen -
// see RoleChoiceScreen.jsx for why this is collected after signUp()
// instead of before it. `plan` comes from PlanSelectionScreen, the step
// before this one in the wizard (see App.jsx).
export default function OwnerOnboardingScreen({ plan, onBack, onDone }) {
  const [businessName, setBusinessName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [trade, setTrade] = useState('Plumbing')
  const [teamSize, setTeamSize] = useState('2-5')
  const [serviceArea, setServiceArea] = useState('')
  const [googleReviewLink, setGoogleReviewLink] = useState('')
  const { loading, error, run } = usePendingAction()

  function submit() {
    run(async () => {
      await createCompanyAndOwner({ businessName, ownerName, trade, teamSize, serviceArea, plan, googleReviewLink })
      // All tiers are paid (Solo/Team/Fleet, migration 069) and route
      // through Stripe Checkout, which starts the 7-day free trial. If that
      // step itself
      // fails (e.g. Stripe isn't configured yet), the workspace still
      // exists - land them in the dashboard anyway rather than stranding
      // them on this form, with a clear note about what didn't finish.
      if (await planRequiresCheckout(plan)) {
        try {
          const url = await createSubscriptionCheckout(plan)
          window.location.href = url
          return
        } catch (err) {
          window.alert(`Your workspace is ready, but billing setup didn't finish: ${err.message}\n\nYou can subscribe later - for now you're on the app.`)
        }
      }
      onDone()
    })
  }

  const canSubmit = businessName.trim() && ownerName.trim() && !loading

  return (
    <AuthShell maxWidth={420}>
      <BackRow onBack={onBack} />
      <h1 style={{ fontSize: 20, fontWeight: 700, color: LIGHT.ink, marginBottom: 4 }}>Set up your business</h1>
      <div style={{ fontSize: 13.5, color: LIGHT.sub, marginBottom: 22 }}>This customizes your job types, pricing, and dashboard.</div>

      <div style={{ background: LIGHT.card, borderRadius: 20, padding: 22, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', marginBottom: 4 }}>
        <FieldLabel htmlFor="field-business-name-2">Business name</FieldLabel>
        <TextInput id="field-business-name-2" value={businessName} onChange={setBusinessName} placeholder="Sable Plumbing & Drain" />
        <FieldLabel htmlFor="field-your-name-2">Your name</FieldLabel>
        <TextInput id="field-your-name-2" value={ownerName} onChange={setOwnerName} placeholder="Jordan Reyes" />

        <FieldLabel>What's your trade?</FieldLabel>
        <ChipRow groupLabel="What's your trade?" options={['Plumbing', 'Electrical', 'HVAC', 'Roofing', 'Locksmith', 'Other']} value={trade} onChange={setTrade} />
        <div style={{ fontSize: 11, color: LIGHT.sub, marginTop: -8, marginBottom: 14, lineHeight: 1.4 }}>
          Your service catalog and pricing pre-fill with defaults for your trade - edit them anytime from Settings.
        </div>

        <FieldLabel>Team size (including you)</FieldLabel>
        <ChipRow groupLabel="Team size (including you)" options={['Just me', '2-5', '6-15', '15+']} value={teamSize} onChange={setTeamSize} />

        <FieldLabel htmlFor="field-service-area-1">Service area</FieldLabel>
        <TextInput id="field-service-area-1" value={serviceArea} onChange={setServiceArea} placeholder="e.g. Calgary and surrounding areas" />

        <FieldLabel htmlFor="field-google-review-link-optional-1">Google review link (optional)</FieldLabel>
        <TextInput id="field-google-review-link-optional-1" value={googleReviewLink} onChange={setGoogleReviewLink} placeholder="https://g.page/r/.../review" />
        <div style={{ fontSize: 11, color: LIGHT.sub, marginTop: -8, marginBottom: 14, lineHeight: 1.4 }}>
          Used in your automated review-request texts. Find yours in Google
          Business Profile → "Ask for reviews." You can add this later too.
        </div>

        <ErrorText>{error}</ErrorText>
        <PrimaryButton onClick={submit} disabled={!canSubmit}>
          {loading ? 'Setting up…' : 'Finish Setup'}
        </PrimaryButton>
      </div>
    </AuthShell>
  )
}
