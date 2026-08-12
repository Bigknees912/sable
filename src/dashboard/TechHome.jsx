import { useEffect, useRef, useState } from 'react'
import { Clock, CheckCircle2, Clock3, Navigation, Play, MapPin, ChevronRight, X, Phone, Users, DollarSign, History, Image as ImageIcon, Plus, Trash2 } from 'lucide-react'
import { listJobsForTechToday, advanceJobStatus, updateJobNotes, getLastVisit } from '../lib/jobs'
import { useEscapeToClose } from './useEscapeToClose'
import { listPhotosForJob, uploadJobPhoto, deleteJobPhoto } from '../lib/documents'
import { getOpenTimeEntry, clockIn, clockOut } from '../lib/timeEntries'
import { useLocationSharing } from '../lib/techLocation'
import { MapPin as MapPinIcon } from 'lucide-react'
import { LIGHT } from '../theme'
import { SectionLabel, Badge, LoadingState, ErrorState, ErrorBanner, EmptyState, money, URGENCY_STYLE } from './ui'
import { FieldLabel, ErrorText } from '../auth/ui'
import { useAsyncData } from './useAsyncData'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// Ported from app-demo.jsx's TechHome. The AI job-report generation (a raw
// client-side call to the Anthropic API with no API key/backend proxy) and
// the "on the way" SMS preview (no real SMS backend, that's now the
// server-side jobs_started_send_on_the_way trigger instead) are both
// dropped - Mark Complete now just saves the tech's notes to jobs.notes.
export default function TechHome({ techId, company }) {
  const [jobs, setJobs] = useState([])
  const [openEntry, setOpenEntry] = useState(null)
  const [detailFor, setDetailFor] = useState(null)
  const [reportFor, setReportFor] = useState(null)
  const [clockPending, setClockPending] = useState(false)
  const [startingJobId, setStartingJobId] = useState(null)
  const [actionError, setActionError] = useState('')

  async function load() {
    const [j, entry] = await Promise.all([listJobsForTechToday(techId, todayISO()), getOpenTimeEntry(techId)])
    setJobs(j)
    setOpenEntry(entry)
  }

  const { loading, error, hasLoadedOnce, reload } = useAsyncData(load, [techId])

  async function toggleClock() {
    setClockPending(true)
    setActionError('')
    try {
      if (openEntry) await clockOut(openEntry.id)
      else await clockIn(techId)
      await reload()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setClockPending(false)
    }
  }

  async function handleStart(job) {
    setStartingJobId(job.id)
    setActionError('')
    try {
      await advanceJobStatus(job.id, 'in_progress', techId)
      await reload()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setStartingJobId(null)
    }
  }

  async function handleComplete(jobId, notes) {
    await advanceJobStatus(jobId, 'done', techId, { notes })
    setReportFor(null)
    await reload()
  }

  if (loading) return <LoadingState />
  if (error && !hasLoadedOnce) return <ErrorState message={error} onRetry={reload} />

  const completedToday = jobs.filter((j) => j.status === 'done').length
  const remaining = jobs.filter((j) => j.status !== 'done').length

  // Live location sharing runs only while a job is actually in progress. The
  // hook handles the geolocation polling, foreground-only gating, and pin
  // cleanup; here we just reflect its state to the tech.
  const activeJob = jobs.find((j) => j.status === 'in_progress') || null
  const loc = useLocationSharing({ techId, companyId: company?.id, activeJob })

  return (
    <>
      <ErrorBanner message={error && hasLoadedOnce ? error : ''} onRetry={reload} />
      <ErrorBanner message={actionError} onDismiss={() => setActionError('')} />

      {activeJob && (
        <div style={{ borderRadius: 14, padding: '11px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 11, background: loc.status === 'denied' || loc.status === 'error' || loc.status === 'unavailable' ? LIGHT.alertSoft : LIGHT.successSoft, border: `1px solid ${loc.status === 'denied' || loc.status === 'error' || loc.status === 'unavailable' ? LIGHT.alert : LIGHT.success}` }}>
          <span
            className={loc.sharing ? 'pulse-loc' : ''}
            style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: loc.status === 'denied' || loc.status === 'error' || loc.status === 'unavailable' ? LIGHT.alert : LIGHT.success }}
          >
            <MapPinIcon size={15} color="#fff" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {loc.sharing && (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: LIGHT.ink }}>Sharing your location with dispatch</div>
                <div style={{ fontSize: 11.5, color: LIGHT.sub }}>
                  While “{activeJob.job_types?.label || activeJob.customers?.name || 'this job'}” is in progress. Stops when you finish it or close the app.
                </div>
              </>
            )}
            {loc.status === 'denied' && (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: LIGHT.ink }}>Location is off</div>
                <div style={{ fontSize: 11.5, color: LIGHT.sub }}>{loc.error}</div>
              </>
            )}
            {(loc.status === 'error' || loc.status === 'unavailable') && (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: LIGHT.ink }}>Location trouble</div>
                <div style={{ fontSize: 11.5, color: LIGHT.sub }}>{loc.error}</div>
              </>
            )}
            {loc.status === 'idle' && (
              <div style={{ fontSize: 12.5, color: LIGHT.sub }}>Getting your first location fix…</div>
            )}
          </div>
        </div>
      )}

      <div style={{ background: LIGHT.card, borderRadius: 16, padding: 14, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: openEntry ? LIGHT.successSoft : LIGHT.border, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Clock size={16} color={openEntry ? LIGHT.success : LIGHT.sub} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: LIGHT.ink }}>{openEntry ? 'On shift' : 'Off shift'}</div>
          <div style={{ fontSize: 11.5, color: LIGHT.sub }}>
            {openEntry ? `Clocked in at ${new Date(openEntry.clock_in).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}` : 'Not clocked in'}
          </div>
        </div>
        <button className="tap" onClick={toggleClock} disabled={clockPending} style={{ fontSize: 12, fontWeight: 600, color: openEntry ? LIGHT.alert : LIGHT.success, border: `1px solid ${openEntry ? LIGHT.alertSoft : LIGHT.successSoft}`, borderRadius: 8, padding: '7px 12px' }}>
          {clockPending ? 'Working…' : openEntry ? 'Clock Out' : 'Clock In'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
        <MiniStat icon={CheckCircle2} value={completedToday} label="Done Today" />
        <MiniStat icon={Clock3} value={remaining} label="Remaining" />
      </div>

      <SectionLabel>Today's Jobs</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {jobs.map((job) => {
          const u = URGENCY_STYLE[job.urgency]
          const isDone = job.status === 'done'
          const isInProgress = job.status === 'in_progress'
          const isStarting = startingJobId === job.id
          return (
            <div key={job.id} style={{ background: LIGHT.card, borderRadius: 18, padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', opacity: isDone ? 0.55 : 1 }}>
              <button className="tap" onClick={() => setDetailFor(job)} style={{ display: 'block', width: '100%', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: LIGHT.sub, fontWeight: 600 }}>{job.scheduled_window || '—'}</div>
                  <Badge bg={u.bg} fg={u.fg}>{u.label}</Badge>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: LIGHT.ink, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>{job.description} <ChevronRight size={15} color={LIGHT.sub} /></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: LIGHT.sub, marginBottom: 14 }}><MapPin size={13} color={LIGHT.accent} /> {job.address}</div>
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <a href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`} target="_blank" rel="noopener noreferrer" style={{ flex: 1, textAlign: 'center', border: `1px solid ${LIGHT.border}`, borderRadius: 10, padding: '10px 0', fontSize: 13, color: LIGHT.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none' }}><Navigation size={13} /> Navigate</a>
                {!isDone && !isInProgress && (
                  <button className="tap" onClick={() => handleStart(job)} disabled={isStarting} style={{ flex: 1, textAlign: 'center', borderRadius: 10, padding: '10px 0', fontSize: 13, fontWeight: 600, background: LIGHT.infoSoft, color: LIGHT.info, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <Play size={13} /> {isStarting ? 'Starting…' : 'Start Job'}
                  </button>
                )}
                {isInProgress && <button className="tap" onClick={() => setReportFor(job)} style={{ flex: 1, textAlign: 'center', borderRadius: 10, padding: '10px 0', fontSize: 13, fontWeight: 600, background: LIGHT.ink, color: LIGHT.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><CheckCircle2 size={13} /> Mark Complete</button>}
                {isDone && <div style={{ flex: 1, textAlign: 'center', borderRadius: 10, padding: '10px 0', fontSize: 13, fontWeight: 600, background: LIGHT.successSoft, color: LIGHT.success, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><CheckCircle2 size={13} /> Done</div>}
              </div>
            </div>
          )
        })}
        {jobs.length === 0 && <EmptyState>No jobs assigned today.</EmptyState>}
      </div>

      {reportFor && <CompleteJobModal job={reportFor} onClose={() => setReportFor(null)} onComplete={(notes) => handleComplete(reportFor.id, notes)} />}
      {detailFor && (
        <JobDetailModal
          job={detailFor}
          onClose={() => setDetailFor(null)}
          onSaveNotes={async (notes) => { await updateJobNotes(detailFor.id, notes); await reload() }}
        />
      )}
    </>
  )
}

function MiniStat({ icon: Icon, value, label }) {
  return (
    <div style={{ background: LIGHT.card, borderRadius: 14, padding: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', textAlign: 'center' }}>
      <Icon size={15} color={LIGHT.accent} style={{ marginBottom: 5 }} />
      <div style={{ fontSize: 15, fontWeight: 700, color: LIGHT.ink }}>{value}</div>
      <div style={{ fontSize: 9.5, color: LIGHT.sub, fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
    </div>
  )
}

function DetailRow({ icon: Icon, label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <Icon size={14} color={LIGHT.accent} style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 11.5, color: LIGHT.sub, width: 76, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: LIGHT.ink, fontWeight: 600 }}>{value}</span>
    </div>
  )
}

function JobDetailModal({ job, onClose, onSaveNotes }) {
  useEscapeToClose(onClose)
  const [notes, setNotes] = useState(job.notes || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const u = URGENCY_STYLE[job.urgency]

  // Repeat-customer context, loaded once per job open - so a tech can see
  // what was done here last time without calling the office. Silently
  // stays empty on a first-time customer or if the lookup fails; this is
  // helpful context, not something worth blocking the job detail on.
  const [lastVisit, setLastVisit] = useState(undefined)
  useEffect(() => {
    let cancelled = false
    setLastVisit(undefined)
    getLastVisit(job.customer_id, job.id)
      .then((v) => { if (!cancelled) setLastVisit(v) })
      .catch(() => { if (!cancelled) setLastVisit(null) })
    return () => { cancelled = true }
  }, [job.id, job.customer_id])

  async function save() {
    setSaving(true)
    setError('')
    try {
      await onSaveNotes(notes)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 60 }} onClick={onClose}>
      <div style={{ background: LIGHT.card, borderRadius: '20px 20px 0 0', padding: 22, width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div>
            <Badge bg={u.bg} fg={u.fg}>{u.label}</Badge>
            <div style={{ fontSize: 19, fontWeight: 700, color: LIGHT.ink, marginTop: 8 }}>{job.description}</div>
          </div>
          <button type="button" className="tap" onClick={onClose} aria-label="Close"><X size={20} color={LIGHT.sub} aria-hidden="true" /></button>
        </div>
        <div style={{ fontSize: 13, color: LIGHT.sub, marginBottom: 18 }}>{job.scheduled_window} · {job.scheduled_date}</div>

        <div style={{ background: LIGHT.bg, borderRadius: 14, padding: 14, marginBottom: 16 }}>
          <DetailRow icon={Users} label="Customer" value={job.customers?.name || '—'} />
          <DetailRow icon={MapPin} label="Address" value={job.address} />
          <DetailRow icon={DollarSign} label="Estimated" value={job.price_low != null ? `${money(job.price_low)} - ${money(job.price_high)}` : '—'} />
        </div>

        {lastVisit && <LastVisitCard visit={lastVisit} />}

        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          {job.customers?.phone && (
            <a href={`tel:${job.customers.phone.replace(/[^0-9]/g, '')}`} className="tap" style={{ flex: 1, textAlign: 'center', background: LIGHT.success, color: '#fff', borderRadius: 10, padding: '12px 0', fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none' }}>
              <Phone size={14} /> Call {job.customers.name.split(' ')[0]}
            </a>
          )}
          <a href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`} target="_blank" rel="noopener noreferrer" className="tap" style={{ flex: 1, textAlign: 'center', border: `1px solid ${LIGHT.border}`, color: LIGHT.ink, borderRadius: 10, padding: '12px 0', fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none' }}>
            <Navigation size={14} /> Navigate
          </a>
        </div>

        <FieldLabel htmlFor="field-job-notes">Job Notes</FieldLabel>
        <textarea
          id="field-job-notes"
          value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything worth remembering about this job or customer, gate code, dog in the yard, parts needed next time..."
          rows={4}
          style={{ width: '100%', background: LIGHT.bg, border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 13, padding: 12, color: LIGHT.ink, marginBottom: 10, resize: 'none' }}
        />
        <ErrorText>{error}</ErrorText>
        <button className="tap" onClick={save} disabled={saving} style={{ width: '100%', textAlign: 'center', background: LIGHT.ink, color: LIGHT.bg, border: 'none', borderRadius: 10, padding: '11px 0', fontSize: 13, fontWeight: 600 }}>
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save Notes'}
        </button>

        <div style={{ height: 1, background: LIGHT.border, margin: '18px 0' }} />
        <JobPhotosSection job={job} />
      </div>
    </div>
  )
}

function formatVisitDate(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Surfaces the most recent completed job for this same customer, right on
// the job detail view - so a tech doesn't need to call the office to ask
// what was done there before. Only rendered when getLastVisit() found one
// (see the useEffect above), so a first-time customer shows nothing here.
function LastVisitCard({ visit }) {
  return (
    <div style={{ background: LIGHT.accentSoft, borderRadius: 14, padding: 14, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: LIGHT.accent, marginBottom: 6 }}>
        <History size={13} /> Last Visit · {formatVisitDate(visit.completed_at)}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: LIGHT.ink, marginBottom: visit.notes ? 4 : 0 }}>
        {visit.job_types?.label || visit.description}
      </div>
      {visit.notes && <div style={{ fontSize: 12.5, color: LIGHT.ink, lineHeight: 1.4 }}>{visit.notes}</div>}
    </div>
  )
}

