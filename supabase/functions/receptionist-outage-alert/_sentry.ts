import * as Sentry from "npm:@sentry/deno@^8";

// Error reporting to Sentry, gracefully disabled if SENTRY_DSN isn't set
// (same "code now, configure secrets later" pattern as every other
// integration in this app - see AUTH.md "Error tracking (Sentry)").
// Deliberately duplicated per function rather than a true shared module -
// each edge function is deployed as an independent bundle, same reasoning
// already established for toE164 elsewhere in this codebase.

const dsn = Deno.env.get("SENTRY_DSN");

if (dsn) {
  Sentry.init({
    dsn,
    // The Deno SDK doesn't instrument this runtime, and Edge Function
    // isolates can be reused across unrelated requests - per Supabase's
    // own Sentry integration guide, default integrations must stay off
    // or breadcrumbs/context leak between requests.
    defaultIntegrations: false,
    tracesSampleRate: 0, // error tracking only, no performance tracing
    environment: Deno.env.get("SENTRY_ENVIRONMENT") || "production",
  });
  Sentry.setTag("region", Deno.env.get("SB_REGION"));
  Sentry.setTag("execution_id", Deno.env.get("SB_EXECUTION_ID"));
}

// Edge Function isolates terminate immediately after the response is
// returned, so every capture needs an explicit flush or the event may
// never actually reach Sentry.
export async function reportError(err: unknown, context?: Record<string, unknown>) {
  console.error(err);
  if (!dsn) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
  await Sentry.flush(2000);
}
