import { useState } from 'react'
import { CheckCircle2, DollarSign, Plus, X, Route, Copy, ExternalLink, AlertTriangle } from 'lucide-react'
import { useEscapeToClose } from './useEscapeToClose'
import { listJobs, listJobTypes, listTeamTechs, listTechLocationsById, assignJob, findOrCreateCustomer, createJob, distanceKm } from '../lib/jobs'
import { createDepositCheckout } from '../lib/deposits'
import { smsConsentScript } from '../lib/smsConsent'
import { listParts, listJobTypePartsMap, listTechPartStockMap, techsMissingParts } from '../lib/inventory'
import { LIGHT } from '../theme'
import { SectionLabel, Badge, LoadingState, ErrorState, ErrorBanner, EmptyState, money, initialsOf, STATUS_META } from './ui'
import { FieldLabel, TextInput, Checkbox, PrimaryButton, ErrorText, usePendingAction } from '../auth/ui'
import { useJobsRealtime } from './useJobsRealtime'
import { useAsyncData } from './useAsyncData'

const COLUMNS = ['unassigned', 'assigned', 'in_progress', 'done']

function depositAmount(high, depositPct) {
  return Math.round((high * (depositPct / 100)) / 5) * 5
}

// Ported from app-demo.jsx's JobsBoard. The "sorted by distance" assign
// picker is real haversine math (lib/jobs.js's distanceKm) instead of the
// demo's fake per-pair hash, but shows "—" until jobs/techs actually have
// lat/lng - there's no geocoding pipeline wired up yet.
export default function JobsBoard({ company, locationId }) {
  const [jobs, setJobs] = useState([])
  const [techs, setTechs] = useState([])
  const [techLocations, setTechLocations] = useState({})
  const [jobTypes, setJobTypes] = useState([])
  const [parts, setParts] = useState([])
  const [jobTypePartsMap, setJobTypePartsMap] = useState({})
  const [techStockMap, setTechStockMap] = useState({})
  const [pickerFor, setPickerFor] = useState(null)
  const [newJobOpen, setNewJobOpen] = useState(false)
  const [assigningJobId, setAssigningJobId] = useState(null)
  const [sendingDepositId, setSendingDepositId] = useState(null)
  const [actionError, setActionError] = useState('')
  const [depositLink, setDepositLink] = useState(null)

  async function load() {
    const [j, t, locs, jt, p, jtp, stock] = await Promise.all([
      listJobs({ locationId }), listTeamTechs({ locationId }), listTechLocationsById(), listJobTypes(),
      listParts(), listJobTypePartsMap(), listTechPartStockMap(),
    ])
    setJobs(j)
    setTechs(t)
    setTechLocations(locs)
    setJobTypes(jt)
    setParts(p)
    setJobTypePartsMap(jtp)
    setTechStockMap(stock)
  }

  // Re-fetches when the owner flips the location switcher (migration 056) -
  // same effect dependency shape useAsyncData already gives every other
  // page that takes a filter prop.
  const { loading, error, hasLoadedOnce, reload } = useAsyncData(load, [locationId])

  // Picks up a job Alex books over the phone (or any other change) live,
  // without a manual refresh.
  useJobsRealtime(company?.id, reload)

  async function handleAssign(jobId, techId, currentStatus) {
    setAssigningJobId(jobId)
    setActionError('')
    try {
      await assignJob(jobId, techId, currentStatus)
      setPickerFor(null)
      await reload()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setAssigningJobId(null)
    }
  }

  async function handleJobCreated() {
    // The job was already created successfully at this point - close the
    // modal regardless, and route a refresh failure to the board's own
    // error banner rather than the modal's (which would unmount the
    // instant we close it, silently swallowing the error).
    setNewJobOpen(false)
    try {
      await reload()
    } catch (err) {
      setActionError(err.message)
    }
  }

  async function handleSendDeposit(jobId) {
    setSendingDepositId(jobId)
    setActionError('')
    try {
      const result = await createDepositCheckout(jobId)
      setDepositLink({ url: result.url, amount: result.amount })
      await reload()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setSendingDepositId(null)
    }
  }

  if (loading) return <LoadingState />
  if (error && !hasLoadedOnce) return <ErrorState message={error} onRetry={reload} />

  const pickerJob = jobs.find((j) => j.id === pickerFor)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <SectionLabel>Job Board</SectionLabel>
        <button className="tap" onClick={() => setNewJobOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: LIGHT.accent, background: LIGHT.accentSoft, borderRadius: 8, padding: '6px 10px' }}>
          <Plus size={13} /> New Job
        </button>
      </div>
      <ErrorBanner message={error && hasLoadedOnce ? error : ''} onRetry={reload} />
      <ErrorBanner message={actionError} onDismiss={() => setActionError('')} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {COLUMNS.map((col) => {
          const colJobs = jobs.filter((j) => j.status === col)
          const meta = STATUS_META[col]
          return (
            <div key={col}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Badge bg={meta.bg} fg={meta.fg}>{meta.label}</Badge>
                <span style={{ fontSize: 12, color: LIGHT.sub }}>{colJobs.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {colJobs.map((j) => {
                  const tech = j.assigned_tech
                  const needsDeposit = company && j.price_high != null && j.price_high >= company.deposit_threshold
                  const suggested = !tech && techs.length > 0 ? techs[0] : null
                  return (
                    <div key={j.id} style={{ background: LIGHT.card, borderRadius: 14, padding: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <div style={{ fontSize: 13.5, fontWeight: 600, color: LIGHT.ink }}>{j.description}</div>
                            {j.is_callback && <Badge bg={j.callback_needs_review ? 'rgba(162,65,51,0.12)' : LIGHT.accentSoft} fg={j.callback_needs_review ? LIGHT.alert : LIGHT.accent}>{j.callback_needs_review ? 'Warranty callback · review' : 'Callback · no charge'}</Badge>}
                          </div>
                          <div style={{ fontSize: 12, color: LIGHT.sub }}>{j.customers?.name || 'No customer'} · {j.address}</div>
                        </div>
                        {tech && <div style={{ width: 26, height: 26, borderRadius: 13, background: LIGHT.accentSoft, color: LIGHT.accent, fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initialsOf(tech.name)}</div>}
                        {!tech && suggested && (
                          <button className="tap" onClick={() => handleAssign(j.id, suggested.id, j.status)} disabled={assigningJobId === j.id} style={{ fontSize: 11.5, fontWeight: 600, color: '#fff', background: LIGHT.accent, borderRadius: 8, padding: '7px 10px', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <CheckCircle2 size={12} /> {assigningJobId === j.id ? 'Assigning…' : `Assign ${suggested.name.split(' ')[0]}`}
                          </button>
                        )}
                        <button type="button" className="tap" onClick={() => setPickerFor(j.id)} disabled={assigningJobId === j.id} aria-label="More options" style={{ fontSize: 16, color: LIGHT.sub, padding: '4px 6px', flexShrink: 0 }}>⋯</button>
                      </div>
                      {needsDeposit && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${LIGHT.border}` }}>
                          {j.deposit_status === 'paid' ? (
                            <div style={{ fontSize: 11, color: LIGHT.success, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <CheckCircle2 size={11} /> Deposit paid — {money(j.deposit_amount)}
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                              <div style={{ fontSize: 11, color: LIGHT.sub, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <DollarSign size={11} color={LIGHT.accent} />
                                Deposit due: {money(j.deposit_amount ?? depositAmount(j.price_high, company.deposit_pct))}
                                {j.deposit_status === 'pending' && <span style={{ color: LIGHT.accent, fontWeight: 600 }}>· link sent</span>}
                              </div>
                              <button
                                className="tap"
                                onClick={() => handleSendDeposit(j.id)}
                                disabled={sendingDepositId === j.id}
                                style={{ fontSize: 10.5, fontWeight: 600, color: LIGHT.accent, whiteSpace: 'nowrap', flexShrink: 0 }}
                              >
                                {sendingDepositId === j.id ? 'Sending…' : j.deposit_status === 'pending' ? 'Resend Link' : 'Send Deposit Link'}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
                {colJobs.length === 0 && <div style={{ fontSize: 12, color: LIGHT.sub, padding: '6px 2px' }}>Nothing here.</div>}
              </div>
            </div>
          )
        })}
      </div>

      {pickerJob && (
        <AssignPicker
          job={pickerJob}
          techs={techs}
          techLocations={techLocations}
          parts={parts}
          jobTypePartsMap={jobTypePartsMap}
          techStockMap={techStockMap}
          assigning={assigningJobId === pickerJob.id}
          onAssign={(techId) => handleAssign(pickerJob.id, techId, pickerJob.status)}
          onClose={() => setPickerFor(null)}
        />
      )}
      {newJobOpen && (
        <NewJobModal
          jobTypes={jobTypes}
          company={company}
          onClose={() => setNewJobOpen(false)}
          onCreated={handleJobCreated}
        />
      )}
      {depositLink && <DepositLinkModal link={depositLink} onClose={() => setDepositLink(null)} />}
    </>
  )
}

// Shows the real Stripe Checkout URL right after it's created. There's no
// automated SMS/email delivery wired up, so "sending" it means the owner
// copies/opens this and shares it with the customer themselves (read it
// over the phone, text it manually, etc).
function DepositLinkModal({ link, onClose }) {
  useEscapeToClose(onClose)
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard?.writeText(link.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }} onClick={onClose}>
      <div style={{ background: LIGHT.card, borderRadius: 20, padding: 20, maxWidth: 380, width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: LIGHT.ink }}>Deposit link ready</div>
          <button type="button" className="tap" onClick={onClose} aria-label="Close"><X size={18} color={LIGHT.sub} aria-hidden="true" /></button>
        </div>
        <div style={{ fontSize: 12.5, color: LIGHT.sub, marginBottom: 16 }}>
          {money(link.amount)} due. Share this link with the customer — it's a real Stripe checkout page.
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input readOnly aria-label="Deposit checkout link" value={link.url} onFocus={(e) => e.target.select()} style={{ flex: 1, minWidth: 0, background: LIGHT.bg, border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 12, padding: '10px 12px', color: LIGHT.ink }} />
          <button type="button" className="tap" onClick={copy} aria-label="Copy link" style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 10, background: LIGHT.bg, border: `1px solid ${LIGHT.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Copy size={15} color={LIGHT.ink} aria-hidden="true" />
          </button>
        </div>
        {copied && <div style={{ fontSize: 11.5, color: LIGHT.success, marginBottom: 10 }}>Copied</div>}
        <a href={link.url} target="_blank" rel="noopener noreferrer" className="tap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: LIGHT.ink, color: '#fff', borderRadius: 10, padding: '11px 0', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
          <ExternalLink size={14} /> Open Checkout Page
        </a>
      </div>
    </div>
  )
}

function AssignPicker({ job, techs, techLocations, parts, jobTypePartsMap, techStockMap, assigning, onAssign, onClose }) {
  useEscapeToClose(assigning ? null : onClose)
  function distanceTo(tech) {
    const loc = techLocations[tech.id]
    return distanceKm(job.lat, job.lng, loc?.lat, loc?.lng)
  }
  const ranked = [...techs].sort((a, b) => {
    const da = distanceTo(a)
    const db = distanceTo(b)
    if (da == null && db == null) return a.name.localeCompare(b.name)
    if (da == null) return 1
    if (db == null) return -1
    return da - db
  })
  // Warn-only, never blocks the tap: an owner may still want to send
  // someone out for a partial job or a supply-store run on the way.
  const partsById = Object.fromEntries((parts || []).map((p) => [p.id, p]))
  const missingByTech = techsMissingParts(job.job_type_id, jobTypePartsMap || {}, techStockMap || {}, partsById)
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 }} onClick={assigning ? undefined : onClose}>
      <div style={{ background: LIGHT.card, borderRadius: '20px 20px 0 0', padding: 20, width: '100%', maxWidth: 480, opacity: assigning ? 0.6 : 1 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: LIGHT.ink, marginBottom: 2 }}>Assign to</div>
        <div style={{ fontSize: 11.5, color: LIGHT.sub, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 14 }}><Route size={11} /> {assigning ? 'Assigning…' : 'Sorted by distance where known'}</div>
        {ranked.map((t) => {
          const d = distanceTo(t)
          const missing = missingByTech.get(t.id)
          return (
            <button key={t.id} className="tap" onClick={() => onAssign(t.id)} disabled={assigning} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 6px', textAlign: 'left' }}>
              <div style={{ width: 32, height: 32, borderRadius: 16, background: LIGHT.accentSoft, color: LIGHT.accent, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initialsOf(t.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, color: LIGHT.ink }}>{t.name}</span>
                {missing && missing.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <AlertTriangle size={10} color={LIGHT.alert} />
                    <span style={{ fontSize: 10.5, color: LIGHT.alert, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      Out of {missing.join(', ')}
                    </span>
                  </div>
                )}
              </div>
              <span style={{ fontSize: 12, color: LIGHT.sub, flexShrink: 0 }}>{d != null ? `${d.toFixed(1)} km away` : '—'}</span>
            </button>
          )
        })}
        {techs.length === 0 && <div style={{ fontSize: 13, color: LIGHT.sub }}>No team members yet.</div>}
      </div>
    </div>
  )
}

function NewJobModal({ jobTypes, company, onClose, onCreated }) {
  useEscapeToClose(onClose)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [address, setAddress] = useState('')
  const [jobTypeId, setJobTypeId] = useState(jobTypes[0]?.id || '')
  const [urgency, setUrgency] = useState('standard')
  const [priceLow, setPriceLow] = useState('')
  const [priceHigh, setPriceHigh] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledWindow, setScheduledWindow] = useState('')
  const [smsConsent, setSmsConsent] = useState(false)
  const { loading, error, run } = usePendingAction()

  function submit() {
    run(async () => {
      const customer = await findOrCreateCustomer({ name: customerName, phone: customerPhone, address, smsConsent })
      const jobType = jobTypes.find((jt) => jt.id === jobTypeId)
      await createJob({
        customerId: customer.id,
        jobTypeId: jobType?.id || null,
        description: jobType?.label || 'Service call',
        address,
        urgency,
        scheduledDate,
        scheduledWindow,
        priceLow: priceLow ? Number(priceLow) : null,
        priceHigh: priceHigh ? Number(priceHigh) : null,
      })
      await onCreated()
    })
  }

  const canSubmit = customerName.trim() && address.trim() && jobTypeId && !loading

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }} onClick={onClose}>
      <div style={{ background: LIGHT.card, borderRadius: 20, padding: 20, maxWidth: 380, width: '100%', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: LIGHT.ink }}>New Job</div>
          <button type="button" className="tap" onClick={onClose} aria-label="Close"><X size={18} color={LIGHT.sub} aria-hidden="true" /></button>
        </div>

        <FieldLabel htmlFor="field-customer-name-1">Customer name</FieldLabel>
        <TextInput id="field-customer-name-1" value={customerName} onChange={setCustomerName} placeholder="Sarah Chen" />
        <FieldLabel htmlFor="field-customer-phone-1">Customer phone</FieldLabel>
        <TextInput id="field-customer-phone-1" value={customerPhone} onChange={setCustomerPhone} placeholder="(403) 555-0119" type="tel" />
        {customerPhone.trim() && (
          <Checkbox
            checked={smsConsent}
            onChange={setSmsConsent}
            label="Customer consented to receive text messages"
            hint={`Only check this if they agreed. Read or convey: ${smsConsentScript(company?.name)}`}
          />
        )}
        <FieldLabel htmlFor="field-job-address-1">Job address</FieldLabel>
        <TextInput id="field-job-address-1" value={address} onChange={setAddress} placeholder="412 17 Ave SE" />

        <FieldLabel htmlFor="field-new-job-type">Job type</FieldLabel>
        <select id="field-new-job-type" value={jobTypeId} onChange={(e) => setJobTypeId(e.target.value)} style={{ width: '100%', background: '#F5F5F7', border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 14, padding: '11px 13px', marginBottom: 14, color: LIGHT.ink }}>
          {jobTypes.length === 0 && <option value="">No job types set up</option>}
          {jobTypes.map((jt) => <option key={jt.id} value={jt.id}>{jt.label}</option>)}
        </select>

        <FieldLabel htmlFor="field-new-job-urgency">Urgency</FieldLabel>
        <select id="field-new-job-urgency" value={urgency} onChange={(e) => setUrgency(e.target.value)} style={{ width: '100%', background: '#F5F5F7', border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 14, padding: '11px 13px', marginBottom: 14, color: LIGHT.ink }}>
          <option value="standard">Standard</option>
          <option value="sameday">Same-Day</option>
          <option value="emergency">Emergency</option>
        </select>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <FieldLabel htmlFor="field-price-low-1">Price low</FieldLabel>
            <TextInput id="field-price-low-1" value={priceLow} onChange={setPriceLow} placeholder="320" type="number" />
          </div>
          <div style={{ flex: 1 }}>
            <FieldLabel htmlFor="field-price-high-1">Price high</FieldLabel>
            <TextInput id="field-price-high-1" value={priceHigh} onChange={setPriceHigh} placeholder="385" type="number" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <FieldLabel htmlFor="field-date-1">Date</FieldLabel>
            <TextInput id="field-date-1" value={scheduledDate} onChange={setScheduledDate} type="date" />
          </div>
          <div style={{ flex: 1 }}>
            <FieldLabel htmlFor="field-window-1">Window</FieldLabel>
            <TextInput id="field-window-1" value={scheduledWindow} onChange={setScheduledWindow} placeholder="9:00-11:00 AM" />
          </div>
        </div>

        <ErrorText>{error}</ErrorText>
        <PrimaryButton onClick={submit} disabled={!canSubmit}>
          {loading ? 'Creating…' : 'Create Job'}
        </PrimaryButton>
      </div>
    </div>
  )
}
