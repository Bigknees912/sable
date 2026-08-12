import { useState } from 'react'
import { X, Phone, Mail, MapPin, StickyNote, PhoneCall, MessageCircle, MessageCircleOff, ShieldOff, Trash2, CalendarClock, Plus, CheckCircle2, FolderOpen } from 'lucide-react'
import { listInteractions, addInteraction, updateContactTags, updateContactConsent, deleteContactPii, PIPELINE_STAGES } from '../lib/crm'
import { useEscapeToClose } from './useEscapeToClose'
import { listContractsForCustomer, createContract, markContractServiced, cancelContract, isOverdue, isDueSoon } from '../lib/contracts'
import { LIGHT } from '../theme'
import { initialsOf, LoadingState, ErrorState, ErrorBanner, money } from './ui'
import { FieldLabel, TextInput, PrimaryButton, ErrorText, usePendingAction } from '../auth/ui'
import { useAsyncData } from './useAsyncData'
import DocumentVaultModal from './DocumentVaultModal'

function formatWhen(iso) {
  return new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Opened by clicking a card on the pipeline board (see ClientsPage.jsx).
// Three things live here that the compact card can't show: the tag
// editor, the interaction timeline, and (see below) recurring maintenance
// contracts (view/add/mark serviced/cancel).
export default function ContactDetailModal({ contact, allTags, onClose, onTagsChanged, onConsentChanged, onPiiDeleted, onContractsChanged }) {
  useEscapeToClose(onClose)
  const [interactions, setInteractions] = useState([])
  const [tags, setTags] = useState(contact.tags || [])
  const [tagInput, setTagInput] = useState('')
  const [tagError, setTagError] = useState('')
  const [smsConsent, setSmsConsent] = useState(contact.sms_consent ?? false)
  const [consentSaving, setConsentSaving] = useState(false)
  const [consentError, setConsentError] = useState('')
  const [piiDeletedAt, setPiiDeletedAt] = useState(contact.pii_deleted_at || null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deletingPii, setDeletingPii] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [composerType, setComposerType] = useState('note')
  const [composerBody, setComposerBody] = useState('')
  const { loading: posting, error: postError, run: runPost } = usePendingAction()

  async function load() {
    const data = await listInteractions(contact.id)
    setInteractions(data)
  }
  const { loading, error, hasLoadedOnce, reload } = useAsyncData(load, [contact.id])

  const [contracts, setContracts] = useState([])
  async function loadContracts() {
    const data = await listContractsForCustomer(contact.id)
    setContracts(data)
  }
  const { loading: contractsLoading, error: contractsError, hasLoadedOnce: contractsLoadedOnce, reload: reloadContracts } = useAsyncData(loadContracts, [contact.id])

  // Re-reads this customer's contracts and pushes the active subset up to
  // ClientsPage's board card - same "notify the parent" pattern as
  // onTagsChanged/onConsentChanged, just via a fresh server read (contract
  // lists are small and infrequently changed, so a full refetch after any
  // add/service/cancel is simpler than hand-patching local state).
  async function refreshContracts() {
    const fresh = await listContractsForCustomer(contact.id)
    setContracts(fresh)
    onContractsChanged?.(contact.id, fresh.filter((c) => c.status === 'active').sort((a, b) => a.next_due_date.localeCompare(b.next_due_date)))
    return fresh
  }

  async function saveTags(nextTags) {
    const prev = tags
    setTags(nextTags) // optimistic
    setTagError('')
    try {
      await updateContactTags(contact.id, nextTags)
      onTagsChanged(contact.id, nextTags)
    } catch (err) {
      setTags(prev)
      setTagError(err.message)
    }
  }

  function addTag(raw) {
    const t = raw.trim()
    if (!t || tags.includes(t)) return
    saveTags([...tags, t])
    setTagInput('')
  }
  function removeTag(t) {
    saveTags(tags.filter((x) => x !== t))
  }

  // Bidirectional, unlike the creation-time consent checkboxes (JobsBoard/
  // ClientsPage) which only ever turn consent on - this is the one place a
  // rep can revoke it too, e.g. if the customer asks not to be texted.
  async function toggleConsent() {
    const next = !smsConsent
    const prev = smsConsent
    setSmsConsent(next) // optimistic
    setConsentSaving(true)
    setConsentError('')
    try {
      await updateContactConsent(contact.id, next)
      onConsentChanged(contact.id, next)
    } catch (err) {
      setSmsConsent(prev)
      setConsentError(err.message)
    } finally {
      setConsentSaving(false)
    }
  }

  // GDPR/PIPEDA-style erasure - irreversible, so this requires an explicit
  // second tap (see the confirmingDelete UI below) rather than firing on
  // the first click like every other action in this modal. Only scrubs
  // structured fields (name/phone/email/address/tags) - jobs and invoices
  // tied to this customer are untouched (legitimate accounting/warranty
  // records), and existing note/call timeline entries below aren't
  // auto-redacted even if they happen to mention the customer's name -
  // see AUTH.md "Data deletion & privacy requests" for that limitation.
  async function confirmDeletePii() {
    setDeletingPii(true)
    setDeleteError('')
    try {
      await deleteContactPii(contact.id, 'Deleted from contact detail')
      const now = new Date().toISOString()
      setPiiDeletedAt(now)
      setConfirmingDelete(false)
      onPiiDeleted(contact.id, now)
    } catch (err) {
      setDeleteError(err.message)
    } finally {
      setDeletingPii(false)
    }
  }

  function submitInteraction() {
    if (!composerBody.trim()) return
    runPost(async () => {
      await addInteraction({ customerId: contact.id, type: composerType, body: composerBody.trim() })
      setComposerBody('')
      await reload()
    })
  }

  const [vaultOpen, setVaultOpen] = useState(false)

  const [addingContract, setAddingContract] = useState(false)
  const [contractName, setContractName] = useState('')
  const [contractFrequency, setContractFrequency] = useState('12')
  const [contractPrice, setContractPrice] = useState('')
  const [contractNextDue, setContractNextDue] = useState('')
  const { loading: savingContract, error: addContractError, run: runAddContract, setError: setAddContractError } = usePendingAction()
  const [contractActionId, setContractActionId] = useState(null)
  const [contractActionError, setContractActionError] = useState('')

  function submitContract() {
    if (!contractName.trim() || !contractNextDue) return setAddContractError('Name and next-due date are required.')
    const freqNum = Number(contractFrequency)
    if (!Number.isFinite(freqNum) || freqNum <= 0) return setAddContractError('Enter a valid frequency in months.')
    const priceNum = contractPrice.trim() === '' ? null : Number(contractPrice)
    if (priceNum !== null && (Number.isNaN(priceNum) || priceNum < 0)) return setAddContractError('Enter a valid price, or leave it blank.')
    runAddContract(async () => {
      await createContract({ customerId: contact.id, name: contractName, frequencyMonths: freqNum, price: priceNum, nextDueDate: contractNextDue })
      setContractName(''); setContractPrice(''); setContractNextDue(''); setContractFrequency('12')
      setAddingContract(false)
      await refreshContracts()
    })
  }

  async function handleMarkServiced(contractId) {
    setContractActionId(contractId)
    setContractActionError('')
    try {
      await markContractServiced(contractId)
      await refreshContracts()
    } catch (err) {
      setContractActionError(err.message || String(err))
    } finally {
      setContractActionId(null)
    }
  }

  async function handleCancelContract(contractId) {
    setContractActionId(contractId)
    setContractActionError('')
    try {
      await cancelContract(contractId)
      await refreshContracts()
    } catch (err) {
      setContractActionError(err.message || String(err))
    } finally {
      setContractActionId(null)
    }
  }

  const stageLabel = PIPELINE_STAGES.find((s) => s.key === contact.pipeline_stage)?.label
  const tagSuggestions = tagInput
    ? allTags.filter((t) => !tags.includes(t) && t.toLowerCase().includes(tagInput.toLowerCase())).slice(0, 6)
    : []

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 60 }} onClick={onClose}>
      <div style={{ background: LIGHT.card, borderRadius: '20px 20px 0 0', padding: 22, width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 19, background: LIGHT.accentSoft, color: LIGHT.accent, fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {initialsOf(contact.name)}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: LIGHT.ink }}>{contact.name}</div>
              <div style={{ fontSize: 11, color: LIGHT.sub }}>{stageLabel}</div>
            </div>
          </div>
          <button type="button" className="tap" onClick={onClose} aria-label="Close"><X size={20} color={LIGHT.sub} aria-hidden="true" /></button>
        </div>

        <button
          className="tap"
          onClick={() => setVaultOpen(true)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: LIGHT.accent, background: LIGHT.accentSoft, borderRadius: 10, padding: '10px 0', marginBottom: 16 }}
        >
          <FolderOpen size={14} /> Document Vault
        </button>

        {piiDeletedAt ? (
          <div style={{ background: LIGHT.bg, borderRadius: 14, padding: 14, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldOff size={16} color={LIGHT.sub} />
            <div style={{ fontSize: 12, color: LIGHT.sub, lineHeight: 1.4 }}>
              This contact's personal data was deleted on {formatWhen(piiDeletedAt)}.
              Job and payment records are kept for accounting purposes.
            </div>
          </div>
        ) : (
          <div style={{ background: LIGHT.bg, borderRadius: 14, padding: 14, marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {contact.phone && <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: LIGHT.ink }}><Phone size={13} color={LIGHT.accent} /> {contact.phone}</div>}
            {contact.email && <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: LIGHT.ink }}><Mail size={13} color={LIGHT.accent} /> {contact.email}</div>}
            {contact.address && <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: LIGHT.ink }}><MapPin size={13} color={LIGHT.accent} /> {contact.address}</div>}
            {!contact.phone && !contact.email && !contact.address && <div style={{ fontSize: 12, color: LIGHT.sub }}>No contact details on file.</div>}
          </div>
        )}

        {!piiDeletedAt && contact.phone && (
          <>
            <button
              type="button"
              role="switch"
              aria-checked={smsConsent}
              className="tap"
              onClick={consentSaving ? undefined : toggleConsent}
              disabled={consentSaving}
              style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, background: smsConsent ? LIGHT.successSoft : LIGHT.bg, borderRadius: 14, padding: 12, marginBottom: 8, opacity: consentSaving ? 0.6 : 1 }}
            >
              {smsConsent ? <MessageCircle size={16} color={LIGHT.success} aria-hidden="true" /> : <MessageCircleOff size={16} color={LIGHT.sub} aria-hidden="true" />}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: smsConsent ? LIGHT.success : LIGHT.ink }}>
                  {smsConsent ? 'SMS consent on file' : 'No SMS consent on file'}
                </div>
                <div style={{ fontSize: 10.5, color: LIGHT.sub }}>
                  {smsConsent ? 'Tap to revoke — no more automated texts will send.' : 'Tap only if the customer has agreed to receive texts.'}
                </div>
              </div>
            </button>
            <ErrorText>{consentError}</ErrorText>
          </>
        )}

        {!piiDeletedAt && (
          <>
            <FieldLabel>Tags</FieldLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {tags.map((t) => (
                <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, background: LIGHT.accentSoft, color: LIGHT.accent, borderRadius: 20, padding: '4px 6px 4px 10px', fontSize: 11.5, fontWeight: 600 }}>
                  {t}
                  <button className="tap" onClick={() => removeTag(t)} style={{ display: 'flex', color: LIGHT.accent }}><X size={11} /></button>
                </span>
              ))}
              {tags.length === 0 && <span style={{ fontSize: 11.5, color: LIGHT.sub }}>No tags yet.</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput) } }}
                placeholder="e.g. repeat customer, referred by Sarah"
                style={{ flex: 1, minWidth: 0, background: '#F5F5F7', border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 13, padding: '9px 12px', color: LIGHT.ink }}
              />
              <button className="tap" onClick={() => addTag(tagInput)} disabled={!tagInput.trim()} style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', background: tagInput.trim() ? LIGHT.accent : LIGHT.border, borderRadius: 10, padding: '0 16px' }}>
                Add
              </button>
            </div>
            {tagSuggestions.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {tagSuggestions.map((s) => (
                  <button key={s} className="tap" onClick={() => addTag(s)} style={{ fontSize: 11, color: LIGHT.sub, border: `1px dashed ${LIGHT.border}`, borderRadius: 20, padding: '3px 10px' }}>
                    + {s}
                  </button>
                ))}
              </div>
            )}
            <ErrorText>{tagError}</ErrorText>
          </>
        )}

        <FieldLabel>Maintenance Contracts</FieldLabel>
        <div style={{ background: LIGHT.bg, borderRadius: 14, padding: 12, marginBottom: 14 }}>
          {contractsLoading && <LoadingState>Loading contracts…</LoadingState>}
          {contractsError && !contractsLoadedOnce && <ErrorState message={contractsError} onRetry={reloadContracts} />}
          {!contractsLoading && (
            <>
              {contracts.filter((c) => c.status === 'active').length === 0 && !addingContract && (
                <div style={{ fontSize: 12, color: LIGHT.sub, marginBottom: 10 }}>No active contracts.</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: contracts.length > 0 ? 10 : 0 }}>
                {contracts.filter((c) => c.status === 'active').map((c) => (
                  <div key={c.id} style={{ background: LIGHT.card, borderRadius: 12, padding: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: LIGHT.ink }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: LIGHT.sub }}>
                          Every {c.frequency_months} {c.frequency_months === 1 ? 'month' : 'months'}
                          {c.price != null ? ` · ${money(c.price)}` : ''}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, fontSize: 11, fontWeight: isOverdue(c) || isDueSoon(c) ? 700 : 600, color: isOverdue(c) ? LIGHT.alert : isDueSoon(c) ? LIGHT.accent : LIGHT.sub }}>
                          <CalendarClock size={11} /> Next due {formatDate(c.next_due_date)}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button
                        className="tap"
                        onClick={() => handleMarkServiced(c.id)}
                        disabled={contractActionId === c.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: LIGHT.success, background: LIGHT.successSoft, borderRadius: 8, padding: '5px 10px' }}
                      >
                        <CheckCircle2 size={11} /> {contractActionId === c.id ? 'Saving…' : 'Mark Serviced'}
                      </button>
                      <button
                        className="tap"
                        onClick={() => handleCancelContract(c.id)}
                        disabled={contractActionId === c.id}
                        style={{ fontSize: 11, fontWeight: 600, color: LIGHT.sub }}
                      >
                        Cancel Contract
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <ErrorText>{contractActionError}</ErrorText>

              {addingContract ? (
                <div style={{ background: LIGHT.card, borderRadius: 12, padding: 10 }}>
                  <FieldLabel htmlFor="field-contract-name-1">Contract name</FieldLabel>
                  <TextInput id="field-contract-name-1" value={contractName} onChange={setContractName} placeholder="Annual Furnace Tune-Up" />
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <FieldLabel htmlFor="field-frequency-months-1">Frequency (months)</FieldLabel>
                      <TextInput id="field-frequency-months-1" value={contractFrequency} onChange={setContractFrequency} placeholder="12" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <FieldLabel htmlFor="field-price-1">Price ($)</FieldLabel>
                      <TextInput id="field-price-1" value={contractPrice} onChange={setContractPrice} placeholder="189" />
                    </div>
                  </div>
                  <FieldLabel htmlFor="field-next-due-date-1">Next due date</FieldLabel>
                  <TextInput id="field-next-due-date-1" value={contractNextDue} onChange={setContractNextDue} type="date" />
                  <ErrorText>{addContractError}</ErrorText>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <PrimaryButton onClick={submitContract} disabled={savingContract} style={{ flex: 1 }}>
                      {savingContract ? 'Adding…' : 'Add Contract'}
                    </PrimaryButton>
                    <button className="tap" onClick={() => setAddingContract(false)} disabled={savingContract} style={{ fontSize: 12.5, fontWeight: 600, color: LIGHT.sub, padding: '0 12px' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button className="tap" onClick={() => setAddingContract(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: LIGHT.accent }}>
                  <Plus size={13} /> Add Contract
                </button>
              )}
            </>
          )}
        </div>

        <FieldLabel>Timeline</FieldLabel>
        <div style={{ background: LIGHT.bg, borderRadius: 14, padding: 12, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button
              className="tap"
              onClick={() => setComposerType('note')}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, borderRadius: 8, padding: '6px 10px', background: composerType === 'note' ? LIGHT.ink : LIGHT.card, color: composerType === 'note' ? LIGHT.bg : LIGHT.sub }}
            >
              <StickyNote size={12} /> Note
            </button>
            <button
              className="tap"
              onClick={() => setComposerType('call')}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, borderRadius: 8, padding: '6px 10px', background: composerType === 'call' ? LIGHT.ink : LIGHT.card, color: composerType === 'call' ? LIGHT.bg : LIGHT.sub }}
            >
              <PhoneCall size={12} /> Call
            </button>
          </div>
          <textarea
            value={composerBody}
            onChange={(e) => setComposerBody(e.target.value)}
            placeholder={composerType === 'call' ? 'What happened on the call?' : 'Anything worth remembering about this contact...'}
            rows={3}
            style={{ width: '100%', background: LIGHT.card, border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 13, padding: 10, color: LIGHT.ink, marginBottom: 8, resize: 'none' }}
          />
          <ErrorText>{postError}</ErrorText>
          <button
            className="tap"
            onClick={submitInteraction}
            disabled={posting || !composerBody.trim()}
            style={{ width: '100%', textAlign: 'center', background: composerBody.trim() ? LIGHT.ink : LIGHT.border, color: LIGHT.bg, border: 'none', borderRadius: 10, padding: '10px 0', fontSize: 13, fontWeight: 600 }}
          >
            {posting ? 'Adding…' : `Add ${composerType === 'call' ? 'Call' : 'Note'}`}
          </button>
        </div>

        {loading && <LoadingState />}
        {error && !hasLoadedOnce && <ErrorState message={error} onRetry={reload} />}
        {!loading && (
          <>
            <ErrorBanner message={error && hasLoadedOnce ? error : ''} onRetry={reload} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {interactions.map((i) => (
                <div key={i.id} style={{ display: 'flex', gap: 10 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 13, background: i.type === 'call' ? LIGHT.infoSoft : LIGHT.accentSoft, color: i.type === 'call' ? LIGHT.info : LIGHT.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {i.type === 'call' ? <PhoneCall size={12} /> : <StickyNote size={12} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: LIGHT.ink, lineHeight: 1.4 }}>{i.body}</div>
                    <div style={{ fontSize: 10.5, color: LIGHT.sub, marginTop: 2 }}>{i.created_by?.name || 'Someone'} · {formatWhen(i.created_at)}</div>
                  </div>
                </div>
              ))}
              {interactions.length === 0 && <div style={{ fontSize: 12, color: LIGHT.sub, textAlign: 'center', padding: '10px 0' }}>No interactions logged yet.</div>}
            </div>
          </>
        )}

        {!piiDeletedAt && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px dashed ${LIGHT.border}` }}>
            {!confirmingDelete ? (
              <button
                className="tap"
                onClick={() => setConfirmingDelete(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: LIGHT.alert }}
              >
                <Trash2 size={12} /> Delete this contact's personal data
              </button>
            ) : (
              <div style={{ background: LIGHT.alertSoft, borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 12, color: LIGHT.ink, lineHeight: 1.5, marginBottom: 10 }}>
                  This permanently removes their name, phone, email, address, and
                  tags, and turns off SMS consent. It can't be undone. Job and
                  payment records stay (for accounting), and existing notes/call
                  logs below aren't edited — review those separately if they
                  mention the customer by name.
                </div>
                <ErrorText>{deleteError}</ErrorText>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="tap"
                    onClick={confirmDeletePii}
                    disabled={deletingPii}
                    style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#fff', background: LIGHT.alert, borderRadius: 8, padding: '9px 0' }}
                  >
                    {deletingPii ? 'Deleting…' : 'Yes, delete it'}
                  </button>
                  <button
                    className="tap"
                    onClick={() => { setConfirmingDelete(false); setDeleteError('') }}
                    disabled={deletingPii}
                    style={{ flex: 1, fontSize: 12, fontWeight: 600, color: LIGHT.ink, background: LIGHT.card, borderRadius: 8, padding: '9px 0' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {vaultOpen && <DocumentVaultModal contact={contact} onClose={() => setVaultOpen(false)} />}
    </div>
  )
}
