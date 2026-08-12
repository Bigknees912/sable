import { useState } from 'react'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors, useDraggable, useDroppable } from '@dnd-kit/core'
import { Plus, X, Phone, Mail, CalendarClock, Voicemail } from 'lucide-react'
import { useEscapeToClose } from './useEscapeToClose'
import { listContacts, updateContactStage, createContact, PIPELINE_STAGES } from '../lib/crm'
import { listActiveContractsByCustomer, isOverdue, isDueSoon } from '../lib/contracts'
import { smsConsentScript } from '../lib/smsConsent'
import { LIGHT } from '../theme'
import { SectionLabel, LoadingState, ErrorState, ErrorBanner, initialsOf } from './ui'
import { FieldLabel, TextInput, Checkbox, PrimaryButton, ErrorText, usePendingAction } from '../auth/ui'
import { useAsyncData } from './useAsyncData'
import { useTableRealtime } from './useTableRealtime'
import ContactDetailModal from './ContactDetailModal'

// A GoHighLevel-style pipeline: every contact is a customers row with an
// explicit, manually-managed pipeline_stage (migration
// 018_customers_pipeline_stage) - dragging a card is the only thing that
// moves it. Nothing here auto-advances a stage from job/deposit/completion
// events; that's a deliberate scope decision (see AUTH.md) since silently
// overriding a rep's manual placement would be surprising.
//
// The marketing site's lead form still isn't wired to the `leads` table
// (see AUTH.md), so this board only reflects customers created through the
// app itself (New Job, phone bookings) or added here directly - it does
// not yet pull in raw web-form leads.
export default function ClientsPage({ company }) {
  const [contacts, setContacts] = useState([])
  const [contractsByCustomer, setContractsByCustomer] = useState({})
  const [addOpen, setAddOpen] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const [detailForId, setDetailForId] = useState(null)
  const [moveError, setMoveError] = useState('')

  async function load() {
    const [data, contracts] = await Promise.all([listContacts(), listActiveContractsByCustomer()])
    setContacts(data)
    setContractsByCustomer(contracts)
  }

  const { loading, error, hasLoadedOnce, reload } = useAsyncData(load, [])
  useTableRealtime('customers', company?.id, reload)

  // MouseSensor (not PointerSensor) + TouchSensor, kept deliberately
  // separate: the board scrolls horizontally on mobile, and a
  // delay-based TouchSensor is what lets a quick horizontal swipe still
  // scroll the page instead of every touch being captured as a drag
  // attempt. A PointerSensor would intercept touch input too (Pointer
  // Events cover touch in modern browsers) without that distinction.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  )

  function handleDragStart(event) {
    setActiveId(event.active.id)
  }

  async function handleDragEnd(event) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return
    const contactId = active.id
    const newStage = over.id
    const contact = contacts.find((c) => c.id === contactId)
    if (!contact || contact.pipeline_stage === newStage) return

    const prevStage = contact.pipeline_stage
    // Optimistic move so the drag feels instant; reverted below if the
    // write fails, with the failure surfaced instead of silently
    // snapping back with no explanation.
    setContacts((cs) => cs.map((c) => (c.id === contactId ? { ...c, pipeline_stage: newStage } : c)))
    setMoveError('')
    try {
      await updateContactStage(contactId, newStage)
    } catch (err) {
      setContacts((cs) => cs.map((c) => (c.id === contactId ? { ...c, pipeline_stage: prevStage } : c)))
      setMoveError(err.message)
    }
  }

  async function handleContactCreated() {
    setAddOpen(false)
    try {
      await reload()
    } catch (err) {
      setMoveError(err.message)
    }
  }

  // Patches the card's tags immediately from ContactDetailModal - avoids a
  // full reload round-trip for something the realtime subscription would
  // also eventually deliver, same optimistic-then-confirmed spirit as drag.
  function handleTagsChanged(contactId, tags) {
    setContacts((cs) => cs.map((c) => (c.id === contactId ? { ...c, tags } : c)))
  }

  // Same optimistic-patch pattern as handleTagsChanged, for the SMS
  // consent toggle in ContactDetailModal.
  function handleConsentChanged(contactId, smsConsent) {
    setContacts((cs) => cs.map((c) => (c.id === contactId ? { ...c, sms_consent: smsConsent } : c)))
  }

  // Patches the card's identifying fields to their anonymized state after
  // a PII deletion in ContactDetailModal, so the board (which still shows
  // name/phone/tags on the card) reflects it without a full reload.
  function handlePiiDeleted(contactId, deletedAt) {
    setContacts((cs) => cs.map((c) => (c.id === contactId
      ? { ...c, name: 'Deleted Customer', phone: null, email: null, address: null, tags: [], sms_consent: false, pii_deleted_at: deletedAt }
      : c)))
  }

  // Patches this customer's active-contracts list from ContactDetailModal
  // after an add/mark-serviced/cancel - same optimistic-patch spirit as
  // the handlers above, so the card's next-due badge updates without a
  // full board reload.
  function handleContractsChanged(contactId, activeContracts) {
    setContractsByCustomer((m) => ({ ...m, [contactId]: activeContracts }))
  }

  if (loading) return <LoadingState />
  if (error && !hasLoadedOnce) return <ErrorState message={error} onRetry={reload} />

  const activeContact = contacts.find((c) => c.id === activeId)
  const detailContact = contacts.find((c) => c.id === detailForId)
  const allTags = [...new Set(contacts.flatMap((c) => c.tags || []))].sort()

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <SectionLabel>Clients</SectionLabel>
        <button className="tap" onClick={() => setAddOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: LIGHT.accent, background: LIGHT.accentSoft, borderRadius: 8, padding: '6px 10px' }}>
          <Plus size={13} /> Add Contact
        </button>
      </div>
      <ErrorBanner message={error && hasLoadedOnce ? error : ''} onRetry={reload} />
      <ErrorBanner message={moveError} onDismiss={() => setMoveError('')} />

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', margin: '0 -16px', padding: '0 16px 8px' }}>
          {PIPELINE_STAGES.map((stage) => (
            <StageColumn
              key={stage.key}
              stage={stage}
              contacts={contacts.filter((c) => c.pipeline_stage === stage.key)}
              contractsByCustomer={contractsByCustomer}
              onOpen={(id) => setDetailForId(id)}
            />
          ))}
        </div>
        <DragOverlay>
          {activeContact ? (
            <div style={{ background: LIGHT.card, borderRadius: 12, padding: 10, width: 200, boxShadow: '0 10px 24px rgba(0,0,0,0.22)' }}>
              <ContactCardContent contact={activeContact} contracts={contractsByCustomer[activeContact.id]} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {addOpen && <AddContactModal company={company} onClose={() => setAddOpen(false)} onCreated={handleContactCreated} />}
      {detailContact && (
        <ContactDetailModal
          contact={detailContact}
          allTags={allTags}
          onClose={() => setDetailForId(null)}
          onTagsChanged={handleTagsChanged}
          onConsentChanged={handleConsentChanged}
          onPiiDeleted={handlePiiDeleted}
          onContractsChanged={handleContractsChanged}
        />
      )}
    </>
  )
}

