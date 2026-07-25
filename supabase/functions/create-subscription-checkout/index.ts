import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { reportError } from "./_sentry.ts";

// Called right after create_company_and_owner() during self-serve signup,
// when the owner picked a paid plan (growth/pro) - starter is free and
// never reaches this function. verify_jwt (set at deploy time) already
// rejects requests without a valid Supabase session before this code runs.

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

// Maps a plan key to the Stripe Price env var that holds its real, live
// dollar amount - set once in the Supabase dashboard after creating
// recurring Prices in Stripe. See AUTH.md "Self-serve onboarding & billing".
const PRICE_ENV_BY_PLAN: Record<string, string> = {
  starter: "STRIPE_PRICE_STARTER", // "Solo" tier (migration 069) - now paid
  growth: "STRIPE_PRICE_GROWTH",   // "Team"
  pro: "STRIPE_PRICE_PRO",         // "Fleet"
};

// Advertised everywhere (pricing page, get-started, cancel copy): a 7-day
// free trial, card required. This is where that promise is actually kept -
// without it, Stripe bills the first month immediately.
const TRIAL_DAYS = 7;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { plan } = await req.json();
    if (!PRICE_ENV_BY_PLAN[plan]) return json({ error: "plan must be one of: starter (Solo), growth (Team), pro (Fleet)" }, 400);

    // RLS-scoped client acting as the caller (their JWT is forwarded), so
    // this can only ever read/act on the caller's own company - same
    // guarantee every other write in this app relies on.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
    );

    // Stripe Price id: prefer plans.stripe_price_id (DB is the source of
    // truth, set by migration 071), fall back to the STRIPE_PRICE_* env var.
    const { data: planRow } = await supabase.from("plans").select("stripe_price_id").eq("key", plan).maybeSingle();
    const priceId = planRow?.stripe_price_id || Deno.env.get(PRICE_ENV_BY_PLAN[plan]);
    if (!priceId) {
      return json({ error: "Billing isn't fully set up yet: no Stripe price configured for this plan. Your workspace was still created." }, 500);
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) return json({ error: "unauthorized" }, 401);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, company_id")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (profile?.role !== "owner" || !profile.company_id) {
      return json({ error: "only an owner with a company can start a subscription" }, 403);
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
    const origin = req.headers.get("origin") || "https://example.com";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.email || undefined,
      // Set on the Checkout Session (for checkout.session.completed) AND
      // propagated to the underlying Subscription object (for
      // customer.subscription.updated/deleted, which don't carry the
      // session's own metadata) - see stripe-webhook/index.ts.
      metadata: { company_id: profile.company_id, plan },
      subscription_data: {
        metadata: { company_id: profile.company_id, plan },
        // The 7-day free trial the whole product promises. Card is still
        // collected now (Checkout requires it), but the first charge only
        // lands on day 8.
        trial_period_days: TRIAL_DAYS,
      },
      success_url: `${origin}/?subscription=active`,
      cancel_url: `${origin}/?subscription=cancelled`,
    });

    return json({ url: session.url });
  } catch (err) {
    await reportError(err, { function: "create-subscription-checkout" });
    return json({ error: err instanceof Error ? err.message : "internal error" }, 500);
  }
});
