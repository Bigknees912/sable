import { useState } from 'react'
import { X, UserCheck, DollarSign, AlertTriangle, Clock, Star, CheckCheck } from 'lucide-react'
import { listNotifications, markNotificationRead, markAllNotificationsRead } from '../lib/notifications'
import { useEscapeToClose } from './useEscapeToClose'
import { LIGHT } from '../theme'
import { LoadingState, ErrorState, ErrorBanner, EmptyState } from './ui'
import { useAsyncData } from './useAsyncData'
import { useTableRealtime } from './useTableRealtime'

const TYPE_META = {
  job_assigned: { icon: UserCheck, bg: LIGHT.infoSoft, fg: LIGHT.info },
  payment_received: { icon: DollarSign, bg: LIGHT.successSoft, fg: LIGHT.success },
  negative_feedback: { icon: AlertTriangle, bg: LIGHT.alertSoft, fg: LIGHT.alert },
  estimate_stale: { icon: Clock, bg: LIGHT.accentSoft, fg: LIGHT.accent },
  review_left: { icon: Star, bg: LIGHT.successSoft, fg: LIGHT.success },
}

function timeAgo(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

// Opened from the bell icon in AppShell's header (owner-only). Replaces
// the scattered per-page banners - OwnerHome's negative-feedback banner,
// EstimatesPage's stale-estimate banner - with one reverse-chronological
// feed. `onUnreadCountChange` keeps AppShell's badge in sync without it
// needing its own duplicate query while this is open.
export default function NotificationCenterModal({ companyId, onClose, onUnreadCountChange }) {
  useEscapeToClose(onClose)
  const [notifications, setNotifications] = useState([])
  const [markingAll, setMarkingAll] = useState(false)

  async function load() {
    const data = await listNotifications()
    setNotifications(data)
    onUnreadCountChange?.(data.filter((n) => !n.read_at).length)
  }
  const { loading, error, hasLoadedOnce, reload } = useAsyncData(load, [])
  useTableRealtime('notifications', companyId, reload)

  async function handleOpenOne(n) {
    if (n.read_at) return
    const now = new Date().toISOString()
    setNotifications((ns) => {
      const next = ns.map((x) => (x.id === n.id ? { ...x, read_at: now } : x))
      onUnreadCountChange?.(next.filter((x) => !x.read_at).length)
      return next
    })
    try {
      await markNotificationRead(n.id)
    } catch {
      // Best-effort - a locally-marked-read row that didn't persist isn't
      // worth an error banner; the next realtime/reload sync corrects it.
    }
  }

  async function handleMarkAll() {
    setMarkingAll(true)
    try {
      await markAllNotificationsRead()
      const now = new Date().toISOString()
      setNotifications((ns) => ns.map((n) => (n.read_at ? n : { ...n, read_at: now })))
      onUnreadCountChange?.(0)
    } catch {
      // best-effort, same reasoning as handleOpenOne
    } finally {
      setMarkingAll(false)
    }
  }

  const unreadCount = notifications.filter((n) => !n.read_at).length

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 70 }} onClick={onClose}>
      <div style={{ background: LIGHT.card, borderRadius: '20px 20px 0 0', padding: 22, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: LIGHT.ink }}>Notifications</div>
          <button type="button" className="tap" onClick={onClose} aria-label="Close"><X size={20} color={LIGHT.sub} aria-hidden="true" /></button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: LIGHT.sub }}>{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</div>
          {unreadCount > 0 && (
            <button className="tap" onClick={handleMarkAll} disabled={markingAll} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 700, color: LIGHT.accent }}>
              <CheckCheck size={12} /> {markingAll ? 'Marking…' : 'Mark all read'}
            </button>
          )}
        </div>

        {loading && <LoadingState />}
        {error && !hasLoadedOnce && <ErrorState message={error} onRetry={reload} />}
        {!loading && (
          <>
            <ErrorBanner message={error && hasLoadedOnce ? error : ''} onRetry={reload} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {notifications.map((n) => {
                const meta = TYPE_META[n.type] || TYPE_META.job_assigned
                const Icon = meta.icon
                return (
                  <button
                    key={n.id}
                    type="button"
                    className="tap"
                    onClick={() => handleOpenOne(n)}
                    style={{ width: '100%', display: 'flex', gap: 10, alignItems: 'flex-start', background: n.read_at ? 'transparent' : LIGHT.bg, borderRadius: 12, padding: 10, textAlign: 'left' }}
                  >
                    <div aria-hidden="true" style={{ width: 32, height: 32, borderRadius: 9, background: meta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon size={15} color={meta.fg} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: n.read_at ? 500 : 700, color: LIGHT.ink, lineHeight: 1.3 }}>{n.title}</div>
                      {n.body && <div style={{ fontSize: 11.5, color: LIGHT.sub, marginTop: 2 }}>{n.body}</div>}
                      <div style={{ fontSize: 10.5, color: LIGHT.sub, marginTop: 3 }}>{timeAgo(n.created_at)} {!n.read_at && '· unread'}</div>
                    </div>
                    {!n.read_at && <div aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: LIGHT.accent, flexShrink: 0, marginTop: 5 }} />}
                  </button>
                )
              })}
              {notifications.length === 0 && <EmptyState>No notifications yet.</EmptyState>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