function StageColumn({ stage, contacts, contractsByCustomer, onOpen }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key })
  return (
    <div
      ref={setNodeRef}
      style={{ flex: '0 0 210px', width: 210, background: isOver ? LIGHT.accentSoft : LIGHT.bg, borderRadius: 14, padding: 10, minHeight: 160, transition: 'background 0.12s ease' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '0 2px' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: LIGHT.ink, textTransform: 'uppercase', letterSpacing: 0.3 }}>{stage.label}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: LIGHT.sub, background: LIGHT.card, borderRadius: 10, padding: '1px 7px' }}>{contacts.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {contacts.map((c) => <ContactCard key={c.id} contact={c} contracts={contractsByCustomer[c.id]} onOpen={onOpen} />)}
        {contacts.length === 0 && <div style={{ fontSize: 11, color: LIGHT.sub, textAlign: 'center', padding: '18px 0' }}>Drop here</div>}
      </div>
    </div>
  )
}

function formatDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

// Earliest-due active contract only - the card is small, full details
// live in ContactDetailModal's Maintenance Contracts section.
function NextContractDue({ contracts }) {
  if (!contracts || contracts.length === 0) return null
  const next = contracts[0] // listActiveContractsByCustomer already orders by next_due_date asc
  const color = isOverdue(next) ? LIGHT.alert : isDueSoon(next) ? LIGHT.accent : LIGHT.sub
  return (
    <div style={{ fontSize: 10.5, color, display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, fontWeight: isOverdue(next) || isDueSoon(next) ? 700 : 400 }}>
      <CalendarClock size={10} /> {next.name} due {formatDate(next.next_due_date)}
    </div>
  )
}

