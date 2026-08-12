import { useEffect, useState } from 'react'
import { Home, KanbanSquare, Calendar, BookUser, Zap, ClipboardList, Receipt, Users, BarChart3, Settings as SettingsIcon, LogOut, Bell, Radar } from 'lucide-react'
import { LIGHT } from '../theme'
import { GlobalStyle } from '../auth/ui'
import { ErrorBanner } from './ui'
import { tradeIcon } from '../lib/tradeMeta'
import { getUnreadNotificationCount } from '../lib/notifications'
import { listLocations } from '../lib/locations'
import { getMyPlan } from '../lib/plans'
import { useTableRealtime } from './useTableRealtime'
import OwnerHome from './OwnerHome'
import JobsBoard from './JobsBoard'
import CalendarPage from './CalendarPage'
import ClientsPage from './ClientsPage'
import AutomationsPage from './AutomationsPage'
import ServiceCatalogPage from './ServiceCatalogPage'
import EstimatesPage from './EstimatesPage'
import TeamPage from './TeamPage'
import AnalyticsPage from './AnalyticsPage'
import SettingsPage from './SettingsPage'
import TechHome from './TechHome'
import MapPage from './MapPage'
import NotificationCenterModal from './NotificationCenterModal'
import LocationSwitcher from './LocationSwitcher'

const OWNER_TABS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'jobs', label: 'Jobs', icon: KanbanSquare },
  { id: 'map', label: 'Map', icon: Radar },
  { id: 'estimates', label: 'Estimates', icon: Receipt },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'clients', label: 'Clients', icon: BookUser },
  { id: 'catalog', label: 'Services', icon: ClipboardList },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'automations', label: 'Winback', icon: Zap },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]
const TECH_TABS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
]
// Office Admin (migration 055): manages jobs, calendar, and the clients
// CRM, but has no route to Settings, pricing config, billing, or the
// super-admin panel - those tabs simply aren't in this list.
const OFFICE_ADMIN_TABS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'jobs', label: 'Jobs', icon: KanbanSquare },
  { id: 'map', label: 'Map', icon: Radar },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'clients', label: 'Clients', icon: BookUser },
]
const ROLE_LABEL = { owner: 'Owner', office_admin: 'Office Admin', tech: 'Technician' }

