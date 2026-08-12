import * as Sentry from "npm:@sentry/deno@^8";

// Error reporting to Sentry, gracefully disabled if SENTRY_DSN isn't set.
// Deliberately duplicated per function - each edge function is deployed as
// an independent bundle.

const dsn = Deno.env.get("SENTRY_DSN");

if (dsn) {
  Sentry.init({
    dsn,
    defaultIntegrations: false,
    tracesSampleRate: 0,
    environment: Deno.env.get("SENTRY_ENVIRONMENT") || "production",
  });
  Sentry.setTag("region", Deno.env.get("SB_REGION"));
  Sentry.setTag("execution_id", Deno.env.get("SB_EXECUTION_ID"));
}

export async function reportError(err: unknown, context?: Record<string, unknown>) {
  console.error(err);
  if (!dsn) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
  await Sentry.flush(2000);
}
