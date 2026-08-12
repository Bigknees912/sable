import { useState } from 'react'
import { Building2, Tags, LineChart, LogOut } from 'lucide-react'
import { LIGHT } from '../theme'
import { GlobalStyle } from '../auth/ui'
import { ErrorBanner } from '../dashboard/ui'
import CompaniesPage from './CompaniesPage'
import PlansPage from './PlansPage'
import RevenuePage from './RevenuePage'

const TABS = [
  { id: 'companies', label: 'Companies', icon: Building2 },
  { id: 'plans', label: 'Plans & Pricing', icon: Tags },
  { id: 'revenue', label: 'Revenue', icon: LineChart },
]

// Desktop-oriented layout on purpose (wide table views, not the mobile
// tab-bar shell the company dashboard uses in dashboard/AppShell.jsx) -
// this is a back-office tool for one person, not a field app.
export default function AdminShell({ session, onSignOut }) {
  const [tab, setTab] = useState('companies')
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')

  async function handleSignOut() {
    setSigningOut(true)
    setSignOutError('')
    try {
      await onSignOut()
    } catch (err) {
      setSignOutError(err.message || String(err))
      setSigningOut(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: LIGHT.bg }}>
      <GlobalStyle />
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 20px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: LIGHT.sub, textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Sable Platform
            </div>
            <div style={{ fontSize: 19, fontWeight: 700, color: LIGHT.ink }}>Super Admin</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 12, color: LIGHT.sub }}>{session.user.email}</div>
            <button type="button" className="tap" onClick={handleSignOut} disabled={signingOut} aria-label="Sign out" style={{ width: 36, height: 36, borderRadius: 18, background: LIGHT.card, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
              <LogOut size={16} color={LIGHT.ink} aria-hidden="true" />
            </button>
          </div>
        </div>

        <ErrorBanner message={signOutError} onDismiss={() => setSignOutError('')} />

        <div style={{ display: 'flex', gap: 6, marginBottom: 22, borderBottom: `1px solid ${LIGHT.border}` }}>
          {TABS.map((t) => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                className="tap"
                onClick={() => setTab(t.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, padding: '10px 14px',
                  borderBottom: active ? `2px solid ${LIGHT.accent}` : '2px solid transparent',
                  fontSize: 13, fontWeight: 600, color: active ? LIGHT.ink : LIGHT.sub,
                }}
              >
                <Icon size={15} /> {t.label}
              </button>
            )
          })}
        </div>

        {tab === 'companies' && <CompaniesPage />}
        {tab === 'plans' && <PlansPage />}
        {tab === 'revenue' && <RevenuePage />}
      </div>
    </div>
  )
}