function ContactCardContent({ contact, contracts }) {
  const tags = contact.tags || []
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: contact.phone || contact.email ? 6 : 0 }}>
        <div style={{ width: 26, height: 26, borderRadius: 13, background: LIGHT.accentSoft, color: LIGHT.accent, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {initialsOf(contact.name)}
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: LIGHT.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.name}</div>
      </div>
      {contact.capture_method === 'fallback_voicemail' && (
        <div style={{ fontSize: 9.5, fontWeight: 700, color: LIGHT.alert, background: 'rgba(162,65,51,0.10)', borderRadius: 10, padding: '2px 7px', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <Voicemail size={10} aria-hidden="true" /> Fallback voicemail
        </div>
      )}
      {contact.phone && (
        <div style={{ fontSize: 10.5, color: LIGHT.sub, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <Phone size={10} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.phone}</span>
        </div>
      )}
      {contact.email && (
        <div style={{ fontSize: 10.5, color: LIGHT.sub, display: 'flex', alignItems: 'center', gap: 4, marginBottom: tags.length > 0 ? 4 : 0 }}>
          <Mail size={10} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.email}</span>
        </div>
      )}
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {tags.slice(0, 2).map((t) => (
            <span key={t} style={{ fontSize: 9.5, fontWeight: 600, color: LIGHT.accent, background: LIGHT.accentSoft, borderRadius: 10, padding: '2px 6px' }}>{t}</span>
          ))}
          {tags.length > 2 && <span style={{ fontSize: 9.5, color: LIGHT.sub }}>+{tags.length - 2}</span>}
        </div>
      )}
      <NextContractDue contracts={contracts} />
    </>
  )
}

function ContactCard({ contact, contracts, onOpen }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: contact.id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(contact.id)}
      style={{
        background: LIGHT.card,
        borderRadius: 12,
        padding: 10,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        cursor: 'grab',
        touchAction: 'none',
        opacity: isDragging ? 0.35 : 1,
      }}
    >
      <ContactCardContent contact={contact} contracts={contracts} />
    </div>
  )
}

function AddContactModal({ company, onClose, onCreated }) {
  useEscapeToClose(onClose)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [smsConsent, setSmsConsent] = useState(false)
  const { loading, error, run } = usePendingAction()

  function submit() {
    run(async () => {
      await createContact({ name, phone, email, address, smsConsent })
      await onCreated()
    })
  }

  const canSubmit = name.trim() && !loading

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }} onClick={onClose}>
      <div style={{ background: LIGHT.card, borderRadius: 20, padding: 20, maxWidth: 380, width: '100%', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: LIGHT.ink }}>Add Contact</div>
          <button type="button" className="tap" onClick={onClose} aria-label="Close"><X size={18} color={LIGHT.sub} aria-hidden="true" /></button>
        </div>

        <FieldLabel htmlFor="field-name-3">Name</FieldLabel>
        <TextInput id="field-name-3" value={name} onChange={setName} placeholder="Sarah Chen" />
        <FieldLabel htmlFor="field-phone-1">Phone</FieldLabel>
        <TextInput id="field-phone-1" value={phone} onChange={setPhone} placeholder="(403) 555-0119" type="tel" />
        {phone.trim() && (
          <Checkbox
            checked={smsConsent}
            onChange={setSmsConsent}
            label="Customer consented to receive text messages"
            hint={`Only check this if they agreed. Read or convey: ${smsConsentScript(company?.name)}`}
          />
        )}
        <FieldLabel htmlFor="field-email-5">Email</FieldLabel>
        <TextInput id="field-email-5" value={email} onChange={setEmail} placeholder="sarah@example.com" type="email" />
        <FieldLabel htmlFor="field-address-1">Address</FieldLabel>
        <TextInput id="field-address-1" value={address} onChange={setAddress} placeholder="412 17 Ave SE" />

        <ErrorText>{error}</ErrorText>
        <PrimaryButton onClick={submit} disabled={!canSubmit}>
          {loading ? 'Adding…' : 'Add Contact'}
        </PrimaryButton>
        <div style={{ fontSize: 11, color: LIGHT.sub, marginTop: 10, textAlign: 'center' }}>Starts in New Lead - drag it to move stages.</div>
      </div>
    </div>
  )
}