function JobPhotosSection({ job }) {
  const [photos, setPhotos] = useState(undefined)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const fileInputRef = useRef(null)

  function load() {
    setError('')
    listPhotosForJob(job.id).then(setPhotos).catch((err) => setError(err.message || String(err)))
  }
  useEffect(load, [job.id])

  function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError('')
    uploadJobPhoto({ job, customerId: job.customer_id, file })
      .then((photo) => setPhotos((ps) => [{ ...photo, url: URL.createObjectURL(file) }, ...(ps || [])]))
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setUploading(false))
  }

  async function remove(photo) {
    setDeletingId(photo.id)
    setError('')
    try {
      await deleteJobPhoto(photo)
      setPhotos((ps) => ps.filter((p) => p.id !== photo.id))
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <FieldLabel>Job Photos</FieldLabel>
        <button className="tap" onClick={() => fileInputRef.current?.click()} disabled={uploading} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: LIGHT.accent }}>
          <Plus size={13} /> {uploading ? 'Uploading…' : 'Add Photo'}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: 'none' }} />
      </div>
      {photos === undefined && !error && <div style={{ fontSize: 12, color: LIGHT.sub }}>Loading photos…</div>}
      {photos && photos.length === 0 && <div style={{ fontSize: 12, color: LIGHT.sub, marginBottom: 4 }}>No photos yet - document the work as you go.</div>}
      {photos && photos.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {photos.map((p) => (
            <div key={p.id} style={{ position: 'relative', width: 64, height: 64, opacity: deletingId === p.id ? 0.5 : 1 }}>
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  <img src={p.url} alt="Job" style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', display: 'block' }} />
                </a>
              ) : (
                <div style={{ width: 64, height: 64, borderRadius: 10, background: LIGHT.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ImageIcon size={16} color={LIGHT.sub} />
                </div>
              )}
              <button
                className="tap"
                onClick={() => remove(p)}
                disabled={deletingId === p.id}
                style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, background: LIGHT.card, boxShadow: '0 1px 3px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Trash2 size={10} color={LIGHT.alert} />
              </button>
            </div>
          ))}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  )
}

function CompleteJobModal({ job, onClose, onComplete }) {
  useEscapeToClose(onClose)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setSaving(true)
    setError('')
    try {
      await onComplete(notes)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }} onClick={onClose}>
      <div style={{ background: LIGHT.card, borderRadius: 20, padding: 20, maxWidth: 380, width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: LIGHT.ink, marginBottom: 2 }}>Finish {job.description}</div>
        <div style={{ fontSize: 11.5, color: LIGHT.sub, marginBottom: 14 }}>What did you find and do? This gets saved to the job's file.</div>
        <textarea
          value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. old wax ring failed, replaced ring + bolts, tested flush 3x no leak"
          rows={4}
          style={{ width: '100%', background: LIGHT.bg, border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 13, padding: 12, color: LIGHT.ink, marginBottom: 10, resize: 'none' }}
        />
        <ErrorText>{error}</ErrorText>
        <button className="tap" onClick={submit} disabled={saving} style={{ width: '100%', textAlign: 'center', background: LIGHT.success, color: '#fff', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 13.5, fontWeight: 600 }}>
          {saving ? 'Saving…' : 'Confirm & Complete Job'}
        </button>
      </div>
    </div>
  )
}
