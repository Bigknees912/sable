import { Sparkles, UserPlus, ChevronRight } from 'lucide-react'
import { AuthShell, LIGHT } from './ui'

// Ported from app-demo.jsx's SignupChoice, but runs post-auth: the user
// already has a real Supabase session at this point, and this choice picks
// which RPC (create_company_and_owner vs join_company_as_tech) finishes
// their signup.
export default function RoleChoiceScreen({ onPickOwner, onPickEmployee, userEmail }) {
  return (
    <AuthShell>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: LIGHT.ink, marginBottom: 4 }}>How are you joining?</h1>
      <div style={{ fontSize: 13.5, color: LIGHT.sub, marginBottom: 24 }}>
        You're signed in as {userEmail}. This decides what you'll see once you're in.
      </div>
      <button type="button" className="tap" onClick={onPickOwner} style={{ width: '100%', textAlign: 'left', background: LIGHT.card, borderRadius: 16, padding: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <div aria-hidden="true" style={{ width: 42, height: 42, borderRadius: 12, background: LIGHT.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Sparkles size={19} color={LIGHT.accent} /></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: LIGHT.ink }}>I'm starting a new business</div>
          <div style={{ fontSize: 12.5, color: LIGHT.sub }}>Set up a company, get a join code for your team</div>
        </div>
        <ChevronRight size={16} color={LIGHT.sub} aria-hidden="true" />
      </button>
      <button type="button" className="tap" onClick={onPickEmployee} style={{ width: '100%', textAlign: 'left', background: LIGHT.card, borderRadius: 16, padding: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div aria-hidden="true" style={{ width: 42, height: 42, borderRadius: 12, background: LIGHT.infoSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><UserPlus size={19} color={LIGHT.info} /></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: LIGHT.ink }}>I'm joining my team</div>
          <div style={{ fontSize: 12.5, color: LIGHT.sub }}>Your employer gives you a join code</div>
        </div>
        <ChevronRight size={16} color={LIGHT.sub} aria-hidden="true" />
      </button>
    </AuthShell>
  )
}
