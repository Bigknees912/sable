import { useState } from 'react'
import { Plus, X, Zap, Pencil, Trash2 } from 'lucide-react'
import { useEscapeToClose } from './useEscapeToClose'
import {
  listAutomations, createAutomation, updateAutomation, deleteAutomation, describeAutomation,
  TRIGGER_TYPES, JOB_STATUSES, ACTION_TYPES, SMS_VARIABLES,
} from '../lib/automations'
import { PIPELINE_STAGES } from '../lib/crm'
import { LIGHT } from '../theme'
import { SectionLabel, LoadingState, ErrorState, ErrorBanner, EmptyState } from './ui'
import { FieldLabel, TextInput, PrimaryButton, ErrorText, usePendingAction } from '../auth/ui'
import { useAsyncData } from './useAsyncData'

function stageLabel(key) {
  return PIPELINE_STAGES.find((s) => s.key === key)?.label
}

const DELAY_UNITS = [
  { key: 'minutes', label: 'minutes', factor: 1 },
  { key: 'hours', label: 'hours', factor: 60 },
  { key: 'days', label: 'days', factor: 1440 },
]

// A form-based rule builder rather than a visual drag-and-drop canvas
// (see AUTH.md) - same no-code trigger -> wait -> action outcome, without
// building a full node-graph editor. Every rule here is a real,
// owner-editable row in `automations`; the actual delay/execution
// machinery (a queue + a scheduled job, since Postgres triggers can't
// sleep) lives entirely in the database - this page only reads/writes
// automations, it never touches automation_runs directly.
export default function AutomationsPage() {
  const [editing, setEditing] = useState(undefined) // undefined = closed, null = new, object = editing
  const [actionError, setActionError] = useState('')
  const [automations, setAutomations] = useState([])

  async function load() {
    const data = await listAutomations()
    setAutomations(data)
  }
  const { loading, error, hasLoadedOnce, reload } = useAsyncData(load, [])

  async function handleToggleActive(automation) {
    const prev = automation.active
    setAutomations((as) => as.map((a) => (a.id === automation.id ? { ...a, active: !prev } : a)))
    setActionError('')
    try {
      await updateAutomation(automation.id, { active: !prev })
    } catch (err) {
      setAutomations((as) => as.map((a) => (a.id === automation.id ? { ...a, active: prev } : a)))
      setActionError(err.message)
    }
  }

  async function handleDelete(automation) {
    const prev = automations
    setAutomations((as) => as.filter((a) => a.id !== automation.id))
    setActionError('')
    try {
      await deleteAutomation(automation.id)
    } catch (err) {
      setAutomations(prev)
      setActionError(err.message)
    }
  }

  async function handleSaved() {
    setEditing(undefined)
    try {
      await reload()
    } catch (err) {
      setActionError(err.message)
    }
  }

  if (loading) return <LoadingState />
  if (error && !hasLoadedOnce) return <ErrorState message={error} onRetry={reload} />

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <SectionLabel>Winback</SectionLabel>
        <button className="tap" onClick={() => setEditing(null)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: LIGHT.accent, background: LIGHT.accentSoft, borderRadius: 8, padding: '6px 10px' }}>
          <Plus size={13} /> New Winback Rule
        </button>
      </div>
      <ErrorBanner message={error && hasLoadedOnce ? error : ''} onRetry={reload} />
      <ErrorBanner message={actionError} onDismiss={() => setActionError('')} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {automations.map((a) => (
          <div key={a.id} style={{ background: LIGHT.card, borderRadius: 16, padding: 14, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', opacity: a.active ? 1 : 0.55 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: LIGHT.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Zap size={14} color={LIGHT.accent} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: LIGHT.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
              </div>
              <button
                className="tap"
                onClick={() => handleToggleActive(a)}
                style={{ width: 38, height: 22, borderRadius: 11, background: a.active ? LIGHT.accent : LIGHT.border, position: 'relative', flexShrink: 0 }}
              >
                <div style={{ position: 'absolute', top: 2, left: a.active ? 18 : 2, width: 18, height: 18, borderRadius: 9, background: '#fff' }} />
              </button>
            </div>
            <div style={{ fontSize: 12, color: LIGHT.sub, lineHeight: 1.4, marginBottom: 10 }}>{describeAutomation(a, stageLabel)}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="tap" onClick={() => setEditing(a)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: LIGHT.ink, border: `1px solid ${LIGHT.border}`, borderRadius: 8, padding: '6px 10px' }}>
                <Pencil size={11} /> Edit
              </button>
              <button className="tap" onClick={() => handleDelete(a)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: LIGHT.alert, border: `1px solid ${LIGHT.alertSoft}`, borderRadius: 8, padding: '6px 10px' }}>
                <Trash2 size={11} /> Delete
              </button>
            </div>
          </div>
        ))}
        {automations.length === 0 && <EmptyState>No Winback rules yet. Tap "New Winback Rule" to build one.</EmptyState>}
      </div>

      {editing !== undefined && (
        <AutomationFormModal automation={editing} onClose={() => setEditing(undefined)} onSaved={handleSaved} />
      )}
    </>
  )
}

