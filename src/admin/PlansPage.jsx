import { useEffect, useState } from 'react'
import { Plus, X, ChevronUp, ChevronDown, Trash2 } from 'lucide-react'
import { LIGHT } from '../theme'
import { ErrorState, LoadingState, money, SectionLabel } from '../dashboard/ui'
import { FieldLabel, TextInput, PrimaryButton, ErrorText, usePendingAction } from '../auth/ui'
import { listPlansAdmin, upsertPlan, reorderPlans, deletePlan, listCompanies, getCompanyDetail, setCompanyOverride } from '../lib/admin'

export default function PlansPage() {
  const [plans, setPlans] = useState(undefined)
  const [error, setError] = useState('')
  const [addingNew, setAddingNew] = useState(false)

  function load() {
    setError('')
    setPlans(undefined)
    listPlansAdmin().then(setPlans).catch((err) => setError(err.message || String(err)))
  }
  useEffect(load, [])

  async function move(key, direction) {
    const idx = plans.findIndex((p) => p.key === key)
    const swapWith = idx + direction
    if (swapWith < 0 || swapWith >= plans.length) return
    const reordered = [...plans]
    ;[reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]]
    setPlans(reordered)
    try {
      await reorderPlans(reordered.map((p) => p.key))
    } catch (err) {
      setError(err.message || String(err))
      load()
    }
  }

  return (
    <div>
      <SectionLabel>Plan Tiers</SectionLabel>
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && plans === undefined && <LoadingState>Loading plans…</LoadingState>}

      {plans && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 22 }}>
          {plans.map((p, i) => (
            <PlanCard
              key={p.key}
              plan={p}
              onMoveUp={i > 0 ? () => move(p.key, -1) : null}
              onMoveDown={i < plans.length - 1 ? () => move(p.key, 1) : null}
              onSaved={load}
            />
          ))}
        </div>
      )}

      {!addingNew && (
        <button className="tap" onClick={() => setAddingNew(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: LIGHT.ink, color: '#fff', borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 600, marginBottom: 30 }}>
          <Plus size={15} /> Add Plan Tier
        </button>
      )}
      {addingNew && (
        <div style={{ marginBottom: 30 }}>
          <PlanCard isNew onSaved={() => { setAddingNew(false); load() }} onCancel={() => setAddingNew(false)} />
        </div>
      )}

      <SectionLabel>Per-Company Pricing Override</SectionLabel>
      <CompanyOverrideEditor />
    </div>
  )
}

function PlanCard({ plan, isNew, onMoveUp, onMoveDown, onSaved, onCancel }) {
  const [name, setName] = useState(plan?.name || '')
  const [key, setKey] = useState(plan?.key || '')
  const [price, setPrice] = useState(plan ? String(plan.monthly_price) : '0')
  const [seatLimit, setSeatLimit] = useState(plan?.seat_limit != null ? String(plan.seat_limit) : '')
  const [active, setActive] = useState(plan ? plan.active : true)
  const [features, setFeatures] = useState(plan?.features?.length ? plan.features : [])
  const [newFeature, setNewFeature] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const { loading, error, run, setError } = usePendingAction()

  function addFeature() {
    if (!newFeature.trim()) return
    setFeatures([...features, newFeature.trim()])
    setNewFeature('')
  }
  function removeFeature(idx) {
    setFeatures(features.filter((_, i) => i !== idx))
  }
  function moveFeature(idx, dir) {
    const target = idx + dir
    if (target < 0 || target >= features.length) return
    const copy = [...features]
    ;[copy[idx], copy[target]] = [copy[target], copy[idx]]
    setFeatures(copy)
  }

  function save() {
    if (!key.trim()) return setError('Plan key is required (e.g. "enterprise").')
    if (!name.trim()) return setError('Plan name is required.')
    const priceNum = Number(price)
    if (Number.isNaN(priceNum) || priceNum < 0) return setError('Enter a valid monthly price.')
    let seatLimitNum = null
    if (seatLimit.trim() !== '') {
      seatLimitNum = Number(seatLimit)
      if (!Number.isInteger(seatLimitNum) || seatLimitNum <= 0) return setError('Seat limit must be a whole number greater than 0, or blank for unlimited.')
    }
    run(async () => {
      await upsertPlan({ key: key.trim().toLowerCase(), name: name.trim(), monthlyPrice: priceNum, features, active, seatLimit: seatLimitNum })
      onSaved()
    })
  }

  async function remove() {
    setDeleteError('')
    try {
      await deletePlan(plan.key)
      onSaved()
    } catch (err) {
      setDeleteError(err.message || String(err))
    }
  }

  return (
    <div style={{ background: LIGHT.card, borderRadius: 16, padding: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 4 }}>
        {!isNew && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 2 }}>
            <button type="button" className="tap" disabled={!onMoveUp} onClick={onMoveUp} aria-label="Move plan up" style={{ opacity: onMoveUp ? 1 : 0.3 }}><ChevronUp size={15} color={LIGHT.sub} aria-hidden="true" /></button>
            <button type="button" className="tap" disabled={!onMoveDown} onClick={onMoveDown} aria-label="Move plan down" style={{ opacity: onMoveDown ? 1 : 0.3 }}><ChevronDown size={15} color={LIGHT.sub} aria-hidden="true" /></button>
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: isNew ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
            {isNew && (
              <div>
                <FieldLabel htmlFor="field-key-1">Key</FieldLabel>
                <TextInput id="field-key-1" value={key} onChange={setKey} placeholder="enterprise" />
              </div>
            )}
            <div>
              <FieldLabel htmlFor="field-name-1">Name</FieldLabel>
              <TextInput id="field-name-1" value={name} onChange={setName} placeholder="Enterprise" />
            </div>
            <div>
              <FieldLabel htmlFor="field-monthly-price-1">Monthly price ($)</FieldLabel>
              <TextInput id="field-monthly-price-1" value={price} onChange={setPrice} placeholder="299" />
            </div>
            <div>
              <FieldLabel htmlFor="field-seat-limit-blank-unlimited-1">Seat limit (blank = unlimited)</FieldLabel>
              <TextInput id="field-seat-limit-blank-unlimited-1" value={seatLimit} onChange={setSeatLimit} placeholder="e.g. 10" />
            </div>
          </div>
          <div style={{ fontSize: 11, color: LIGHT.sub, marginTop: -6, marginBottom: 10 }}>
            Total team members (owner + techs) a company on this plan may have. Enforced server-side when joining via a code.
          </div>

          <FieldLabel>Features</FieldLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
            {features.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F5F5F7', borderRadius: 8, padding: '6px 8px' }}>
                <div style={{ flex: 1, fontSize: 12.5, color: LIGHT.ink }}>{f}</div>
                <button className="tap" onClick={() => moveFeature(i, -1)} disabled={i === 0}><ChevronUp size={13} color={LIGHT.sub} /></button>
                <button className="tap" onClick={() => moveFeature(i, 1)} disabled={i === features.length - 1}><ChevronDown size={13} color={LIGHT.sub} /></button>
                <button className="tap" onClick={() => removeFeature(i)}><X size={13} color={LIGHT.alert} /></button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <TextInput value={newFeature} onChange={setNewFeature} placeholder="Add a feature…" />
            </div>
            <button className="tap" onClick={addFeature} style={{ background: LIGHT.border, borderRadius: 10, padding: '0 14px', fontSize: 13, fontWeight: 600, color: LIGHT.ink }}>Add</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: LIGHT.sub }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (visible on signup)
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {!isNew && <button className="tap" onClick={remove} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: LIGHT.alert, fontWeight: 600 }}><Trash2 size={13} /> Delete</button>}
              {isNew && onCancel && <button className="tap" onClick={onCancel} style={{ fontSize: 12, color: LIGHT.sub, fontWeight: 600 }}>Cancel</button>}
            </div>
          </div>
          <ErrorText>{error}</ErrorText>
          <ErrorText>{deleteError}</ErrorText>
          <PrimaryButton onClick={save} disabled={loading} style={{ marginTop: 4 }}>{loading ? 'Saving…' : isNew ? 'Create Plan' : 'Save Changes'}</PrimaryButton>
        </div>
      </div>
    </div>
  )
}

