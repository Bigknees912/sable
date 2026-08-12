import { createClient } from "npm:@supabase/supabase-js@2";
import { reportError } from "./_sentry.ts";

// Task 2: public, no-login customer portal backend.
//
// Given a job's portal_token (from the link in the booking confirmation
// text), returns ONLY that one job's customer-safe fields. verify_jwt is
// OFF - the homeowner has no Supabase session; the unguessable token IS
// the credential. Uses the service role but filters strictly by an exact
// token match, so a wrong/guessed token returns a generic 404 and can
// never surface another customer's job. Only whitelisted fields are
// returned - no internal pricing math, no other customers, no company
// operations data.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// Customer-facing status ladder (maps internal job.status to what the
// homeowner sees on the portal).
const STATUS_STEPS = [
  { key: "booked", label: "Booked" },
  { key: "en_route", label: "Tech en route" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
];
function publicStatus(jobStatus: string): string {
  if (jobStatus === "unassigned" || jobStatus === "assigned") return "booked";
  if (jobStatus === "in_progress") return "in_progress";
  if (jobStatus === "done") return "completed";
  if (jobStatus === "cancelled") return "cancelled";
  return "booked";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    let token = url.searchParams.get("t") || url.searchParams.get("token");
    if (!token && (req.method === "POST")) {
      const body = await req.json().catch(() => ({}));
      token = typeof body.token === "string" ? body.token : null;
    }
    // Reject obviously malformed tokens without touching the DB. Real tokens
    // are 48 hex chars (see migration 066).
    if (!token || !/^[a-f0-9]{32,96}$/.test(token)) {
      return json({ error: "not_found" }, 404);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: job, error } = await supabase
      .from("jobs")
      .select(
        "id, status, description, address, scheduled_date, scheduled_window, price_low, price_high, is_callback, callback_waived, created_at, completed_at, " +
        "customers(name), companies(name), job_types(label), assigned_tech:profiles!jobs_assigned_tech_id_fkey(name)"
      )
      .eq("portal_token", token)
      .maybeSingle();

    if (error) throw error;
    if (!job) return json({ error: "not_found" }, 404);

    // Invoice, only exposed once the job is completed.
    let invoice: { amount: number; status: string; invoice_no: string; paid: boolean } | null = null;
    if (job.status === "done") {
      const { data: inv } = await supabase
        .from("invoices")
        .select("amount, status, invoice_no, paid_at")
        .eq("job_id", job.id)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (inv) invoice = { amount: inv.amount, status: inv.status, invoice_no: inv.invoice_no, paid: Boolean(inv.paid_at) };
    }

    const company = job.companies as unknown as { name: string } | null;
    const customer = job.customers as unknown as { name: string } | null;
    const tech = job.assigned_tech as unknown as { name: string } | null;
    const jobType = job.job_types as unknown as { label: string } | null;

    return json({
      company: company?.name || "Your service provider",
      customerFirstName: customer?.name?.trim().split(/\s+/)[0] || null,
      service: jobType?.label || job.description,
      address: job.address,
      scheduledDate: job.scheduled_date,
      scheduledWindow: job.scheduled_window,
      technician: tech?.name || null,
      status: publicStatus(job.status),
      steps: STATUS_STEPS,
      priceLow: job.callback_waived ? 0 : job.price_low,
      priceHigh: job.callback_waived ? 0 : job.price_high,
      isCallback: Boolean(job.is_callback),
      invoice,
    });
  } catch (err) {
    await reportError(err, { function: "job-status" });
    return json({ error: "server_error" }, 500);
  }
});
