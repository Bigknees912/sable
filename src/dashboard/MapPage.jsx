import { useState } from 'react'
import { MapPin, Navigation, ExternalLink } from 'lucide-react'
import { listTechLocationsById, listTeamTechs } from '../lib/jobs'
import { useAsyncData } from './useAsyncData'
import { useTableRealtime } from './useTableRealtime'
import { LIGHT } from '../theme'
import { SectionLabel, LoadingState, ErrorState, ErrorBanner, EmptyState } from './ui'

// A ping older than this is treated as "offline" - the tech closed the app or
// finished the job (which also deletes the row, but this covers dropped tabs).
const STALE_MS = 2 * 60 * 1000

function freshness(updatedAt) {
  const age = Date.now() - new Date(updatedAt).getTime()
  if (age > STALE_MS) return { stale: true, label: 'offline' }
  const secs = Math.round(age / 1000)
  if (secs < 60) return { stale: false, label: `${secs}s ago` }
  return { stale: false, label: `${Math.round(secs / 60)}m ago` }
}

// Normalizes lat/lng into a 0-100 box so pins can be plotted on a plain
// schematic panel. Phase 1 deliberately avoids a real tile provider (Mapbox /
// Google Maps) - that needs an API key, billing, and CSP changes. Each card
// links out to Google Maps for the real street view instead.
function plot(points) {
  const live = points.filter((p) => p.lat != null && p.lng != null)
  if (live.length === 0) return []
  const lats = live.map((p) => p.lat), lngs = live.map((p) => p.lng)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  const spanLat = maxLat - minLat || 1, spanLng = maxLng - minLng || 1
  return live.map((p) => ({
    ...p,
    // y is inverted because screen y grows downward but latitude grows north.
    x: 8 + ((p.lng - minLng) / spanLng) * 84,
    y: 8 + (1 - (p.lat - minLat) / spanLat) * 84,
  }))
}

export default function MapPage({ company }) {
  const [byId, setById] = useState({})
  const [techs, setTechs] = useState([])

  async function load() {
    const [locs, team] = await Promise.all([listTechLocationsById(), listTeamTechs()])
    setById(locs)
    setTechs(team)
  }
  const { loading, error, hasLoadedOnce, reload } = useAsyncData(load, [company?.id])

  // Live updates: any insert/update/delete on the company's tech_locations
  // rows re-pulls the map. Cheap because the table has at most one row per tech.
  useTableRealtime('tech_locations', company?.id, reload)

  if (loading && !hasLoadedOnce) return <LoadingState />
  if (error && !hasLoadedOnce) return <ErrorState message={error} onRetry={reload} />

  // Join team members with their (optional) live location.
  const rows = techs
    .map((t) => ({ tech: t, loc: byId[t.id] || null }))
    .map((r) => ({ ...r, fresh: r.loc ? freshness(r.loc.updated_at) : null }))
  const liveRows = rows.filter((r) => r.loc && r.fresh && !r.fresh.stale)
  const plotted = plot(liveRows.map((r) => ({ id: r.tech.id, name: r.tech.name, lat: r.loc.lat, lng: r.loc.lng })))

  return (
    <>
      <ErrorBanner message={error && hasLoadedOnce ? error : ''} onRetry={reload} />
      <SectionLabel>Live Map</SectionLabel>

      {liveRows.length === 0 ? (
        <EmptyState>
          <MapPin size={22} color={LIGHT.sub} style={{ marginBottom: 8 }} />
          <div style={{ fontWeight: 700, color: LIGHT.ink, marginBottom: 4 }}>No one sharing right now</div>
          Technicians appear here while they have a job in progress and the app open. Location sharing is foreground-only for now.
        </EmptyState>
      ) : (
        <>
          {/* Schematic plot (no map tiles - see plot() comment). */}
          <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 10', background: LIGHT.card, border: `1px solid ${LIGHT.border}`, borderRadius: 16, overflow: 'hidden', marginBottom: 16, backgroundImage: `linear-gradient(${LIGHT.border} 1px, transparent 1px), linear-gradient(90deg, ${LIGHT.border} 1px, transparent 1px)`, backgroundSize: '28px 28px' }}>
            {plotted.map((p) => (
              <div key={p.id} style={{ position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <span className="pulse-loc" style={{ width: 16, height: 16, borderRadius: 8, background: LIGHT.success, border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
                <span style={{ fontSize: 10.5, fontWeight: 700, color: LIGHT.ink, background: 'rgba(245,244,237,0.85)', padding: '1px 5px', borderRadius: 5 }}>{p.name?.split(' ')[0]}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <SectionLabel>Crew ({rows.length})</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(({ tech, loc, fresh }) => {
          const online = loc && fresh && !fresh.stale
          return (
            <div key={tech.id} style={{ background: LIGHT.card, borderRadius: 16, padding: 14, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 38, height: 38, borderRadius: 19, background: online ? LIGHT.successSoft : LIGHT.border, color: online ? LIGHT.success : LIGHT.sub, fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {(tech.name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: LIGHT.ink }}>{tech.name}</div>
                <div style={{ fontSize: 12, color: online ? LIGHT.success : LIGHT.sub, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {online ? (
                    <>
                      <span className="pulse-loc" style={{ width: 7, height: 7, borderRadius: 4, background: LIGHT.success, display: 'inline-block' }} />
                      Live · {fresh.label}{loc.accuracy ? ` · ±${Math.round(loc.accuracy)}m` : ''}
                    </>
                  ) : (
                    <>Not sharing{loc ? ` · last seen ${fresh.label}` : ''}</>
                  )}
                </div>
              </div>
              {online && (
                <a
                  href={`https://maps.google.com/?q=${loc.lat},${loc.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tap"
                  style={{ fontSize: 12, fontWeight: 600, color: LIGHT.ink, border: `1px solid ${LIGHT.border}`, borderRadius: 8, padding: '7px 11px', display: 'flex', alignItems: 'center', gap: 5, textDecoration: 'none', whiteSpace: 'nowrap' }}
                >
                  <Navigation size={13} /> Maps <ExternalLink size={11} />
                </a>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
