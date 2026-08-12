import { useEffect, useState } from 'react'
import { Plus, X, Wrench } from 'lucide-react'
import { LIGHT } from '../theme'
import { SectionLabel, ErrorState, LoadingState, EmptyState, Badge, money } from './ui'
import { FieldLabel, TextInput, PrimaryButton, ErrorText, usePendingAction } from '../auth/ui'
import { listAllJobTypes, createJobType, updateJobType, setJobTypeActive } from '../lib/jobTypes'
import { listParts, createPart, deletePart, listJobTypePartsMap, setJobTypeParts } from '../lib/inventory'

// The service catalog (job_types) pre-fills from a trade starter template
// at signup (see create_company_and_owner, migration 044) but from here on
// it's entirely this company's own data - add, edit, retire, or reprice
// anything, independent of what trade was picked during onboarding. This
// same table also drives the Jobs board's job-type picker and the AI
// receptionist's dynamically-generated script (see AUTH.md "Trade-agnostic
// service catalog"), so a change here reaches both automatically.
export default function ServiceCatalogPage({ company }) {
  const [jobTypes, setJobTypes] = useState(undefined)
  const [parts, setParts] = useState([])
  const [jobTypePartsMap, setJobTypePartsMap] = useState({})
  const [error, setError] = useState('')
  const [addingNew, setAddingNew] = useState(false)

  function load() {
    setError('')
    setJobTypes(undefined)
    Promise.all([listAllJobTypes(), listParts(), listJobTypePartsMap()])
      .then(([jt, p, map]) => {
        setJobTypes(jt)
        setParts(p)
        setJobTypePartsMap(map)
      })
      .catch((err) => setError(err.message || String(err)))
  }
  useEffect(load, [])

  function reloadParts() {
    Promise.all([listParts(), listJobTypePartsMap()]).then(([p, map]) => {
      setParts(p)
      setJobTypePartsMap(map)
    })
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <SectionLabel>Service Catalog</SectionLabel>
        {!addingNew && (
          <button className="tap" onClick={() => setAddingNew(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: LIGHT.accent, background: LIGHT.accentSoft, borderRadius: 8, padding: '6px 10px' }}>
            <Plus size={13} /> Add Service
          </button>
        )}
      </div>
      <div style={{ fontSize: 12, color: LIGHT.sub, marginBottom: 16, lineHeight: 1.4 }}>
        These services show up when creating a job and drive PickUp's quotes, if it's on your plan.
        Leave hourly rate blank to use your company default ({money(company?.hourly_rate)}/hr).
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && jobTypes === undefined && <LoadingState>Loading catalog…</LoadingState>}
      {jobTypes && jobTypes.length === 0 && !addingNew && <EmptyState>No services yet. Add your first one.</EmptyState>}

      {jobTypes && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {jobTypes.map((jt) => (
            <JobTypeCard
              key={jt.id}
              jobType={jt}
              company={company}
              onSaved={load}
              allParts={parts}
              requiredPartIds={jobTypePartsMap[jt.id] || []}
              onPartsChanged={reloadParts}
            />
          ))}
        </div>
      )}

      {addingNew && (
        <JobTypeCard isNew company={company} onSaved={() => { setAddingNew(false); load() }} onCancel={() => setAddingNew(false)} />
      )}

      {jobTypes && <PartsCatalogSection parts={parts} onChanged={reloadParts} />}
    </div>
  )
}

// A flat, company-wide catalog of common parts (e.g. "1/2in copper elbow",
// "water heater element"). Linked to job types below via job_type_parts -
// what actually flags a tech in the Jobs board's assign picker is being
// marked out of stock (Team page) on a part their assigned job's job_type
// requires here.
function PartsCatalogSection({ parts, onChanged }) {
  const [name, setName] = useState('')
  const { loading, error, run, setError } = usePendingAction()
  const [deletingId, setDeletingId] = useState(null)

  function add() {
    if (!name.trim()) return
    run(async () => {
      await createPart(name)
      setName('')
      onChanged()
    })
  }

  async function remove(id) {
    setDeletingId(id)
    setError('')
    try {
      await deletePart(id)
      onChanged()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div style={{ background: LIGHT.card, borderRadius: 16, padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 700, color: LIGHT.ink, marginBottom: 4 }}>
        <Wrench size={14} color={LIGHT.accent} /> Parts Catalog
      </div>
      <div style={{ fontSize: 12, color: LIGHT.sub, marginBottom: 12, lineHeight: 1.4 }}>
        Common parts your team stocks. Link them to a service below, then mark techs
        in/out of stock from the Team page.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {parts.map((p) => (
          <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4, background: LIGHT.bg, borderRadius: 20, padding: '5px 6px 5px 12px', fontSize: 12, color: LIGHT.ink }}>
            {p.name}
            <button className="tap" onClick={() => remove(p.id)} disabled={deletingId === p.id} style={{ display: 'flex', color: LIGHT.sub }}><X size={12} /></button>
          </span>
        ))}
        {parts.length === 0 && <span style={{ fontSize: 12, color: LIGHT.sub }}>No parts yet.</span>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          placeholder="e.g. Water heater element"
          style={{ flex: 1, minWidth: 0, background: LIGHT.bg, border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 13, padding: '9px 12px', color: LIGHT.ink }}
        />
        <button className="tap" onClick={add} disabled={loading || !name.trim()} style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', background: name.trim() ? LIGHT.accent : LIGHT.border, borderRadius: 10, padding: '0 16px' }}>
          {loading ? 'Adding…' : 'Add'}
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  )
}

