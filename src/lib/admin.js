import { supabase } from './supabaseClient'

// Thin wrappers around the admin_* SECURITY DEFINER RPCs (migrations
// 036-042). Every one of these re-checks is_super_admin() server-side, so
// a non-admin authenticated user calling any of them gets a clean
// "not authorized" error rather than data - these client-side wrappers
// aren't the security boundary, the database is. See AUTH.md
// "Super-admin panel".

export async function isSuperAdmin() {
  const { data, error } = await supabase.rpc('is_super_admin')
  if (error) throw error
  return !!data
}

export async function listCompanies() {
  // Merge the main listing with the cancellation signal (migration 068) so
  // the panel can show a chosen-to-leave account ("Cancelling") distinct
  // from a non-payment "Suspended". Both are super-admin-gated RPCs.
  const [{ data, error }, cancellations] = await Promise.all([
    supabase.rpc('admin_list_companies'),
    supabase.rpc('admin_company_cancellations').then((r) => (r.error ? [] : r.data || [])),
  ])
  if (error) throw error
  const cancelByCompany = {}
  for (const c of cancellations) cancelByCompany[c.company_id] = c
  return (data || []).map((c) => {
    const cx = cancelByCompany[c.id]
    return cx
      ? { ...c, cancel_at_period_end: cx.cancel_at_period_end, cancellation_reason: cx.cancellation_reason, cancellation_period_end: cx.current_period_end }
      : c
  })
}

export async function getCompanyDetail(companyId) {
  const { data, error } = await supabase.rpc('admin_get_company_detail', { p_company_id: companyId })
  if (error) throw error
  return data
}

export async function createCompany({ name, contactEmail, plan, trade }) {
  const { data, error } = await supabase.rpc('admin_create_company', {
    p_name: name,
    p_contact_email: contactEmail || null,
    p_plan: plan,
    p_trade: trade || 'Plumbing',
  })
  if (error) throw error
  return data
}

export async function setCompanyStatus(companyId, status) {
  const { error } = await supabase.rpc('admin_set_company_status', { p_company_id: companyId, p_status: status })
  if (error) throw error
}

// Unlike listPlans() in lib/plans.js (active plans only, for the
// self-serve signup screen), this returns every plan including retired
// ones - the plans_select RLS policy allows that for a super admin.
export async function listPlansAdmin() {
  const { data, error } = await supabase.from('plans').select('*').order('display_order', { ascending: true })
  if (error) throw error
  return data
}

export async function upsertPlan({ key, name, monthlyPrice, features, displayOrder, active, seatLimit }) {
  const { data, error } = await supabase.rpc('admin_upsert_plan', {
    p_key: key,
    p_name: name,
    p_monthly_price: monthlyPrice,
    p_features: features || [],
    p_display_order: displayOrder ?? null,
    p_active: active ?? true,
    p_seat_limit: seatLimit ?? null,
  })
  if (error) throw error
  return data
}

export async function reorderPlans(orderedKeys) {
  const { error } = await supabase.rpc('admin_reorder_plans', { p_ordered_keys: orderedKeys })
  if (error) throw error
}

export async function deletePlan(key) {
  const { error } = await supabase.rpc('admin_delete_plan', { p_key: key })
  if (error) throw error
}

export async function setCompanyOverride(companyId, overridePrice, note) {
  const { error } = await supabase.rpc('admin_set_company_override', {
    p_company_id: companyId,
    p_override_price: overridePrice,
    p_note: note || null,
  })
  if (error) throw error
}

export async function revenueOverview() {
  const { data, error } = await supabase.rpc('admin_revenue_overview')
  if (error) throw error
  return data
}

export async function listAuditLog(limit = 100) {
  const { data, error } = await supabase.rpc('admin_list_audit_log', { p_limit: limit })
  if (error) throw error
  return data
}
