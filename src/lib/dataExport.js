import { listJobs } from './jobs'
import { listContacts } from './crm'

// Backs Settings' "Export Your Data" button - the concrete follow-through
// on the pricing page's "no lock-in" promise. Everything here is read
// through the same RLS-scoped queries the rest of the app already uses
// (listJobs/listContacts), so this can only ever export the caller's own
// company's data - there's no separate export RPC/service-role path that
// could be pointed at someone else's records.
//
// One JSON file rather than a CSV per table: it's a single download, needs
// no extra dependency (no zip library) to bundle multiple files, and
// preserves the job<->customer<->job-type relationships CSV would flatten
// or duplicate. jobs already come back with their customer and job type
// nested (see lib/jobs.js's JOB_SELECT), so a job row IS that job's history
// entry - there's no separate "history" table to also fetch.
export async function buildCompanyExport(company) {
  const [jobs, customers] = await Promise.all([listJobs(), listContacts()])
  return {
    exportedAt: new Date().toISOString(),
    company: { name: company?.name, trade: company?.trade, serviceArea: company?.service_area },
    customers: customers.map((c) => ({
      name: c.name,
      phone: c.phone,
      email: c.email,
      address: c.address,
      pipelineStage: c.pipeline_stage,
      tags: c.tags,
      smsConsent: c.sms_consent,
      createdAt: c.created_at,
    })),
    jobs: jobs.map((j) => ({
      jobType: j.job_types?.label || null,
      description: j.description,
      customer: j.customers?.name || null,
      customerPhone: j.customers?.phone || null,
      address: j.address,
      status: j.status,
      urgency: j.urgency,
      priceLow: j.price_low,
      priceHigh: j.price_high,
      depositStatus: j.deposit_status,
      depositAmount: j.deposit_amount,
      assignedTech: j.assigned_tech?.name || null,
      notes: j.notes,
      scheduledDate: j.scheduled_date,
      scheduledWindow: j.scheduled_window,
      completedAt: j.completed_at,
      createdAt: j.created_at,
    })),
  }
}

// Triggers a browser download of the export as formatted JSON - no server
// round-trip beyond the two reads above, so there's nothing to clean up or
// expire server-side afterward.
export async function downloadCompanyExport(company) {
  const payload = await buildCompanyExport(company)
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const slug = (company?.name || 'sable-export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const a = document.createElement('a')
  a.href = url
  a.download = `${slug}-export-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
