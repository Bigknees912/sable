import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { reportError } from "./_sentry.ts";

// Audit fix I3: a real owner-facing plan change (upgrade/downgrade), so the
// marketing "upgrade to the next tier in one click" is actually true and a
// company that outgrows its seat cap has a path forward.
//
// Swaps the existing Stripe subscription's single price item to the target
// plan's price with proration (Stripe credits/charges the difference), then
// lets the stripe-webhook customer.subscription.updated handler sync
// plan/status/period back into our `subscriptions` row (source of truth).
// RLS-scoped client → can only ever touch the caller's own company.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const PRICE_ENV_BY_PLAN: Record<string, string> = {
  starter: "STRIPE_PRICE_STARTER", // Solo
  growth: "STRIPE_PRICE_GROWTH",   // Team
  pro: "STRIPE_PRICE_PRO",         // Fleet
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { plan } = await req.json();
    if (!PRICE_ENV_BY_PLAN[plan]) return json({ error: "plan must be one of: starter (Solo), growth (Team), pro (Fleet)" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
    );

    // Price id from plans.stripe_price_id (migration 071), env fallback.
    const { data: planRow } = await supabase.from("plans").select("stripe_price_id").eq("key", plan).maybeSingle();
    const priceId = planRow?.stripe_price_id || Deno.env.get(PRICE_ENV_BY_PLAN[plan]);
    if (!priceId) return json({ error: "Billing isn't fully set up: no Stripe price configured for this plan." }, 500);

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ error: "unauthorized" }, 401);

    const { data: profile, error: profileError } = await supabase
      .from("profiles").select("role, company_id").eq("id", user.id).maybeSingle();
    if (profileError) throw profileError;
    if (profile?.role !== "owner" || !profile.company_id) {
      return json({ error: "only an owner with a company can change the plan" }, 403);
    }

    const { data: sub, error: subError } = await supabase
      .from("subscriptions").select("stripe_subscription_id, plan").eq("company_id", profile.company_id).maybeSingle();
    if (subError) throw subError;
    if (!sub?.stripe_subscription_id) {
      return json({ error: "No active subscription to change. Start one first." }, 400);
    }
    if (sub.plan === plan) return json({ error: "You're already on that plan." }, 400);

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
    const current = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    const itemId = current.items.data[0]?.id;
    if (!itemId) return json({ error: "Subscription has no billable item to change." }, 500);

    // Swap the price with proration. metadata.plan is updated so the webhook
    // writes the new plan key back to our row.
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      items: [{ id: itemId, price: priceId }],
      proration_behavior: "create_prorations",
      metadata: { company_id: profile.company_id, plan },
    });

    // Optimistic local write for instant UI; the webhook is the source of truth.
    await supabase.from("subscriptions").update({ plan }).eq("company_id", profile.company_id);

    return json({ plan });
  } catch (err) {
    await reportError(err, { function: "change-subscription-plan" });
    return json({ error: err instanceof Error ? err.message : "internal error" }, 500);
  }
});