function JobTypeCard({ jobType, isNew, company, onSaved, onCancel, allParts, requiredPartIds, onPartsChanged }) {
  const [label, setLabel] = useState(jobType?.label || '')
  const [baseHours, setBaseHours] = useState(jobType ? String(jobType.base_hours) : '1')
  const [hourlyRate, setHourlyRate] = useState(jobType?.hourly_rate_override != null ? String(jobType.hourly_rate_override) : '')
  const [partsCost, setPartsCost] = useState(jobType ? String(jobType.parts_cost) : '0')
  const { loading, error, run, setError } = usePendingAction()
  const [toggleError, setToggleError] = useState('')
  const [togglingActive, setTogglingActive] = useState(false)

  function save() {
    if (!label.trim()) return setError('Service name is required.')
    const hoursNum = Number(baseHours)
    if (Number.isNaN(hoursNum) || hoursNum <= 0) return setError('Enter a valid number of hours.')
    const partsNum = Number(partsCost) || 0
    const rateNum = hourlyRate.trim() === '' ? null : Number(hourlyRate)
    if (rateNum !== null && (Number.isNaN(rateNum) || rateNum < 0)) return setError('Enter a valid hourly rate, or leave it blank.')

    run(async () => {
      if (isNew) {
        await createJobType({ companyId: company.id, label, baseHours: hoursNum, hourlyRateOverride: rateNum, partsCost: partsNum })
      } else {
        await updateJobType(jobType.id, { label: label.trim(), base_hours: hoursNum, hourly_rate_override: rateNum, parts_cost: partsNum })
      }
      onSaved()
    })
  }

  async function toggleActive() {
    setTogglingActive(true)
    setToggleError('')
    try {
      await setJobTypeActive(jobType.id, !jobType.active)
      onSaved()
    } catch (err) {
      setToggleError(err.message || String(err))
    } finally {
      setTogglingActive(false)
    }
  }

  return (
    <div style={{ background: LIGHT.card, borderRadius: 16, padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div>
          <FieldLabel htmlFor="field-service-name-1">Service name</FieldLabel>
          <TextInput id="field-service-name-1" value={label} onChange={setLabel} placeholder="Drain Cleaning" />
        </div>
        <div>
          <FieldLabel htmlFor="field-est-hours-1">Est. hours</FieldLabel>
          <TextInput id="field-est-hours-1" value={baseHours} onChange={setBaseHours} placeholder="1.5" />
        </div>
        <div>
          <FieldLabel htmlFor="field-hourly-rate-blank-default-1">Hourly rate ($, blank = default)</FieldLabel>
          <TextInput id="field-hourly-rate-blank-default-1" value={hourlyRate} onChange={setHourlyRate} placeholder={String(company?.hourly_rate ?? '')} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div>
          <FieldLabel htmlFor="field-typical-parts-cost-1">Typical parts cost ($)</FieldLabel>
          <TextInput id="field-typical-parts-cost-1" value={partsCost} onChange={setPartsCost} placeholder="80" />
        </div>
      </div>

      {!isNew && allParts && allParts.length > 0 && (
        <RequiredPartsPicker jobTypeId={jobType.id} allParts={allParts} requiredPartIds={requiredPartIds} onChanged={onPartsChanged} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {!isNew && <Badge bg={jobType.active ? LIGHT.successSoft : LIGHT.border} fg={jobType.active ? LIGHT.success : LIGHT.sub}>{jobType.active ? 'Active' : 'Inactive'}</Badge>}
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          {!isNew && (
            <button className="tap" onClick={toggleActive} disabled={togglingActive} style={{ fontSize: 12, fontWeight: 600, color: jobType.active ? LIGHT.alert : LIGHT.success }}>
              {togglingActive ? 'Saving…' : jobType.active ? 'Retire' : 'Reactivate'}
            </button>
          )}
          {isNew && onCancel && <button className="tap" onClick={onCancel} style={{ fontSize: 12, color: LIGHT.sub, fontWeight: 600 }}>Cancel</button>}
        </div>
      </div>
      <ErrorText>{error}</ErrorText>
      <ErrorText>{toggleError}</ErrorText>
      <PrimaryButton onClick={save} disabled={loading} style={{ marginTop: 4 }}>{loading ? 'Saving…' : isNew ? 'Add Service' : 'Save Changes'}</PrimaryButton>
    </div>
  )
}

// Which parts this service needs on hand - the Jobs board's assign picker
// cross-references this against each tech's stock (Team page) to flag
// (never block) someone who's out of a required part.
function RequiredPartsPicker({ jobTypeId, allParts, requiredPartIds, onChanged }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selected = new Set(requiredPartIds)

  async function toggle(partId) {
    const next = selected.has(partId)
      ? requiredPartIds.filter((id) => id !== partId)
      : [...requiredPartIds, partId]
    setSaving(true)
    setError('')
    try {
      await setJobTypeParts(jobTypeId, next)
      onChanged()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginBottom: 12, paddingTop: 10, borderTop: `1px dashed ${LIGHT.border}` }}>
      <FieldLabel>Required parts</FieldLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, opacity: saving ? 0.6 : 1 }}>
        {allParts.map((p) => {
          const isOn = selected.has(p.id)
          return (
            <button
              key={p.id}
              className="tap"
              onClick={() => toggle(p.id)}
              disabled={saving}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                borderRadius: 20,
                padding: '5px 12px',
                background: isOn ? LIGHT.accentSoft : LIGHT.bg,
                color: isOn ? LIGHT.accent : LIGHT.sub,
                border: `1px solid ${isOn ? LIGHT.accent : LIGHT.border}`,
              }}
            >
              {p.name}
            </button>
          )
        })}
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  )
}
