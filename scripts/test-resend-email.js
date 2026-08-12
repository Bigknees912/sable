#!/usr/bin/env node
// One-off script to confirm a RESEND_API_KEY works before wiring it into
// the automation email flow (supabase/functions/run-automation-email).
// Not part of the deployed app - that edge function reads RESEND_API_KEY
// via Deno.env.get() directly from the Supabase project's own env config,
// so it doesn't need dotenv. This script is a local sanity check only.
//
// Usage:
//   1. Create a .env file in the project root with:
//        RESEND_API_KEY=your_key_here
//      (.env is already gitignored, see .gitignore)
//   2. node scripts/test-resend-email.js

import 'dotenv/config'
import { Resend } from 'resend'

if (!process.env.RESEND_API_KEY) {
  console.error('Missing RESEND_API_KEY - add it to a .env file in the project root.')
  process.exit(1)
}

const resend = new Resend(process.env.RESEND_API_KEY)

const { data, error } = await resend.emails.send({
  from: 'onboarding@resend.dev',
  to: 'tranevan96@gmail.com',
  subject: 'Hello World',
  html: '<p>Congrats on sending your <strong>first email</strong>!</p>',
})

if (error) {
  console.error('Send failed:', error)
  process.exit(1)
}

console.log('Sent:', data)
