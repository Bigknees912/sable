import { X } from 'lucide-react'
import { LIGHT } from '../theme'
import { useEscapeToClose } from './useEscapeToClose'

export function money(n) {
  return (n || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })
}

export function initialsOf(name) {
  if (!name) return '?'
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

export const URGENCY_STYLE = {
  emergency: { label: 'Emergency', bg: LIGHT.alertSoft, fg: LIGHT.alert },
  sameday: { label: 'Same-Day', bg: LIGHT.accentSoft, fg: LIGHT.accent },
  standard: { label: 'Standard', bg: LIGHT.border, fg: LIGHT.sub },
}

export const STATUS_META = {
  unassigned: { label: 'Unassigned', bg: LIGHT.border, fg: LIGHT.sub },
  assigned: { label: 'Assigned', bg: LIGHT.infoSoft, fg: LIGHT.info },
  in_progress: { label: 'In Progress', bg: LIGHT.accentSoft, fg: LIGHT.accent },
  done: { label: 'Completed', bg: LIGHT.successSoft, fg: LIGHT.success },
  cancelled: { label: 'Cancelled', bg: LIGHT.border, fg: LIGHT.sub },
}

export function SectionLabel({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: LIGHT.sub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginLeft: 2 }}>{children}</div>
}

export function Badge({ children, bg, fg }) {
  return <span style={{ background: bg, color: fg, padding: '3px 9px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{children}</span>
}

export function StatCard({ icon: Icon, label, value, sub, subColor }) {
  return (
    <div style={{ background: LIGHT.card, borderRadius: 16, padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <Icon size={16} color={LIGHT.accent} style={{ marginBottom: 8 }} />
      <div style={{ fontSize: 22, fontWeight: 700, color: LIGHT.ink, marginBottom: 2 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: LIGHT.sub, marginBottom: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: subColor || LIGHT.sub, fontWeight: 600 }}>{sub}</div>}
    </div>
  )
}

export function EmptyState({ children }) {
  return <div style={{ fontSize: 13, color: LIGHT.sub, textAlign: 'center', padding: '30px 0' }}>{children}</div>
}

export function LoadingState({ children = 'Loading…' }) {
  return <div style={{ fontSize: 13, color: LIGHT.sub, textAlign: 'center', padding: '30px 0' }}>{children}</div>
}

// Full-page replacement for a failed first load - distinct from EmptyState
// (which means "the request worked, there's just nothing to show") so a
// broken request never looks the same as a normal empty list. Always
// offers a way out via onRetry rather than leaving a dead end.
export function ErrorState({ message, onRetry }) {
  return (
    <div style={{ textAlign: 'center', padding: '28px 16px', background: LIGHT.alertSoft, borderRadius: 16 }}>
      <div style={{ fontSize: 13, color: LIGHT.alert, marginBottom: onRetry ? 14 : 0 }}>{message}</div>
      {onRetry && (
        <button className="tap" onClick={onRetry} style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', background: LIGHT.alert, borderRadius: 8, padding: '8px 18px' }}>
          Try Again
        </button>
      )}
    </div>
  )
}

// Non-blocking version for when a page already has good data on screen
// (e.g. a background refresh failed) - shown as a dismissible banner
// instead of replacing the content underneath it. Also doubles as the
// error display for a failed mutation (assign, clock in/out, etc.) where
// disabling/re-enabling the specific control is handled by the caller.
export function ErrorBanner({ message, onRetry, onDismiss }) {
  if (!message) return null
  return (
    <div style={{ background: LIGHT.alertSoft, color: LIGHT.alert, borderRadius: 10, padding: '10px 12px', fontSize: 12, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ flex: 1 }}>{message}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {onRetry && <button type="button" className="tap" onClick={onRetry} style={{ fontSize: 11.5, fontWeight: 700, color: LIGHT.alert }}>Retry</button>}
        {onDismiss && <button type="button" className="tap" onClick={onDismiss} aria-label="Dismiss"><X size={14} color={LIGHT.alert} aria-hidden="true" /></button>}
      </div>
    </div>
  )
}

// Shared confirmation gate for anything destructive or hard to reverse:
// removing a team member, suspending/cancelling a company, cancelling a
// subscription. Deliberately NOT dismissible by clicking the backdrop -
// only the two buttons resolve it - so a stray click near the dialog can
// never register as either choice. `danger` (default true) colors the
// confirm button red; pass false for a confirm that isn't itself alarming
// (rare, but keeps one component instead of two near-duplicates).
export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = true, busy, error, onConfirm, onCancel }) {
  useEscapeToClose(busy ? null : onCancel)
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80, padding: 20 }}>
      <div style={{ background: LIGHT.card, borderRadius: 18, padding: 22, width: '100%', maxWidth: 380, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div id="confirm-dialog-title" style={{ fontSize: 15.5, fontWeight: 700, color: LIGHT.ink, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: LIGHT.sub, lineHeight: 1.5, marginBottom: 16 }}>{message}</div>
        <ErrorBanner message={error} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="tap"
            onClick={onCancel}
            disabled={busy}
            style={{ flex: 1, fontSize: 13, fontWeight: 600, color: LIGHT.ink, background: LIGHT.bg, border: `1px solid ${LIGHT.border}`, borderRadius: 10, padding: '10px 0' }}
          >
            {cancelLabel}
          </button>
          <button
            className="tap"
            onClick={onConfirm}
            disabled={busy}
            style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#fff', background: danger ? LIGHT.alert : LIGHT.ink, borderRadius: 10, padding: '10px 0' }}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