// Trimmed-down version of app-demo.jsx's AppShell: Map and Insights from
// the demo aren't wired up yet. Settings currently only has a
// Pricing & Revenue section (see SettingsPage.jsx) - General/Integrations
// aren't built.
export default function AppShell({ session, profile, onSignOut }) {
  const [tab, setTab] = useState('home')
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const isOwner = profile.role === 'owner'
  const isOfficeAdmin = profile.role === 'office_admin'
  // Office admins share the owner's jobs/calendar/clients views (they have
  // full read/write on those via RLS, see migration 055) but get their own
  // tab bar so Estimates/Services/Team/Analytics/Winback/Settings stay
  // hidden - those RPCs/policies are still owner-only.
  const canManageOfficeTabs = isOwner || isOfficeAdmin
  const tabs = isOwner ? OWNER_TABS : isOfficeAdmin ? OFFICE_ADMIN_TABS : TECH_TABS
  // Local, updatable copy of the company row: SettingsPage writes changes
  // straight into companies (Pricing & Revenue, financing), and every
  // other tab on this screen should see the new numbers immediately
  // without a full profile refetch/re-login.
  const [company, setCompany] = useState(profile.companies)
  const TradeIcon = tradeIcon(company?.trade)

  const [unreadCount, setUnreadCount] = useState(0)
  const [notifOpen, setNotifOpen] = useState(false)

  // Fleet-tier ('pro' plan) multi-location switcher, migration 056 - owner
  // only, and only worth fetching/showing once a company has more than one
  // location. null selectedLocationId means "All Locations" (combined
  // view, the same unfiltered behavior every company had before this).
  const [locations, setLocations] = useState([])
  const [selectedLocationId, setSelectedLocationId] = useState(null)
  useEffect(() => {
    if (!isOwner) return
    getMyPlan().then((plan) => {
      if (plan !== 'pro') return
      listLocations().then(setLocations).catch(() => {})
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner])

  function refreshUnreadCount() {
    getUnreadNotificationCount().then(setUnreadCount).catch(() => {})
  }
  useEffect(() => {
    if (!isOwner) return
    refreshUnreadCount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner])
  // Keeps the badge live even while the notification center is closed -
  // e.g. a job assigned notification landing while the owner is on the
  // Jobs tab. NotificationCenterModal keeps the badge in sync itself via
  // onUnreadCountChange while it's open, so this only matters when closed.
  useTableRealtime('notifications', isOwner ? company?.id : null, refreshUnreadCount)

  async function handleSignOut() {
    setSigningOut(true)
    setSignOutError('')
    try {
      await onSignOut()
    } catch (err) {
      setSignOutError(err.message || String(err))
      setSigningOut(false)
    }
    // No `finally` resetting signingOut on success: onAuthStateChange
    // unmounts this whole screen once the session clears, so there's
    // nothing left here to reset.
  }

  return (
    <div style={{ minHeight: '100vh', background: LIGHT.bg, paddingBottom: 76 }}>
      <GlobalStyle />
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: LIGHT.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <TradeIcon size={17} color={LIGHT.accent} />
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: LIGHT.ink }}>{company?.name || 'Sable'}</div>
              <div style={{ fontSize: 12, color: LIGHT.sub }}>{profile.name} · {ROLE_LABEL[profile.role] || 'Technician'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isOwner && (
              <LocationSwitcher locations={locations} value={selectedLocationId} onChange={setSelectedLocationId} />
            )}
            {isOwner && (
              <button className="tap" onClick={() => setNotifOpen(true)} style={{ position: 'relative', width: 36, height: 36, borderRadius: 18, background: LIGHT.card, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
                <Bell size={16} color={LIGHT.ink} />
                {unreadCount > 0 && (
                  <span style={{ position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, background: LIGHT.alert, color: '#fff', fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
            )}
            <button type="button" className="tap" onClick={handleSignOut} disabled={signingOut} aria-label="Sign out" style={{ width: 36, height: 36, borderRadius: 18, background: LIGHT.card, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
              <LogOut size={16} color={LIGHT.ink} aria-hidden="true" />
            </button>
          </div>
        </div>
        <ErrorBanner message={signOutError} onDismiss={() => setSignOutError('')} />

        {tab === 'home' && canManageOfficeTabs && <OwnerHome businessProfile={company} locations={isOwner ? locations : []} />}
        {tab === 'home' && !canManageOfficeTabs && <TechHome techId={session.user.id} company={company} />}
        {tab === 'jobs' && canManageOfficeTabs && <JobsBoard company={company} locationId={selectedLocationId} />}
        {tab === 'map' && canManageOfficeTabs && <MapPage company={company} />}
        {tab === 'estimates' && isOwner && <EstimatesPage company={company} />}
        {tab === 'calendar' && <CalendarPage myTechId={canManageOfficeTabs ? null : session.user.id} locationId={canManageOfficeTabs ? selectedLocationId : null} />}
        {tab === 'clients' && canManageOfficeTabs && <ClientsPage company={company} />}
        {tab === 'catalog' && isOwner && <ServiceCatalogPage company={company} />}
        {tab === 'team' && isOwner && <TeamPage locations={locations} />}
        {tab === 'analytics' && isOwner && <AnalyticsPage company={company} />}
        {tab === 'automations' && isOwner && <AutomationsPage />}
        {tab === 'settings' && isOwner && <SettingsPage company={company} onSaved={setCompany} />}
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: LIGHT.card, borderTop: `1px solid ${LIGHT.border}`, padding: '8px 0 max(8px, env(safe-area-inset-bottom))' }}>
        {/* Scrolls horizontally rather than squeezing every tab equally -
            10 owner tabs no longer fit comfortably at equal-flex width on
            a phone screen. */}
        <div style={{ display: 'flex', gap: 2, width: '100%', maxWidth: 720, margin: '0 auto', padding: '0 8px', overflowX: 'auto' }}>
          {tabs.map((t) => {
            const Icon = t.icon
            const isActive = tab === t.id
            return (
              <button key={t.id} className="tap" onClick={() => setTab(t.id)} style={{ flex: tabs.length > 5 ? '0 0 62px' : 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 0' }}>
                <Icon size={19} color={isActive ? LIGHT.accent : LIGHT.sub} />
                <span style={{ fontSize: 9.5, fontWeight: 600, color: isActive ? LIGHT.accent : LIGHT.sub }}>{t.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {notifOpen && (
        <NotificationCenterModal
          companyId={company?.id}
          onClose={() => setNotifOpen(false)}
          onUnreadCountChange={setUnreadCount}
        />
      )}
    </div>
  )
}
