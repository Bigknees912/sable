import { useState, useEffect } from 'react'
import { Plus, X, Phone, MessageSquare, ArrowRight, Landmark, Clock } from 'lucide-react'
import { useEscapeToClose } from './useEscapeToClose'
import {
  listEstimates, createEstimate, updateEstimateStatus, convertEstimateToJob,
  isStale, callHref, textHref, financingApplies,
} from '../lib/estimates'
import { findOrCreateCustomer, listJobTypes } from '../lib/jobs'
import { LIGHT } from '../theme'
import { SectionLabel, LoadingState, ErrorState, ErrorBanner, EmptyState, Badge, money } from './ui'
import { FieldLabel, TextInput, PrimaryButton, ErrorText, usePendingAction } from '../auth/ui'
import { useAsyncData } from './useAsyncData'

const STATUS_META = {
  sent: { label: 'Sent', bg: LIGHT.infoSoft, fg: LIGHT.info },
  viewed: { label: 'Viewed', bg: LIGHT.accentSoft, fg: LIGHT.accent },
  accepted: { label: 'Accepted', bg: LIGHT.successSoft, fg: LIGHT.success },
  declined: { label: 'Declined', bg: LIGHT.border, fg: LIGHT.sub },
}
const STATUS_ORDER = ['sent', 'viewed', 'accepted', 'declined']

// A quote is worth tracking whether or not it ever becomes a job - that's
// the whole point of a page separate from the Jobs board. PickUp (the AI
// receptionist) writes rows here itself via receptionist-server's
// recordQuote/createBooking; this page adds manual entry, status
// management, the 48-hour Follow Up prompt, and converting an accepted
// estimate into a real job. See AUTH.md "Estimates".
export default function EstimatesPage({ company }) {
  const [estimates, setEstimates] = useState([])
  const [actionError, setActionError] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [converting, setConverting] = useState(null)

  async function load() {
    const data = await listEstimates()
    setEstimates(data)
  }
  const { loading, error, hasLoadedOnce, reload } = useAsyncData(load, [])

  async function handleStatusChange(estimate, status) {
    const prev = estimates
    setEstimates((es) => es.map((e) => (e.id === estimate.id ? { ...e, status } : e)))
    setActionError('')
    try {
      await updateEstimateStatus(estimate.id, status)
    } catch (err) {
      setEstimates(prev)
      setActionError(err.message)
    }
  }

  if (loading) return <LoadingState />
  if (error && !hasLoadedOnce) return <ErrorState message={error} onRetry={reload} />

  const stale = estimates.filter(isStale)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <SectionLabel>Estimates</SectionLabel>
        <button className="tap" onClick={() => setNewOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: LIGHT.accent, background: LIGHT.accentSoft, borderRadius: 8, padding: '6px 10px' }}>
          <Plus size={13} /> New Estimate
        </button>
      </div>
      <ErrorBanner message={error && hasLoadedOnce ? error : ''} onRetry={reload} />
      <ErrorBanner message={actionError} onDismiss={() => setActionError('')} />

      {stale.length > 0 && (
        <div style={{ background: LIGHT.alertSoft, borderRadius: 16, padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: LIGHT.alert, marginBottom: 10 }}>
            <Clock size={13} /> {stale.length} estimate{stale.length === 1 ? '' : 's'} sitting unanswered 48+ hours
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stale.map((e) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: LIGHT.card, borderRadius: 10, padding: '9px 12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: LIGHT.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.customers?.name || e.customer_name || 'Unknown caller'}
                  </div>
                  <div style={{ fontSize: 11, color: LIGHT.sub }}>{e.description || e.job_types?.label || 'Estimate'}</div>
                </div>
                <FollowUpButtons estimate={e} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {estimates.map((e) => (
          <EstimateCard
            key={e.id}
            estimate={e}
            company={company}
            onStatusChange={(status) => handleStatusChange(e, status)}
            onConvert={() => setConverting(e)}
          />
        ))}
        {estimates.length === 0 && <EmptyState>No estimates yet. PickUp will add one automatically the next time it quotes a caller, or add one manually.</EmptyState>}
      </div>

      {newOpen && (
        <NewEstimateModal onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); reload() }} />
      )}
      {converting && (
        <ConvertToJobModal estimate={converting} onClose={() => setConverting(null)} onConverted={() => { setConverting(null); reload() }} />
      )}
    </>
  )
}

