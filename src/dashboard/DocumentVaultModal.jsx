import { useRef, useState } from 'react'
import { X, Receipt, Image as ImageIcon, ShieldCheck, Plus, Trash2 } from 'lucide-react'
import { listInvoicesForCustomer, listWarrantyNotesForCustomer, listPhotosForCustomer, addWarrantyNote, uploadJobPhoto, deleteJobPhoto } from '../lib/documents'
import { useEscapeToClose } from './useEscapeToClose'
import { listJobsForCustomer } from '../lib/jobs'
import { LIGHT } from '../theme'
import { LoadingState, ErrorState, ErrorBanner, EmptyState, money } from './ui'
import { FieldLabel, PrimaryButton, ErrorText, usePendingAction } from '../auth/ui'
import { useAsyncData } from './useAsyncData'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

const INVOICE_STATUS_STYLE = {
  sent: { label: 'Sent', bg: LIGHT.infoSoft, fg: LIGHT.info },
  paid: { label: 'Paid', bg: LIGHT.successSoft, fg: LIGHT.success },
  void: { label: 'Void', bg: LIGHT.border, fg: LIGHT.sub },
}

// Every past invoice, job photo, and warranty/workmanship note tied to
// this customer, merged into one scrollable history sorted newest-first.
// Opened from ContactDetailModal - kept as its own modal rather than a
// section inside it since photo thumbnails and three separate composers
// need more room than that modal has to spare.
export default function DocumentVaultModal({ contact, onClose }) {
  useEscapeToClose(onClose)
  const [invoices, setInvoices] = useState([])
  const [photos, setPhotos] = useState([])
  const [warrantyNotes, setWarrantyNotes] = useState([])
  const [jobs, setJobs] = useState([])

  async function load() {
    const [inv, ph, notes, customerJobs] = await Promise.all([
      listInvoicesForCustomer(contact.id),
      listPhotosForCustomer(contact.id),
      listWarrantyNotesForCustomer(contact.id),
      listJobsForCustomer(contact.id),
    ])
    setInvoices(inv)
    setPhotos(ph)
    setWarrantyNotes(notes)
    setJobs(customerJobs)
  }
  const { loading, error, hasLoadedOnce, reload } = useAsyncData(load, [contact.id])

  function handlePhotoAdded(photo) {
    setPhotos((ps) => [photo, ...ps])
  }
  function handlePhotoDeleted(photoId) {
    setPhotos((ps) => ps.filter((p) => p.id !== photoId))
  }
  function handleNoteAdded(note) {
    setWarrantyNotes((ns) => [note, ...ns])
  }

  const entries = [
    ...invoices.map((i) => ({ kind: 'invoice', date: i.sent_at, data: i })),
    ...photos.map((p) => ({ kind: 'photo', date: p.created_at, data: p })),
    ...warrantyNotes.map((n) => ({ kind: 'warranty', date: n.created_at, data: n })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 70 }} onClick={onClose}>
      <div style={{ background: LIGHT.card, borderRadius: '20px 20px 0 0', padding: 22, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: LIGHT.ink }}>Document Vault</div>
            <div style={{ fontSize: 11.5, color: LIGHT.sub }}>{contact.name}</div>
          </div>
          <button type="button" className="tap" onClick={onClose} aria-label="Close"><X size={20} color={LIGHT.sub} aria-hidden="true" /></button>
        </div>
        <div style={{ fontSize: 12, color: LIGHT.sub, marginBottom: 16, lineHeight: 1.4 }}>
          Every invoice, job photo, and warranty note tied to this customer, newest first.
        </div>

        {loading && <LoadingState />}
        {error && !hasLoadedOnce && <ErrorState message={error} onRetry={reload} />}
        {!loading && (
          <>
            <ErrorBanner message={error && hasLoadedOnce ? error : ''} onRetry={reload} />

            <AddWarrantyNoteForm customerId={contact.id} onAdded={handleNoteAdded} />
            <AddPhotoForm customerId={contact.id} jobs={jobs} onAdded={handlePhotoAdded} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
              {entries.map((entry) => (
                <VaultEntry key={`${entry.kind}-${entry.data.id}`} entry={entry} onPhotoDeleted={handlePhotoDeleted} />
              ))}
              {entries.length === 0 && <EmptyState>Nothing in the vault yet.</EmptyState>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function VaultEntry({ entry, onPhotoDeleted }) {
  if (entry.kind === 'invoice') {
    const inv = entry.data
    const s = INVOICE_STATUS_STYLE[inv.status] || INVOICE_STATUS_STYLE.sent
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: LIGHT.bg, borderRadius: 12, padding: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: LIGHT.card, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Receipt size={14} color={LIGHT.accent} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: LIGHT.ink }}>Invoice {inv.invoice_no} · {money(inv.amount)}</div>
          <div style={{ fontSize: 10.5, color: LIGHT.sub }}>{formatDate(inv.sent_at)}</div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '3px 8px', background: s.bg, color: s.fg, flexShrink: 0 }}>{s.label}</span>
      </div>
    )
  }

  if (entry.kind === 'photo') {
    return <PhotoEntry photo={entry.data} onDeleted={onPhotoDeleted} />
  }

  const note = entry.data
  return (
    <div style={{ display: 'flex', gap: 10, background: LIGHT.bg, borderRadius: 12, padding: 10 }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, background: LIGHT.card, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <ShieldCheck size={14} color={LIGHT.accent} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: LIGHT.ink, lineHeight: 1.4 }}>{note.body}</div>
        <div style={{ fontSize: 10.5, color: LIGHT.sub, marginTop: 2 }}>{note.created_by?.name || 'Someone'} · {formatDate(note.created_at)}</div>
      </div>
    </div>
  )
}

