import { supabase } from './supabaseClient'
import { recordSmsConsent } from './smsConsent'

// All reads below are automatically scoped to the caller's company by RLS
// (jobs_select/customers_select/etc use company_id = current_company_id()),
// so there's no need to filter by company_id client-side.

const JOB_SELECT = '*, customers(*), job_types(*), assigned_tech:profiles!jobs_assigned_tech_id_fkey(*)'

// locationId narrows to one branch (migration 056's multi-location
// support) - omit it (or pass null/'all') for the owner's combined view
// across every location.
export async function listJobs({ locationId } = {}) {
  let query = supabase
    .from('jobs')
    .select(JOB_SELECT)
    .order('created_at', { ascending: false })
  if (locationId) query = query.eq('location_id', locationId)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function listRecentJobs(limit = 6) {
  const { data, error } = await supabase
    .from('jobs')
    .select(JOB_SELECT)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

// [start, end) - end is exclusive, matches calendar month-grid usage.
export async function listJobsInRange(startDate, endDate, { techId, locationId } = {}) {
  let query = supabase
    .from('jobs')
    .select(JOB_SELECT)
    .gte('scheduled_date', startDate)
    .lt('scheduled_date', endDate)
  if (techId) query = query.eq('assigned_tech_id', techId)
  if (locationId) query = query.eq('location_id', locationId)
  const { data, error } = await query.order('scheduled_date', { ascending: true })
  if (error) throw error
  return data
}

export async function listJobsForTechToday(techId, date) {
  const { data, error } = await supabase
    .from('jobs')
    .select(JOB_SELECT)
    .eq('assigned_tech_id', techId)
    .eq('scheduled_date', date)
    .order('scheduled_window', { ascending: true })
  if (error) throw error
  return data
}

export async function listJobTypes() {
  const { data, error } = await supabase
    .from('job_types')
    .select('*')
    .eq('active', true)
    .order('label', { ascending: true })
  if (error) throw error
  return data
}

export async function listJobsForCustomer(customerId) {
  const { data, error } = await supabase
    .from('jobs')
    .select(JOB_SELECT)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

// Most recent COMPLETED job for this customer, excluding the job
// currently open - lets a job detail view answer "what did we do here
// last time" (date, job type, notes) without a call to the office. Null
// for a first-time customer or one with no completed jobs yet.
export async function getLastVisit(customerId, excludeJobId) {
  if (!customerId) return null
  let query = supabase
    .from('jobs')
    .select(JOB_SELECT)
    .eq('customer_id', customerId)
    .eq('status', 'done')
    .order('completed_at', { ascending: false })
    .limit(1)
  if (excludeJobId) query = query.neq('id', excludeJobId)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

export async function listTeamTechs({ locationId } = {}) {
  let query = supabase
    .from('profiles')
    .select('*')
    .eq('role', 'tech')
  if (locationId) query = query.eq('location_id', locationId)
  const { data, error } = await query.order('name', { ascending: true })
  if (error) throw error
  return data
}

// Per-tech callback rate from the tech_callback_rates view (migrations
// 064/067): completed jobs vs. how many of a tech's jobs turned out to be
// warranty callbacks - a real per-person quality signal for the owner.
// Returns a map keyed by tech id: { completed, callbacks }.
export async function listTechCallbackRates() {
  const { data, error } = await supabase
    .from('tech_callback_rates')
    .select('tech_id, completed_jobs, callback_jobs')
  if (error) throw error
  const map = {}
  for (const r of data || []) map[r.tech_id] = { completed: r.completed_jobs || 0, callbacks: r.callback_jobs || 0 }
  return map
}

// Wraps owner_remove_team_member (migration 062). Revokes the profile's
// access to this company (nulls company_id/location_id server-side) and
// unassigns their open jobs - see the migration for why this doesn't
// delete the underlying auth account.
export async function removeTeamMember(profileId) {
  const { error } = await supabase.rpc('owner_remove_team_member', { p_profile_id: profileId })
  if (error) throw error
}

// Keyed by tech_id. lat/lng live on tech_locations, not profiles - there's
// no GPS pipeline populating this yet, so it'll be an empty map in
// practice until a mobile app starts upserting positions.
export async function listOfficeAdmins() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'office_admin')
    .order('name', { ascending: true })
  if (error) throw error
  return data
}

export async function listTechLocationsById() {
  const { data, error } = await supabase.from('tech_locations').select('*')
  if (error) throw error
  return Object.fromEntries(data.map((loc) => [loc.tech_id, loc]))
}

// Reuses an existing customer by phone within the company if there's an
// exact match, otherwise creates a new one - avoids duplicate contacts for
// repeat callers without building a full CRM matching flow. Only the
// create path sets pipeline_stage (default 'booked', since this is called
// right alongside creating a job for them) - an existing match's stage is
// never touched, so manually dragging a contact on the Clients pipeline
// never gets silently overwritten by a later job.
//
// `smsConsent` (from the New Job form's consent checkbox) is applied via
// record_sms_consent AFTER the customer exists/is found, not as part of
// the insert - this covers both branches uniformly (a brand-new contact,
// or a returning one whose consent wasn't on file yet) through the same
// audited code path. It only ever turns consent ON here: leaving the box
// unchecked just means "no verified consent yet," not "revoke" - real
// revocation happens via an explicit STOP reply or the Clients page
// toggle (see AUTH.md "SMS consent & compliance").
export async function findOrCreateCustomer({ name, phone, address, pipelineStage = 'booked', smsConsent = false }) {
  let customer
  if (phone) {
    const { data: existing, error: findError } = await supabase
      .from('customers')
      .select('*')
      .eq('phone', phone)
      .maybeSingle()
    if (findError) throw findError
    customer = existing || null
  }
  if (!customer) {
    const { data, error } = await supabase
      .from('customers')
      .insert({ name, phone, address, pipeline_stage: pipelineStage })
      .select()
      .single()
    if (error) throw error
    customer = data
  }
  if (smsConsent && !customer.sms_consent) {
    await recordSmsConsent(customer.id, true, 'web_form', 'Captured on New Job form')
    customer = { ...customer, sms_consent: true }
  }
  return customer
}

export async function createJob({
  customerId, jobTypeId, description, address, urgency,
  scheduledDate, scheduledWindow, priceLow, priceHigh,
}) {
  const { data, error } = await supabase
    .from('jobs')
    .insert({
      customer_id: customerId,
      job_type_id: jobTypeId,
      description,
      address,
      urgency,
      scheduled_date: scheduledDate || null,
      scheduled_window: scheduledWindow || null,
      price_low: priceLow || null,
      price_high: priceHigh || null,
      source: 'manual',
    })
    .select(JOB_SELECT)
    .single()
  if (error) throw error
  return data
}

export async function assignJob(jobId, techId, currentStatus) {
  const nextStatus = currentStatus === 'unassigned' ? 'assigned' : currentStatus
  const { error } = await supabase
    .from('jobs')
    .update({ assigned_tech_id: techId, status: nextStatus })
    .eq('id', jobId)
  if (error) throw error
}

// Updates the job's status and records the transition in job_status_events
// (the audit trail that also powers "checked in, location verified").
export async function advanceJobStatus(jobId, status, actorId, extra = {}) {
  const patch = { status, ...extra }
  if (status === 'done') patch.completed_at = new Date().toISOString()
  const { error: updateError } = await supabase.from('jobs').update(patch).eq('id', jobId)
  if (updateError) throw updateError

  const { error: eventError } = await supabase
    .from('job_status_events')
    .insert({ job_id: jobId, status, changed_by: actorId })
  if (eventError) throw eventError
}

export async function updateJobNotes(jobId, notes) {
  const { error } = await supabase.from('jobs').update({ notes }).eq('id', jobId)
  if (error) throw error
}

// Haversine distance in km. Returns null if either point is missing -
// job.lat/lng and tech_locations.lat/lng have no geocoding pipeline wired
// up yet, so this will usually be null until that exists.
export function distanceKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
