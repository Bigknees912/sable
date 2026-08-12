import { useEffect, useState } from 'react'
import { Package, Trophy, UserMinus } from 'lucide-react'
import { LIGHT } from '../theme'
import { SectionLabel, ErrorState, LoadingState, EmptyState, ConfirmDialog, initialsOf, money } from './ui'
import { listTeamTechs, listOfficeAdmins, removeTeamMember, listTechCallbackRates } from '../lib/jobs'
import { listParts, listTechPartStockMap, setTechPartStock } from '../lib/inventory'
import { listTechLeaderboardForMonth, formatDuration } from '../lib/analytics'
import { assignProfileLocation } from '../lib/locations'

// Owner-only (matches every other AppShell tab besides Home/Calendar).
// Each tech's card expands into their rough parts stock list - RLS
// (tech_part_stock, migration 052) also lets a tech edit their own row,
// but there's no tech-facing profile screen yet (TECH_TABS is just Home +
// Calendar), so for now this owner view is the only place stock gets
// edited. The Jobs board's assign picker reads the same tech_part_stock
// table to flag (never block) an assignment.
export default function TeamPage({ locations = [] }) {
  const [techs, setTechs] = useState(undefined)
  const [officeAdmins, setOfficeAdmins] = useState([])
  const [parts, setParts] = useState([])
  const [stockMap, setStockMap] = useState({})
  const [leaderboard, setLeaderboard] = useState([])
  const [callbackRates, setCallbackRates] = useState({})
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [removing, setRemoving] = useState(null) // { id, name } while the confirm dialog is open
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState('')

  function load() {
    setError('')
    setTechs(undefined)
    Promise.all([listTeamTechs(), listOfficeAdmins(), listParts(), listTechPartStockMap(), listTechLeaderboardForMonth(), listTechCallbackRates().catch(() => ({}))])
      .then(([t, oa, p, stock, board, cbr]) => {
        setTechs(t)
        setOfficeAdmins(oa)
        setParts(p)
        setStockMap(stock)
        setLeaderboard(board)
        setCallbackRates(cbr || {})
      })
      .catch((err) => setError(err.message || String(err)))
  }
  useEffect(load, [])

  // Owner-only RPC (migration 056) - '' in the <select> means "all
  // locations", which the RPC takes as null.
  async function changeLocation(profileId, locationId, setList) {
    setList((list) => list.map((p) => (p.id === profileId ? { ...p, location_id: locationId } : p)))
    try {
      await assignProfileLocation(profileId, locationId)
    } catch (err) {
      load()
      setError(err.message || String(err))
    }
  }

  function LocationPicker({ member, setList }) {
    if (locations.length === 0) return null
    return (
      <select
        value={member.location_id || ''}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => changeLocation(member.id, e.target.value || null, setList)}
        style={{ fontSize: 11, fontWeight: 600, color: LIGHT.sub, background: LIGHT.bg, border: `1px solid ${LIGHT.border}`, borderRadius: 8, padding: '4px 6px', flexShrink: 0 }}
      >
        <option value="">All Locations</option>
        {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
      </select>
    )
  }

  async function confirmRemove() {
    setRemoveBusy(true)
    setRemoveError('')
    try {
      await removeTeamMember(removing.id)
      setRemoving(null)
      load()
    } catch (err) {
      setRemoveError(err.message || String(err))
    } finally {
      setRemoveBusy(false)
    }
  }

  // Optimistic toggle, reverted on failure - same pattern as ClientsPage's
  // tag/consent edits.
  async function toggle(techId, partId, current) {
    const next = !current
    setStockMap((m) => ({ ...m, [techId]: { ...m[techId], [partId]: next } }))
    try {
      await setTechPartStock(techId, partId, next)
    } catch (err) {
      setStockMap((m) => ({ ...m, [techId]: { ...m[techId], [partId]: current } }))
      setError(err.message || String(err))
    }
  }

  return (
    <div>
      <SectionLabel>Team</SectionLabel>
      <div style={{ fontSize: 12, color: LIGHT.sub, marginBottom: 16, lineHeight: 1.4 }}>
        Each tech's rough parts stock. The Jobs board flags an assignment if a job
        needs something they're marked out of.
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && techs === undefined && <LoadingState>Loading team…</LoadingState>}
      {techs && techs.length === 0 && <EmptyState>No team members yet. Share your join code to invite one.</EmptyState>}

      {techs && techs.length > 0 && <Leaderboard techs={techs} leaderboard={leaderboard} />}

      {techs && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {techs.map((t) => {
            const stock = stockMap[t.id] || {}
            const outCount = parts.filter((p) => stock[p.id] === false).length
            const isOpen = expandedId === t.id
            return (
              <div key={t.id} style={{ background: LIGHT.card, borderRadius: 16, padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {/* Only the expand/collapse affordance is a <button> - the
                      select and Remove button below are its siblings, not
                      nested inside it (a <select>/<button> can't legally
                      live inside another <button>). */}
                  <button
                    type="button"
                    className="tap"
                    onClick={() => setExpandedId(isOpen ? null : t.id)}
                    aria-expanded={isOpen}
                    style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}
                  >
                    <div aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 17, background: LIGHT.accentSoft, color: LIGHT.accent, fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {initialsOf(t.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: LIGHT.ink }}>{t.name}</div>
                      <div style={{ fontSize: 11.5, color: LIGHT.sub }}>{t.phone || t.email || 'Technician'}</div>
                    </div>
                    {outCount > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: LIGHT.alert, background: LIGHT.alertSoft, borderRadius: 20, padding: '4px 9px', flexShrink: 0 }}>
                        <Package size={11} aria-hidden="true" /> {outCount} out
                      </span>
                    )}
                  </button>
                  <LocationPicker member={t} setList={setTechs} />
                  <button
                    type="button"
                    className="tap"
                    onClick={() => { setRemoveError(''); setRemoving({ id: t.id, name: t.name }) }}
                    title="Remove from team"
                    aria-label={`Remove ${t.name} from team`}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, color: LIGHT.alert, flexShrink: 0 }}
                  >
                    <UserMinus size={15} aria-hidden="true" />
                  </button>
                </div>

                {isOpen && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px dashed ${LIGHT.border}` }}>
                    {(() => {
                      const cb = callbackRates[t.id] || { completed: 0, callbacks: 0 }
                      const rate = cb.completed > 0 ? Math.round((cb.callbacks / cb.completed) * 100) : 0
                      const high = rate >= 10
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, padding: '10px 12px', background: LIGHT.bg, borderRadius: 10 }}>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: LIGHT.sub }}>Callback rate</div>
                            <div style={{ fontSize: 11.5, color: LIGHT.sub, marginTop: 2 }}>{cb.callbacks} callback{cb.callbacks === 1 ? '' : 's'} of {cb.completed} completed job{cb.completed === 1 ? '' : 's'}</div>
                          </div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: high ? LIGHT.alert : cb.completed === 0 ? LIGHT.sub : LIGHT.success }}>{cb.completed === 0 ? '—' : `${rate}%`}</div>
                        </div>
                      )
                    })()}
                    {parts.length === 0 && (
                      <div style={{ fontSize: 12, color: LIGHT.sub }}>Add parts in the Services tab's Parts Catalog first.</div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {parts.map((p) => {
                        const inStock = stock[p.id] !== false
                        return (
                          <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 13, color: LIGHT.ink }}>{p.name}</span>
                            <button
                              className="tap"
                              onClick={() => toggle(t.id, p.id, inStock)}
                              style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 20, padding: '5px 12px', background: inStock ? LIGHT.successSoft : LIGHT.alertSoft, color: inStock ? LIGHT.success : LIGHT.alert }}
                            >
                              {inStock ? 'In Stock' : 'Out of Stock'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {officeAdmins.length > 0 && (
        <>
          <div style={{ marginTop: 20 }}>
            <SectionLabel>Office Admins</SectionLabel>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {officeAdmins.map((oa) => (
              <div key={oa.id} style={{ background: LIGHT.card, borderRadius: 16, padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 17, background: LIGHT.infoSoft, color: LIGHT.info, fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {initialsOf(oa.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: LIGHT.ink }}>{oa.name}</div>
                  <div style={{ fontSize: 11.5, color: LIGHT.sub }}>{oa.phone || oa.email || 'Office Admin'}</div>
                </div>
                <LocationPicker member={oa} setList={setOfficeAdmins} />
                <button
                  type="button"
                  className="tap"
                  onClick={() => { setRemoveError(''); setRemoving({ id: oa.id, name: oa.name }) }}
                  title="Remove from team"
                  aria-label={`Remove ${oa.name} from team`}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, color: LIGHT.alert, flexShrink: 0 }}
                >
                  <UserMinus size={15} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          message={`They'll immediately lose access to this company's dashboard and data. Any jobs currently assigned to them become unassigned. This doesn't delete their login - they can be invited back later with a new join code if needed.`}
          confirmLabel="Remove"
          busy={removeBusy}
          error={removeError}
          onConfirm={confirmRemove}
          onCancel={() => { if (!removeBusy) { setRemoving(null); setRemoveError('') } }}
        />
      )}
    </div>
  )
}