function FollowUpButtons({ estimate }) {
  const phone = estimate.customers?.phone || estimate.customer_phone
  const call = callHref(phone)
  const text = textHref(phone)
  if (!phone) return <div style={{ fontSize: 11, color: LIGHT.sub }}>No phone on file</div>
  return (
    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
      <a href={call} className="tap" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#fff', background: LIGHT.alert, borderRadius: 8, padding: '7px 10px' }}>
        <Phone size={11} /> Call
      </a>
      <a href={text} className="tap" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: LIGHT.alert, border: `1px solid ${LIGHT.alert}`, borderRadius: 8, padding: '7px 10px' }}>
        <MessageSquare size={11} /> Text
      </a>
    </div>
  )
}

function EstimateCard({ estimate, company, onStatusChange, onConvert }) {
  const meta = STATUS_META[estimate.status] || STATUS_META.sent
  const stale = isStale(estimate)
  const showFinancing = financingApplies(estimate, company)
  const customerName = estimate.customers?.name || estimate.customer_name || 'Unknown caller'

  return (
    <div style={{ background: LIGHT.card, borderRadius: 16, padding: 14, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: LIGHT.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customerName}</div>
          <div style={{ fontSize: 12, color: LIGHT.sub }}>{estimate.description || estimate.job_types?.label || 'Estimate'}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          {estimate.source === 'phone_ai' && <Badge bg={LIGHT.infoSoft} fg={LIGHT.info}>PickUp</Badge>}
          <Badge bg={meta.bg} fg={meta.fg}>{meta.label}</Badge>
        </div>
      </div>

      <div style={{ fontSize: 15, fontWeight: 700, color: LIGHT.ink, marginBottom: 8 }}>
        {estimate.price_low != null ? `${money(estimate.price_low)}–${money(estimate.price_high)}` : '—'}
      </div>

      {showFinancing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: LIGHT.accentSoft, borderRadius: 8, padding: '7px 10px', marginBottom: 10, fontSize: 11.5, fontWeight: 600, color: LIGHT.accent }}>
          <Landmark size={12} />
          Ask about financing
          {company?.financing_partner_url && (
            <a href={company.financing_partner_url} target="_blank" rel="noopener noreferrer" className="tap" style={{ marginLeft: 'auto', textDecoration: 'underline' }}>
              Open link
            </a>
          )}
        </div>
      )}

      {stale && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: LIGHT.alert, fontWeight: 600, marginBottom: 10 }}>
          <Clock size={11} /> Unanswered 48+ hours
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {STATUS_ORDER.filter((s) => s !== estimate.status).map((s) => (
          <button key={s} className="tap" onClick={() => onStatusChange(s)} style={{ fontSize: 11, fontWeight: 600, color: LIGHT.ink, border: `1px solid ${LIGHT.border}`, borderRadius: 8, padding: '6px 9px' }}>
            Mark {STATUS_META[s].label}
          </button>
        ))}
        {estimate.status === 'accepted' && !estimate.job_id && (
          <button className="tap" onClick={onConvert} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#fff', background: LIGHT.success, borderRadius: 8, padding: '6px 10px', marginLeft: 'auto' }}>
            Convert to Job <ArrowRight size={11} />
          </button>
        )}
        {estimate.job_id && <div style={{ fontSize: 11, color: LIGHT.success, fontWeight: 600, marginLeft: 'auto' }}>On the Jobs board</div>}
      </div>
    </div>
  )
}