function CompanyOverrideEditor() {
  const [companies, setCompanies] = useState(undefined)
  const [plans, setPlans] = useState([])
  const [companyId, setCompanyId] = useState('')
  const [detail, setDetail] = useState(null)
  const [overridePrice, setOverridePrice] = useState('')
  const [note, setNote] = useState('')
  const { loading, error, run, setError } = usePendingAction()
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    listCompanies().then(setCompanies).catch((err) => setError(err.message || String(err)))
    listPlansAdmin().then(setPlans).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!companyId) { setDetail(null); return }
    setSaved(false)
    getCompanyDetail(companyId).then((d) => {
      setDetail(d)
      setOverridePrice(d.override_price != null ? String(d.override_price) : '')
      setNote(d.override_note || '')
    }).catch((err) => setError(err.message || String(err)))
  }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  function save() {
    const priceNum = overridePrice.trim() === '' ? null : Number(overridePrice)
    if (priceNum !== null && (Number.isNaN(priceNum) || priceNum < 0)) return setError('Enter a valid override price, or leave blank to clear it.')
    run(async () => {
      await setCompanyOverride(companyId, priceNum, note)
      setSaved(true)
    })
  }

  const standardPrice = detail ? plans.find((p) => p.key === detail.plan)?.monthly_price : null

  return (
    <div style={{ background: LIGHT.card, borderRadius: 16, padding: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <FieldLabel htmlFor="field-override-company">Company</FieldLabel>
      <select id="field-override-company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} style={{ width: '100%', background: '#F5F5F7', border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 14, padding: '11px 13px', marginBottom: 14, color: LIGHT.ink }}>
        <option value="">Select a company…</option>
        {companies?.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.plan || 'no plan'})</option>)}
      </select>

      {detail && (
        <div>
          <div style={{ fontSize: 12, color: LIGHT.sub, marginBottom: 12 }}>
            Standard {detail.plan} price: {money(standardPrice ?? 0)}/mo. Leave the override blank to bill the standard tier price.
          </div>
          <FieldLabel htmlFor="field-override-monthly-price-blank-no-override-1">Override monthly price ($, blank = no override)</FieldLabel>
          <TextInput id="field-override-monthly-price-blank-no-override-1" value={overridePrice} onChange={setOverridePrice} placeholder="e.g. 29.00" />
          <FieldLabel htmlFor="field-note-reason-for-the-discount-deal-1">Note (reason for the discount/deal)</FieldLabel>
          <TextInput id="field-note-reason-for-the-discount-deal-1" value={note} onChange={setNote} placeholder="Early customer discount, locked for 1 year" />
          <ErrorText>{error}</ErrorText>
          {saved && <div style={{ fontSize: 12, color: LIGHT.success, marginBottom: 10 }}>Saved.</div>}
          <PrimaryButton onClick={save} disabled={loading}>{loading ? 'Saving…' : 'Save Override'}</PrimaryButton>
        </div>
      )}
    </div>
  )
}
