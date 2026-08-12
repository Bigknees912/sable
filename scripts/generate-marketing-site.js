#!/usr/bin/env node
// Regenerates marketing-site.html for one specific company: fills in the
// {{TOKEN}} placeholders in the template with that company's real name,
// service area, trade-appropriate copy, and active service catalog -
// instead of the site being hardcoded to Sable Plumbing & Drain. Same
// per-client resale model as receptionist-server/generate-assistant.js:
// one deployed marketing site = one company, regenerate + redeploy when
// the catalog or copy needs change.
//
// Usage: node scripts/generate-marketing-site.js ["(403) 555-0100"]
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_COMPANY_ID
// from the environment (see .env.example) - this script doesn't load a
// .env file itself, export them in your shell first or use a tool like
// dotenv-cli/direnv, same as receptionist-server's scripts.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SERVICE_ICONS = ['◐', '⚡', '♨', '◧', '▤', '▽']

// Trade-specific marketing copy - short enough to hand-author per trade,
// unlike the service catalog itself (which is real DB data, see migration
// 044's trade_job_type_templates). Keyed on the same trade names as the
// onboarding picker; an unrecognized trade falls back to generic copy
// instead of failing the whole generation.
const TRADE_CONTENT = {
  Plumbing: {
    professional: 'plumber',
    heroHeadline: 'The plumber that<br>actually <span class="accent">picks up.</span>',
    heroSub: 'Real-time quotes over the phone, technicians tracked live, and a job booked before you\'ve hung up. No voicemail, no "we\'ll call you back."',
    servicesHeadline: 'Every job, from a dripping faucet to a flooded basement.',
    finalCtaHeadline: 'Something leaking right now?',
    emergencyExample: 'a burst pipe',
  },
  Electrical: {
    professional: 'electrician',
    heroHeadline: 'The electrician that<br>actually <span class="accent">picks up.</span>',
    heroSub: 'Real-time quotes over the phone, electricians tracked live, and a job booked before you\'ve hung up. No voicemail, no "we\'ll call you back."',
    servicesHeadline: 'Every job, from a dead outlet to a full panel upgrade.',
    finalCtaHeadline: 'Lights out right now?',
    emergencyExample: 'a sparking outlet',
  },
  HVAC: {
    professional: 'HVAC tech',
    heroHeadline: 'The HVAC tech that<br>actually <span class="accent">picks up.</span>',
    heroSub: 'Real-time quotes over the phone, techs tracked live, and a job booked before you\'ve hung up. No voicemail, no "we\'ll call you back."',
    servicesHeadline: 'Every job, from a dead thermostat to a full furnace install.',
    finalCtaHeadline: 'No heat or no AC right now?',
    emergencyExample: 'a dead furnace in a cold snap',
  },
  Roofing: {
    professional: 'roofer',
    heroHeadline: 'The roofer that<br>actually <span class="accent">picks up.</span>',
    heroSub: 'Real-time quotes over the phone, crews tracked live, and a job booked before you\'ve hung up. No voicemail, no "we\'ll call you back."',
    servicesHeadline: 'Every job, from a small leak to a full re-roof.',
    finalCtaHeadline: 'Roof leaking right now?',
    emergencyExample: 'an active roof leak during a storm',
  },
  Locksmith: {
    professional: 'locksmith',
    heroHeadline: 'The locksmith that<br>actually <span class="accent">picks up.</span>',
    heroSub: 'Real-time quotes over the phone, technicians tracked live, and a job booked before you\'ve hung up. No voicemail, no "we\'ll call you back."',
    servicesHeadline: 'Every job, from a lockout to a full rekey.',
    finalCtaHeadline: 'Locked out right now?',
    emergencyExample: 'a lockout',
  },
}
const DEFAULT_TRADE_CONTENT = {
  professional: 'technician',
  heroHeadline: 'The team that<br>actually <span class="accent">picks up.</span>',
  heroSub: 'Real-time quotes over the phone, technicians tracked live, and a job booked before you\'ve hung up. No voicemail, no "we\'ll call you back."',
  servicesHeadline: 'Every job, quoted before we ever walk in the door.',
  finalCtaHeadline: 'Need help right now?',
  emergencyExample: 'an urgent problem',
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function serviceBlurb(label) {
  return `Fast, upfront pricing on ${label.toLowerCase()} — no surprises when we arrive.`
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const companyId = process.env.SUPABASE_COMPANY_ID
  const phone = process.argv[2] || '(000) 000-0000'

  if (!supabaseUrl || !serviceRoleKey || !companyId) {
    console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_COMPANY_ID - see .env.example.')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: company, error: companyError } = await supabase
    .from('companies')
    .select('name, trade, service_area')
    .eq('id', companyId)
    .single()
  if (companyError) throw companyError

  const { data: jobTypes, error: jobTypesError } = await supabase
    .from('job_types')
    .select('key, label')
    .eq('company_id', companyId)
    .eq('active', true)
    .order('label', { ascending: true })
  if (jobTypesError) throw jobTypesError

  if (jobTypes.length === 0) {
    console.error("This company has no active services yet - add some in the dashboard's Settings > Service Catalog page first.")
    process.exit(1)
  }

  const content = TRADE_CONTENT[company.trade] || DEFAULT_TRADE_CONTENT
  const location = company.service_area || 'your area'

  const leadFormOptions = jobTypes.map((jt) => `<option>${escapeHtml(jt.label)}</option>`).join('\n            ')

  const servicesCards = jobTypes
    .slice(0, 6)
    .map((jt, i) => {
      const icon = SERVICE_ICONS[i % SERVICE_ICONS.length]
      return `<div class="service-card reveal"><div class="service-icon">${icon}</div><h3>${escapeHtml(jt.label)}</h3><p>${escapeHtml(serviceBlurb(jt.label))}</p></div>`
    })
    .join('\n      ')

  const templatePath = path.join(__dirname, '..', 'marketing-site.html')
  let html = await readFile(templatePath, 'utf8')

  const replacements = {
    '{{COMPANY_NAME}}': escapeHtml(company.name),
    '{{LOCATION}}': escapeHtml(location),
    '{{HERO_HEADLINE}}': content.heroHeadline,
    '{{HERO_SUB}}': escapeHtml(content.heroSub),
    '{{LEAD_FORM_JOB_OPTIONS}}': leadFormOptions,
    '{{SERVICES_HEADLINE}}': escapeHtml(content.servicesHeadline),
    '{{SERVICES_CARDS}}': servicesCards,
    '{{PROFESSIONAL}}': escapeHtml(content.professional),
    '{{EMERGENCY_EXAMPLE}}': escapeHtml(content.emergencyExample),
    '{{FINAL_CTA_HEADLINE}}': escapeHtml(content.finalCtaHeadline),
    '{{PHONE}}': escapeHtml(phone),
    '{{YEAR}}': String(new Date().getFullYear()),
  }

  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value)
  }

  const outputPath = path.join(__dirname, '..', 'marketing-site.generated.html')
  await writeFile(outputPath, html, 'utf8')
  console.log(`Wrote ${outputPath} for ${company.name} (${company.trade || 'no trade set'}).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