function minutesToParts(minutes) {
  if (!minutes) return { amount: 0, unit: 'minutes' }
  for (const u of [...DELAY_UNITS].reverse()) {
    if (minutes % u.factor === 0) return { amount: minutes / u.factor, unit: u.key }
  }
  return { amount: minutes, unit: 'minutes' }
}

function AutomationFormModal({ automation, onClose, onSaved }) {
  useEscapeToClose(onClose)
  const isEdit = !!automation
  const initialDelay = minutesToParts(automation?.delay_minutes || 0)

  const [name, setName] = useState(automation?.name || '')
  const [triggerType, setTriggerType] = useState(automation?.trigger_type || 'job_status_changed')
  const [triggerStatus, setTriggerStatus] = useState(automation?.trigger_config?.status || 'done')
  const [triggerStage, setTriggerStage] = useState(automation?.trigger_config?.stage || PIPELINE_STAGES[0].key)
  const [triggerTag, setTriggerTag] = useState(automation?.trigger_config?.tag || '')
  const [delayAmount, setDelayAmount] = useState(initialDelay.amount)
  const [delayUnit, setDelayUnit] = useState(initialDelay.unit)
  const [actionType, setActionType] = useState(automation?.action_type || 'send_sms')
  const [actionMessage, setActionMessage] = useState(automation?.action_config?.message || '')
  const [actionSubject, setActionSubject] = useState(automation?.action_config?.subject || '')
  const [actionBody, setActionBody] = useState(automation?.action_config?.body || '')
  const [actionTag, setActionTag] = useState(automation?.action_config?.tag || '')
  const [actionStage, setActionStage] = useState(automation?.action_config?.stage || PIPELINE_STAGES[0].key)
  const [actionNote, setActionNote] = useState(automation?.action_config?.note || '')
  const { loading, error, run } = usePendingAction()

  function buildTriggerConfig() {
    if (triggerType === 'job_status_changed') return { status: triggerStatus }
    if (triggerType === 'pipeline_stage_changed') return { stage: triggerStage }
    return { tag: triggerTag.trim() }
  }
  function buildActionConfig() {
    if (actionType === 'send_sms') return { message: actionMessage.trim() }
    if (actionType === 'send_email') return { subject: actionSubject.trim(), body: actionBody.trim() }
    if (actionType === 'add_tag') return { tag: actionTag.trim() }
    if (actionType === 'change_stage') return { stage: actionStage }
    return { note: actionNote.trim() }
  }

  function submit() {
    run(async () => {
      const unit = DELAY_UNITS.find((u) => u.key === delayUnit)
      const fields = {
        name: name.trim(),
        trigger_type: triggerType,
        trigger_config: buildTriggerConfig(),
        delay_minutes: Math.round((Number(delayAmount) || 0) * unit.factor),
        action_type: actionType,
        action_config: buildActionConfig(),
      }
      if (isEdit) await updateAutomation(automation.id, fields)
      else await createAutomation(fields)
      await onSaved()
    })
  }

  const canSubmit =
    name.trim() &&
    !loading &&
    (triggerType !== 'tag_added' || triggerTag.trim()) &&
    (actionType !== 'send_sms' || actionMessage.trim()) &&
    (actionType !== 'send_email' || (actionSubject.trim() && actionBody.trim())) &&
    (actionType !== 'add_tag' || actionTag.trim()) &&
    (actionType !== 'add_note' || actionNote.trim())

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }} onClick={onClose}>
      <div style={{ background: LIGHT.card, borderRadius: 20, padding: 20, maxWidth: 420, width: '100%', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: LIGHT.ink }}>{isEdit ? 'Edit Winback Rule' : 'New Winback Rule'}</div>
          <button type="button" className="tap" onClick={onClose} aria-label="Close"><X size={18} color={LIGHT.sub} aria-hidden="true" /></button>
        </div>

        <FieldLabel htmlFor="field-name-2">Name</FieldLabel>
        <TextInput id="field-name-2" value={name} onChange={setName} placeholder="Ask for a Google review" />

        <FieldLabel>When...</FieldLabel>
        <Select value={triggerType} onChange={setTriggerType} options={TRIGGER_TYPES.map((t) => ({ value: t.key, label: t.label }))} />
        {triggerType === 'job_status_changed' && (
          <Select value={triggerStatus} onChange={setTriggerStatus} options={JOB_STATUSES.map((s) => ({ value: s.key, label: s.label }))} />
        )}
        {triggerType === 'pipeline_stage_changed' && (
          <Select value={triggerStage} onChange={setTriggerStage} options={PIPELINE_STAGES.map((s) => ({ value: s.key, label: s.label }))} />
        )}
        {triggerType === 'tag_added' && (
          <TextInput value={triggerTag} onChange={setTriggerTag} placeholder="e.g. VIP" />
        )}

        <FieldLabel>Wait</FieldLabel>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input
            type="number" min="0" value={delayAmount}
            onChange={(e) => setDelayAmount(e.target.value)}
            style={{ width: 80, background: '#F5F5F7', border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 14, padding: '11px 13px', color: LIGHT.ink }}
          />
          <div style={{ flex: 1 }}>
            <Select value={delayUnit} onChange={setDelayUnit} options={DELAY_UNITS.map((u) => ({ value: u.key, label: u.label }))} noMargin />
          </div>
        </div>

        <FieldLabel>Then...</FieldLabel>
        <Select value={actionType} onChange={setActionType} options={ACTION_TYPES.map((a) => ({ value: a.key, label: a.label }))} />
        {actionType === 'send_sms' && (
          <>
            <textarea
              value={actionMessage} onChange={(e) => setActionMessage(e.target.value)}
              placeholder="Hi {{first_name}}, thanks for choosing {{company_name}}!..."
              rows={3}
              style={{ width: '100%', background: '#F5F5F7', border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 13, padding: 12, color: LIGHT.ink, marginBottom: 6, resize: 'none' }}
            />
            <div style={{ fontSize: 10.5, color: LIGHT.sub, marginBottom: 14, lineHeight: 1.5 }}>
              Available: {SMS_VARIABLES.join(', ')}. Only sends to customers with SMS
              consent on file. A "Reply STOP to opt out" line is added automatically
              if your message doesn't already have one.
            </div>
          </>
        )}
        {actionType === 'send_email' && (
          <>
            <TextInput value={actionSubject} onChange={setActionSubject} placeholder="Subject, e.g. Time for your seasonal checkup" />
            <textarea
              value={actionBody} onChange={(e) => setActionBody(e.target.value)}
              placeholder={'Hi {{first_name}},\n\nJust a friendly reminder...'}
              rows={5}
              style={{ width: '100%', background: '#F5F5F7', border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 13, padding: 12, color: LIGHT.ink, marginBottom: 6, resize: 'none' }}
            />
            <div style={{ fontSize: 10.5, color: LIGHT.sub, marginBottom: 14, lineHeight: 1.5 }}>
              Available in subject and body: {SMS_VARIABLES.join(', ')}
            </div>
          </>
        )}
        {actionType === 'add_tag' && <TextInput value={actionTag} onChange={setActionTag} placeholder="e.g. Nurture Candidate" />}
        {actionType === 'change_stage' && (
          <div style={{ marginBottom: 14 }}>
            <Select value={actionStage} onChange={setActionStage} options={PIPELINE_STAGES.map((s) => ({ value: s.key, label: s.label }))} noMargin />
          </div>
        )}
        {actionType === 'add_note' && (
          <textarea
            value={actionNote} onChange={(e) => setActionNote(e.target.value)}
            placeholder="e.g. Auto-enrolled in 6-month maintenance reminder"
            rows={2}
            style={{ width: '100%', background: '#F5F5F7', border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 13, padding: 12, color: LIGHT.ink, marginBottom: 14, resize: 'none' }}
          />
        )}

        <ErrorText>{error}</ErrorText>
        <PrimaryButton onClick={submit} disabled={!canSubmit}>
          {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Winback Rule'}
        </PrimaryButton>
      </div>
    </div>
  )
}

function Select({ value, onChange, options, noMargin }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: '100%', background: '#F5F5F7', border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 14, padding: '11px 13px', marginBottom: noMargin ? 0 : 14, color: LIGHT.ink }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