function PhotoEntry({ photo, onDeleted }) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function remove() {
    setDeleting(true)
    setError('')
    try {
      await deleteJobPhoto(photo)
      onDeleted(photo.id)
    } catch (err) {
      setError(err.message || String(err))
      setDeleting(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 10, background: LIGHT.bg, borderRadius: 12, padding: 10, opacity: deleting ? 0.5 : 1 }}>
      {photo.url ? (
        <a href={photo.url} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
          <img src={photo.url} alt={photo.caption || 'Job photo'} style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', display: 'block' }} />
        </a>
      ) : (
        <div style={{ width: 48, height: 48, borderRadius: 8, background: LIGHT.card, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <ImageIcon size={16} color={LIGHT.sub} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: LIGHT.ink }}>{photo.caption || photo.jobs?.description || 'Job photo'}</div>
        <div style={{ fontSize: 10.5, color: LIGHT.sub, marginTop: 2 }}>{formatDate(photo.created_at)}</div>
        <ErrorText>{error}</ErrorText>
      </div>
      <button type="button" className="tap" onClick={remove} disabled={deleting} aria-label="Delete photo" style={{ color: LIGHT.sub, flexShrink: 0, alignSelf: 'flex-start' }}>
        <Trash2 size={13} aria-hidden="true" />
      </button>
    </div>
  )
}

function AddWarrantyNoteForm({ customerId, onAdded }) {
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const { loading, error, run, setError } = usePendingAction()

  function submit() {
    if (!body.trim()) return setError('Enter a note first.')
    run(async () => {
      const note = await addWarrantyNote({ customerId, body: body.trim() })
      setBody('')
      setOpen(false)
      onAdded(note)
    })
  }

  if (!open) {
    return (
      <button className="tap" onClick={() => setOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: LIGHT.accent, marginBottom: 10 }}>
        <Plus size={13} /> Add Warranty / Workmanship Note
      </button>
    )
  }

  return (
    <div style={{ background: LIGHT.bg, borderRadius: 12, padding: 10, marginBottom: 10 }}>
      <FieldLabel htmlFor="field-warranty-note">Warranty / workmanship note</FieldLabel>
      <textarea
        id="field-warranty-note"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="e.g. 1yr parts + labor warranty on water heater install, expires Jul 2027"
        rows={3}
        style={{ width: '100%', background: LIGHT.card, border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 13, padding: 10, color: LIGHT.ink, marginBottom: 8, resize: 'none' }}
      />
      <ErrorText>{error}</ErrorText>
      <div style={{ display: 'flex', gap: 8 }}>
        <PrimaryButton onClick={submit} disabled={loading} style={{ flex: 1 }}>{loading ? 'Saving…' : 'Save Note'}</PrimaryButton>
        <button className="tap" onClick={() => { setOpen(false); setBody('') }} disabled={loading} style={{ fontSize: 12.5, fontWeight: 600, color: LIGHT.sub, padding: '0 12px' }}>Cancel</button>
      </div>
    </div>
  )
}

function AddPhotoForm({ customerId, jobs, onAdded }) {
  const [jobId, setJobId] = useState('')
  const { loading, error, run, setError } = usePendingAction()
  const fileInputRef = useRef(null)

  function pickFile() {
    if (!jobId) return setError('Pick which job this photo belongs to first.')
    setError('')
    fileInputRef.current?.click()
  }

  function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const job = jobs.find((j) => j.id === jobId)
    run(async () => {
      const photo = await uploadJobPhoto({ job, customerId, file, caption: job?.description || null })
      onAdded({ ...photo, url: URL.createObjectURL(file), jobs: { description: job?.description } })
    })
  }

  if (jobs.length === 0) {
    return <div style={{ fontSize: 11.5, color: LIGHT.sub, marginBottom: 10 }}>Add a job for this customer before attaching photos.</div>
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <select
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          style={{ flex: 1, minWidth: 0, background: LIGHT.bg, border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 12.5, padding: '9px 10px', color: LIGHT.ink }}
        >
          <option value="">Photo is from which job?</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.description} ({j.scheduled_date || 'unscheduled'})</option>)}
        </select>
        <button className="tap" onClick={pickFile} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: '#fff', background: LIGHT.accent, borderRadius: 10, padding: '9px 12px', whiteSpace: 'nowrap', flexShrink: 0 }}>
          <Plus size={13} /> {loading ? 'Uploading…' : 'Add Photo'}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: 'none' }} />
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  )
}
