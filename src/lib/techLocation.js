import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

// --- Phase 1 live location -------------------------------------------------
//
// A technician's browser upserts one row into tech_locations while they have
// a job in progress AND the app is open in the foreground. This is FOREGROUND
// ONLY by design: the Geolocation API stops delivering positions once the tab
// is hidden or the phone is locked, so we don't pretend otherwise. True
// background tracking needs a native app wrapper and OS-level permissions -
// that's Phase 2 and intentionally not built here.
//
// Battery: GPS is one of the most power-hungry sensors on a phone. We keep the
// drain reasonable by (a) polling on an interval rather than a tight
// watchPosition stream, (b) defaulting to the OS's lower-power location mode
// (enableHighAccuracy: false - cell/wifi fix, good enough for "which side of
// town is my tech on"), and (c) only running while a job is actually in
// progress and the tab is visible. It still uses more battery than an idle
// app; techs should know that.
//
// Privacy: nothing is shared unless a job is in progress and the tech has
// granted permission. The tech always sees an on-screen indicator while it's
// active (see TechHome), sharing stops the moment the job is done / the app is
// backgrounded / they log out, and the row is deleted when sharing stops so no
// stale "last seen" pin lingers. RLS makes a tech's position visible only to
// their owner/office-admin and themselves, never to coworkers.

const PING_INTERVAL_MS = 45000 // ~45s: middle of the 30-60s band the spec asked for

export async function upsertTechLocation({ techId, companyId, jobId, lat, lng, accuracy }) {
  const { error } = await supabase
    .from('tech_locations')
    .upsert(
      { tech_id: techId, company_id: companyId, job_id: jobId ?? null, lat, lng, accuracy, updated_at: new Date().toISOString() },
      { onConflict: 'tech_id' }
    )
  if (error) throw error
}

export async function clearTechLocation(techId) {
  // Best-effort: if this fails (e.g. offline as the tab closes) it's not worth
  // surfacing - the owner UI treats stale pings as offline anyway.
  await supabase.from('tech_locations').delete().eq('tech_id', techId)
}

// Returns { sharing, status, error, lastPingAt }.
//   status: 'idle' | 'sharing' | 'denied' | 'unavailable' | 'error'
// Pass the tech's active in-progress job (or null). Sharing runs only while
// activeJob is truthy, the tab is visible, and permission is granted.
export function useLocationSharing({ techId, companyId, activeJob }) {
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [lastPingAt, setLastPingAt] = useState(null)
  const timerRef = useRef(null)
  const clearedRef = useRef(true)

  useEffect(() => {
    const jobId = activeJob?.id || null
    const shouldShare = Boolean(techId && companyId && jobId)

    if (!shouldShare) {
      stop(true)
      setStatus('idle')
      return
    }
    if (!('geolocation' in navigator)) {
      setStatus('unavailable')
      setError('This device or browser can’t share location.')
      return
    }

    function ping() {
      if (document.visibilityState !== 'visible') return // foreground-only
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            await upsertTechLocation({
              techId,
              companyId,
              jobId,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            })
            clearedRef.current = false
            setStatus('sharing')
            setError('')
            setLastPingAt(Date.now())
          } catch (e) {
            setStatus('error')
            setError(e.message || 'Could not send location.')
          }
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            setStatus('denied')
            setError('Location permission is off. Turn it on to share your position with dispatch.')
          } else {
            setStatus('error')
            setError('Couldn’t get a location fix. Trying again shortly.')
          }
        },
        { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 }
      )
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') ping()
    }

    ping() // immediate first fix
    timerRef.current = setInterval(ping, PING_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(timerRef.current)
      document.removeEventListener('visibilitychange', onVisibility)
      // Clear the pin so the owner map doesn't show a frozen position after
      // the job ends or the tech navigates away.
      if (!clearedRef.current && techId) {
        clearedRef.current = true
        clearTechLocation(techId)
      }
    }

    function stop(clearPin) {
      clearInterval(timerRef.current)
      if (clearPin && !clearedRef.current && techId) {
        clearedRef.current = true
        clearTechLocation(techId)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techId, companyId, activeJob?.id])

  return { sharing: status === 'sharing', status, error, lastPingAt }
}
