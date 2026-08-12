import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { reportError } from "./_sentry.ts";

// Self-serve "Cancel Subscription" from Settings, behind a confirmation
// dialog on the client. Cancels at the END of the current paid period
// (Stripe's cancel_at_period_end), not immediately - an owner who cancels
// keeps what they already paid for instead of losing access mid-period,
// which is both the standard SaaS behavior and the fairer one. The
// existing stripe-webhook customer.subscription.updated handler is the
// source of truth for current_period_end/status; this function also
// writes cancel_at_period_end directly for instant UI feedback rather than
// waiting on webhook delivery.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // RLS-scoped client acting as the caller - same pattern as
    // create-subscription-checkout, so this can only ever act on the
    // caller's own company, never a client-supplied one.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) return json({ error: "unauthorized" }, 401);

    // Optional "reason for leaving" - stored for the operator's records,
    // never required to complete the cancellation.
    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, company_id")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (profile?.role !== "owner" || !profile.company_id) {
      return json({ error: "only an owner with a company can cancel a subscription" }, 403);
    }

    const { data: sub, error: subError } = await supabase
      .from("subscriptions")
      .select("stripe_subscription_id, plan, cancel_at_period_end")
      .eq("company_id", profile.company_id)
      .maybeSingle();
    if (subError) throw subError;
    if (!sub?.stripe_subscription_id) {
      return json({ error: "No active paid subscription to cancel - you're on the free plan." }, 400);
    }
    if (sub.cancel_at_period_end) {
      return json({ error: "This subscription is already scheduled to cancel." }, 400);
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
    const updated = await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });

    const periodEnd = (updated as unknown as { current_period_end?: number }).current_period_end;
    const { error: updateError } = await supabase
      .from("subscriptions")
      .update({
        cancel_at_period_end: true,
        current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        cancellation_reason: reason,
        cancellation_requested_at: new Date().toISOString(),
      })
      .eq("company_id", profile.company_id);
    if (updateError) throw updateError;

    return json({ cancel_at_period_end: true, current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null });
  } catch (err) {
    await reportError(err, { function: "cancel-subscription" });
    return json({ error: err instanceof Error ? err.message : "internal error" }, 500);
  }
});
