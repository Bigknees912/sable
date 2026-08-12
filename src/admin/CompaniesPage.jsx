import { useEffect, useState } from 'react'
import { X, Plus, Copy, Phone, Wrench, Users2 } from 'lucide-react'
import { LIGHT } from '../theme'
import { ErrorState, LoadingState, EmptyState, Badge, StatCard, ConfirmDialog, money } from '../dashboard/ui'
import { useEscapeToClose } from '../dashboard/useEscapeToClose'
import { FieldLabel, TextInput, PrimaryButton, ErrorText, usePendingAction } from '../auth/ui'
import { listCompanies, getCompanyDetail, createCompany, setCompanyStatus, listPlansAdmin } from '../lib/admin'

const STATUS_META = {
  trial: { label: 'Trial', bg: LIGHT.infoSoft, fg: LIGHT.info },
  active: { label: 'Active', bg: LIGHT.successSoft, fg: LIGHT.success },
  suspended: { label: 'Suspended', bg: LIGHT.alertSoft, fg: LIGHT.alert },
  cancelled: { label: 'Cancelled', bg: LIGHT.border, fg: LIGHT.sub },
  // Synthetic status: still active (paid through period end) but the owner
  // chose to cancel. Distinct from a card-failure "Suspended".
  cancelling: { label: 'Cancelling', bg: '#F6E9D8', fg: '#9a5f28' },
}
const SUB_STATUS_META = {
  incomplete: { label: 'Incomplete', bg: LIGHT.border, fg: LIGHT.sub },
  active: { label: 'Billing OK', bg: LIGHT.successSoft, fg: LIGHT.success },
  past_due: { label: 'Past Due', bg: LIGHT.alertSoft, fg: LIGHT.alert },
  canceled: { label: 'Canceled', bg: LIGHT.border, fg: LIGHT.sub },
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState(undefined)
  const [error, setError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [selectedId, setSelectedId] = useState(null)

  function load() {
    setError('')
    setCompanies(undefined)
    listCompanies().then(setCompanies).catch((err) => setError(err.message || String(err)))
  }

  useEffect(load, [])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: LIGHT.sub }}>{companies ? `${companies.length} companies on the platform` : ''}</div>
        <button className="tap" onClick={() => setShowAdd(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: LIGHT.ink, color: '#fff', borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 600 }}>
          <Plus size={15} /> Add Company
        </button>
      </div>

      {error && <ErrorState message={`Couldn't load companies: ${error}`} onRetry={load} />}
      {!error && companies === undefined && <LoadingState>Loading companies…</LoadingState>}
      {companies && companies.length === 0 && <EmptyState>No companies yet.</EmptyState>}

      {companies && companies.length > 0 && (
        <div style={{ background: LIGHT.card, borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: 8, padding: '10px 16px', fontSize: 11, fontWeight: 700, color: LIGHT.sub, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${LIGHT.border}` }}>
            <div>Company</div><div>Trade</div><div>Plan</div><div>Signed Up</div><div>Status</div><div>Billing</div>
          </div>
          {companies.map((c) => {
            // A company that's chosen to leave shows as "Cancelling" until
            // its period actually lapses (then the webhook flips it to
            // suspended/cancelled) - never conflated with non-payment.
            const effectiveStatus = c.cancel_at_period_end && c.status === 'active' ? 'cancelling' : c.status
            const status = STATUS_META[effectiveStatus] || STATUS_META.active
            const sub = SUB_STATUS_META[c.subscription_status]
            return (
              <button
                key={c.id}
                type="button"
                className="tap"
                onClick={() => setSelectedId(c.id)}
                style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: 8, padding: '12px 16px', fontSize: 13, alignItems: 'center', borderBottom: `1px solid ${LIGHT.border}`, textAlign: 'left', width: '100%' }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: LIGHT.ink }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: LIGHT.sub }}>{c.tech_count} team · {c.job_count} jobs</div>
                </div>
                <div style={{ color: LIGHT.sub }}>{c.trade}</div>
                <div style={{ color: LIGHT.ink, textTransform: 'capitalize' }}>{c.plan || '—'}</div>
                <div style={{ color: LIGHT.sub }}>{new Date(c.created_at).toLocaleDateString()}</div>
                <div><Badge bg={status.bg} fg={status.fg}>{status.label}</Badge></div>
                <div>{sub && <Badge bg={sub.bg} fg={sub.fg}>{sub.label}</Badge>}</div>
              </button>
            )
          })}
        </div>
      )}

      {showAdd && <AddCompanyModal onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); load() }} />}
      {selectedId && <CompanyDetailModal companyId={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />}
    </div>
  )
}

function AddCompanyModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [trade, setTrade] = useState('Plumbing')
  const [plan, setPlan] = useState('starter')
  const [plans, setPlans] = useState([])
  const [result, setResult] = useState(null)
  const { loading, error, run, setError } = usePendingAction()

  useEffect(() => {
    listPlansAdmin().then((data) => {
      const active = data.filter((p) => p.active)
      setPlans(active)
      if (active.length) setPlan(active[0].key)
    }).catch(() => {})
  }, [])

  function submit() {
    if (!name.trim()) return setError('Business name is required.')
    run(async () => {
      const created = await createCompany({ name, contactEmail, plan, trade })
      setResult(created)
    })
  }

  return (
    <ModalShell onClose={onClose} title="Add a company by hand">
      {result ? (
        <div>
          <div style={{ fontSize: 13.5, color: LIGHT.ink, marginBottom: 12, lineHeight: 1.5 }}>
            <strong>{result.name}</strong> was created. Give this join code to the business owner - the first
            person to redeem it becomes the company's owner.
          </div>
          <JoinCodeRow code={result.join_code} />
          <PrimaryButton onClick={() => { onCreated(); }} style={{ marginTop: 14 }}>Done</PrimaryButton>
        </div>
      ) : (
        <div>
          <FieldLabel htmlFor="field-business-name-1">Business name</FieldLabel>
          <TextInput id="field-business-name-1" value={name} onChange={setName} placeholder="Reyes Plumbing Co." />
          <FieldLabel htmlFor="field-contact-email-1">Contact email</FieldLabel>
          <TextInput id="field-contact-email-1" value={contactEmail} onChange={setContactEmail} placeholder="owner@example.com" type="email" />
          <FieldLabel htmlFor="field-trade-1">Trade</FieldLabel>
          <TextInput id="field-trade-1" value={trade} onChange={setTrade} placeholder="Plumbing" />
          <FieldLabel htmlFor="field-initial-plan">Initial plan</FieldLabel>
          <select id="field-initial-plan" value={plan} onChange={(e) => setPlan(e.target.value)} style={{ width: '100%', background: '#F5F5F7', border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 14, padding: '11px 13px', marginBottom: 14, color: LIGHT.ink }}>
            {plans.map((p) => <option key={p.key} value={p.key}>{p.name} — {p.monthly_price > 0 ? money(p.monthly_price) + '/mo' : 'Free'}</option>)}
          </select>
          <ErrorText>{error}</ErrorText>
          <PrimaryButton onClick={submit} disabled={loading}>{loading ? 'Creating…' : 'Create Company'}</PrimaryButton>
        </div>
      )}
    </ModalShell>
  )
}

function CompanyDetailModal({ companyId, onClose, onChanged }) {
  const [detail, setDetail] = useState(undefined)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Set to the target status while its confirm dialog is open; null means
  // no dialog. Only 'suspended'/'cancelled' ever route through here -
  // switching to trial/active restores access, so it isn't destructive.
  const [confirmingStatus, setConfirmingStatus] = useState(null)
  const [confirmError, setConfirmError] = useState('')

  function load() {
    setError('')
    setDetail(undefined)
    getCompanyDetail(companyId).then(setDetail).catch((err) => setError(err.message || String(err)))
  }
  useEffect(load, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  function requestStatusChange(status) {
    if (status === 'suspended' || status === 'cancelled') {
      setConfirmError('')
      setConfirmingStatus(status)
    } else {
      changeStatus(status)
    }
  }

  async function changeStatus(status) {
    setBusy(true)
    try {
      await setCompanyStatus(companyId, status)
      load()
      onChanged()
      setConfirmingStatus(null)
    } catch (err) {
      setError(err.message || String(err))
      setConfirmError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title={detail?.company?.name || 'Company detail'}>
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && detail === undefined && <LoadingState>Loading…</LoadingState>}
      {detail && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <StatCard icon={Phone} label="Calls Handled" value={detail.calls_handled} />
            <StatCard icon={Wrench} label="Jobs Booked" value={detail.jobs_booked} />
            <StatCard icon={Users2} label="Technicians" value={detail.tech_count} />
            <StatCard icon={Wrench} label="Deposit Revenue" value={money(detail.deposit_revenue)} />
          </div>

          <div style={{ fontSize: 12.5, color: LIGHT.sub, marginBottom: 4 }}>Join code</div>
          <JoinCodeRow code={detail.company.join_code} />

          <div style={{ fontSize: 12.5, color: LIGHT.sub, margin: '14px 0 4px' }}>Plan</div>
          <div style={{ fontSize: 13.5, color: LIGHT.ink, textTransform: 'capitalize', marginBottom: 6 }}>
            {detail.plan || '—'} {detail.override_price != null && <span style={{ color: LIGHT.accent }}>(override: {money(detail.override_price)}/mo)</span>}
          </div>

          <div style={{ fontSize: 12.5, color: LIGHT.sub, margin: '14px 0 8px' }}>Status</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['trial', 'active', 'suspended', 'cancelled'].map((s) => (
              <button
                key={s}
                className="tap"
                disabled={busy || detail.company.status === s}
                onClick={() => requestStatusChange(s)}
                style={{
                  padding: '8px 13px', borderRadius: 20, fontSize: 12.5, fontWeight: 600,
                  border: `1.5px solid ${detail.company.status === s ? LIGHT.accent : LIGHT.border}`,
                  background: detail.company.status === s ? LIGHT.accentSoft : LIGHT.card,
                  color: detail.company.status === s ? LIGHT.accent : LIGHT.ink,
                  textTransform: 'capitalize',
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: LIGHT.sub, marginTop: 8, lineHeight: 1.4 }}>
            Suspending or cancelling blocks the company's dashboard access immediately without deleting any data.
            Every change here is written to the audit log.
          </div>
        </div>
      )}
      {confirmingStatus && (
        <ConfirmDialog
          title={confirmingStatus === 'suspended' ? `Suspend ${detail?.company?.name}?` : `Cancel ${detail?.company?.name}'s account?`}
          message={
            confirmingStatus === 'suspended'
              ? "Every user at this company loses dashboard access immediately - their receptionist and dispatch board stop working. No data is deleted, and you can restore access by switching them back to Active."
              : "Every user at this company loses dashboard access immediately, same as suspending. Cancelled is meant to be the end state for a company that's actually leaving, not a temporary hold - use Suspend for that."
          }
          confirmLabel={confirmingStatus === 'suspended' ? 'Suspend' : 'Cancel Account'}
          busy={busy}
          error={confirmError}
          onConfirm={() => changeStatus(confirmingStatus)}
          onCancel={() => { if (!busy) { setConfirmingStatus(null); setConfirmError('') } }}
        />
      )}
    </ModalShell>
  )
}

function JoinCodeRow({ code }) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F5F5F7', border: `1px solid ${LIGHT.border}`, borderRadius: 10, padding: '10px 13px' }}>
      <div style={{ flex: 1, fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: LIGHT.ink, letterSpacing: 1 }}>{code}</div>
      <button
        className="tap"
        onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600, color: LIGHT.accent }}
      >
        <Copy size={13} /> {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function ModalShell({ title, onClose, children }) {
  useEscapeToClose(onClose)
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }} onClick={onClose}>
      <div style={{ background: LIGHT.card, borderRadius: 20, padding: 22, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: LIGHT.ink }}>{title}</div>
          <button type="button" className="tap" onClick={onClose} aria-label="Close"><X size={18} color={LIGHT.sub} aria-hidden="true" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