// Jobs completed, average job value, and average time-to-complete
// (in_progress -> done, from job_status_events) per technician, for the
// current calendar month - see listTechLeaderboardForMonth() in
// lib/analytics.js. Ranked by jobs completed; a tech with zero completed
// jobs this month still shows (all zeros/dashes) rather than being
// dropped, so the list always matches the team roster above it.
function Leaderboard({ techs, leaderboard }) {
  const statsByTech = Object.fromEntries(leaderboard.map((row) => [row.techId, row]))
  const ranked = [...techs].sort((a, b) => (statsByTech[b.id]?.jobsCompleted || 0) - (statsByTech[a.id]?.jobsCompleted || 0))

  return (
    <div style={{ background: LIGHT.card, borderRadius: 16, padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 700, color: LIGHT.ink, marginBottom: 12 }}>
        <Trophy size={14} color={LIGHT.accent} /> This Month's Leaderboard
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ranked.map((t, i) => {
          const s = statsByTech[t.id]
          return (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 18, fontSize: 12, fontWeight: 700, color: LIGHT.sub, textAlign: 'center', flexShrink: 0 }}>{i + 1}</div>
              <div style={{ width: 30, height: 30, borderRadius: 15, background: LIGHT.accentSoft, color: LIGHT.accent, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {initialsOf(t.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: LIGHT.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: LIGHT.ink }}>{s?.jobsCompleted || 0} jobs</div>
                <div style={{ fontSize: 10.5, color: LIGHT.sub }}>
                  {s?.avgJobValue != null ? money(s.avgJobValue) : '—'} avg · {formatDuration(s?.avgDurationMs)} avg time
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