function NewEstimateModal({ onClose, onCreated }) {
  useEscapeToClose(onClose)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [jobTypeId, setJobTypeId] = useState('')
  const [jobTypes, setJobTypes] = useState([])
  const [priceLow, setPriceLow] = useState('')
  const [priceHigh, setPriceHigh] = useState('')
  const { loading, error, run, setError } = usePendingAction()

  useEffect(() => { listJobTypes().then(setJobTypes).catch(() => {}) }, [])

  function submit() {
    if (!customerName.trim()) return setError('Customer name is required.')
    if (!priceLow || !priceHigh) return setError('Enter a price range.')
    run(async () => {
      const customer = customerPhone.trim() ? await findOrCreateCustomer({ name: customerName, phone: customerPhone }) : null
      const jobType = jobTypes.find((jt) => jt.id === jobTypeId)
      await createEstimate({
        customerId: customer?.id || null,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || null,
        jobTypeId: jobType?.id || null,
        description: jobType?.label || 'Estimate',
        priceLow: Number(priceLow),
        priceHigh: Number(priceHigh),
      })
      await onCreated()
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }} onClick={onClose}>
      <div style={{ background: LIGHT.card, borderRadius: 20, padding: 20, maxWidth: 380, width: '100%', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: LIGHT.ink }}>New Estimate</div>
          <button type="button" className="tap" onClick={onClose} aria-label="Close"><X size={18} color={LIGHT.sub} aria-hidden="true" /></button>
        </div>

        <FieldLabel htmlFor="field-customer-name-2">Customer name</FieldLabel>
        <TextInput id="field-customer-name-2" value={customerName} onChange={setCustomerName} placeholder="Sarah Chen" />
        <FieldLabel htmlFor="field-customer-phone-optional-1">Customer phone (optional)</FieldLabel>
        <TextInput id="field-customer-phone-optional-1" value={customerPhone} onChange={setCustomerPhone} placeholder="(403) 555-0119" type="tel" />

        <FieldLabel htmlFor="field-estimate-job-type">Job type</FieldLabel>
        <select id="field-estimate-job-type" value={jobTypeId} onChange={(e) => setJobTypeId(e.target.value)} style={{ width: '100%', background: '#F5F5F7', border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 14, padding: '11px 13px', marginBottom: 14, color: LIGHT.ink }}>
          <option value="">Select a service…</option>
          {jobTypes.map((jt) => <option key={jt.id} value={jt.id}>{jt.label}</option>)}
        </select>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <FieldLabel htmlFor="field-price-low-2">Price low</FieldLabel>
            <TextInput id="field-price-low-2" value={priceLow} onChange={setPriceLow} placeholder="320" type="number" />
          </div>
          <div style={{ flex: 1 }}>
            <FieldLabel htmlFor="field-price-high-2">Price high</FieldLabel>
            <TextInput id="field-price-high-2" value={priceHigh} onChange={setPriceHigh} placeholder="385" type="number" />
          </div>
        </div>

        <ErrorText>{error}</ErrorText>
        <PrimaryButton onClick={submit} disabled={loading}>{loading ? 'Saving…' : 'Create Estimate'}</PrimaryButton>
      </div>
    </div>
  )
}

function ConvertToJobModal({ estimate, onClose, onConverted }) {
  useEscapeToClose(onClose)
  const [customerName, setCustomerName] = useState(estimate.customers?.name || estimate.customer_name || '')
  const [customerPhone, setCustomerPhone] = useState(estimate.customers?.phone || estimate.customer_phone || '')
  const [address, setAddress] = useState(estimate.customers?.address || '')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledWindow, setScheduledWindow] = useState('')
  const { loading, error, run, setError } = usePendingAction()

  const needsCustomer = !estimate.customer_id

  function submit() {
    if (!address.trim()) return setError('Job address is required.')
    if (needsCustomer && !customerName.trim()) return setError('Customer name is required.')
    run(async () => {
      let customerId
      if (needsCustomer) {
        const customer = await findOrCreateCustomer({ name: customerName, phone: customerPhone || undefined, address })
        customerId = customer.id
      }
      await convertEstimateToJob(estimate, { customerId, address, scheduledDate: scheduledDate || undefined, scheduledWindow: scheduledWindow || undefined })
      await onConverted()
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }} onClick={onClose}>
      <div style={{ background: LIGHT.card, borderRadius: 20, padding: 20, maxWidth: 380, width: '100%', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: LIGHT.ink }}>Convert to Job</div>
          <button type="button" className="tap" onClick={onClose} aria-label="Close"><X size={18} color={LIGHT.sub} aria-hidden="true" /></button>
        </div>

        {needsCustomer && (
          <>
            <FieldLabel htmlFor="field-customer-name-3">Customer name</FieldLabel>
            <TextInput id="field-customer-name-3" value={customerName} onChange={setCustomerName} placeholder="Sarah Chen" />
            <FieldLabel htmlFor="field-customer-phone-2">Customer phone</FieldLabel>
            <TextInput id="field-customer-phone-2" value={customerPhone} onChange={setCustomerPhone} placeholder="(403) 555-0119" type="tel" />
          </>
        )}

        <FieldLabel htmlFor="field-job-address-2">Job address</FieldLabel>
        <TextInput id="field-job-address-2" value={address} onChange={setAddress} placeholder="412 17 Ave SE" />

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <FieldLabel htmlFor="field-date-optional-1">Date (optional)</FieldLabel>
            <TextInput id="field-date-optional-1" value={scheduledDate} onChange={setScheduledDate} type="date" />
          </div>
          <div style={{ flex: 1 }}>
            <FieldLabel htmlFor="field-window-optional-1">Window (optional)</FieldLabel>
            <TextInput id="field-window-optional-1" value={scheduledWindow} onChange={setScheduledWindow} placeholder="9:00-11:00 AM" />
          </div>
        </div>

        <ErrorText>{error}</ErrorText>
        <PrimaryButton onClick={submit} disabled={loading}>{loading ? 'Creating…' : 'Create Job'}</PrimaryButton>
      </div>
    </div>
  )
}
