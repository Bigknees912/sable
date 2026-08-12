import { useState, useMemo } from 'react'
import { ArrowLeft, Check } from 'lucide-react'
import { LIGHT, GlobalStyle } from '../theme'

// Ported from app-demo.jsx's LIGHT palette and auth-screen building blocks,
// kept visually identical. Dark mode / theme switching isn't part of the
// auth flow, so only LIGHT is needed here. LIGHT/GlobalStyle now live in
// ../theme (shared with the dashboard screens) and are re-exported so
// existing imports from './ui' keep working.
export { LIGHT, GlobalStyle }

export function GoogleG({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h11.8c-.5 2.7-2.1 5-4.4 6.6v5.4h7.1c4.2-3.9 6.6-9.6 6.6-16.5z"/>
      <path fill="#34A853" d="M24 46c6 0 10.9-2 14.5-5.4l-7.1-5.4c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.6C8.1 41 15.4 46 24 46z"/>
      <path fill="#FBBC05" d="M11.8 28.3c-.4-1.3-.7-2.7-.7-4.3s.3-3 .7-4.3v-5.6H4.5C3 17.1 2.2 20.4 2.2 24s.8 6.9 2.3 9.9l7-5.6z"/>
      <path fill="#EA4335" d="M24 10.7c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C34.9 4.2 30 2 24 2 15.4 2 8.1 7 4.5 14.1l7 5.6c1.7-5.2 6.5-9 12.5-9z"/>
    </svg>
  )
}

export function AuthShell({ children, maxWidth = 380 }) {
  return (
    <div style={{ minHeight: '100vh', background: LIGHT.bg, padding: '50px 20px' }}>
      <GlobalStyle />
      <div style={{ maxWidth, margin: '0 auto' }}>{children}</div>
    </div>
  )
}

export function BackRow({ onBack }) {
  return (
    <button className="tap" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, color: LIGHT.sub, fontSize: 13, fontWeight: 600, marginBottom: 20, padding: 0 }}>
      <ArrowLeft size={15} /> Back
    </button>
  )
}

// A real <label> when htmlFor is given (screen readers announce it as the
// field's name, and clicking the text focuses the input) - falls back to a
// plain <div> for the handful of callers that use it as a section caption
// with no single associated input.
export function FieldLabel({ children, htmlFor }) {
  const style = { fontSize: 11.5, fontWeight: 700, color: LIGHT.sub, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6, display: 'block' }
  return htmlFor ? <label htmlFor={htmlFor} style={style}>{children}</label> : <div style={style}>{children}</div>
}

export function TextInput({ id, value, onChange, placeholder, type = 'text', autoComplete }) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      onChange={(e) => onChange && onChange(e.target.value)}
      style={{ width: '100%', background: '#F5F5F7', border: `1px solid ${LIGHT.border}`, borderRadius: 10, fontSize: 14, padding: '11px 13px', marginBottom: 14, color: LIGHT.ink }}
    />
  )
}

// role="group" + aria-label so a screen reader announces this as one
// choice ("Trade, group") rather than a run of unrelated buttons; each
// chip is a real <button> with aria-pressed so its selected state is
// announced too, not just implied by color.
export function ChipRow({ options, value, onChange, groupLabel }) {
  return (
    <div role="group" aria-label={groupLabel} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
      {options.map((o) => {
        const active = o === value
        return (
          <button
            key={o}
            type="button"
            className="tap"
            aria-pressed={active}
            onClick={() => onChange(o)}
            style={{ padding: '9px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, border: `1.5px solid ${active ? LIGHT.accent : LIGHT.border}`, background: active ? LIGHT.accentSoft : LIGHT.card, color: active ? LIGHT.accent : LIGHT.ink }}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

// Plain checkbox + label, used wherever SMS consent (or any other
// yes/no attestation) needs capturing - see ../lib/smsConsent.js. Default-
// unchecked by design: consent capture must be an affirmative action, a
// pre-checked box isn't valid consent under TCPA/CASL guidance.
//
// A REAL <input type="checkbox"> under the hood (visually hidden, not
// display:none - display:none pulls it out of the accessibility tree in
// some browsers) rather than a div faking checked/unchecked with a class:
// keyboard Space-to-toggle and the screen-reader "checked"/"not checked"
// announcement come for free from the native element instead of needing
// hand-rolled aria-checked/onKeyDown.
let checkboxIdSeq = 0
export function Checkbox({ checked, onChange, label, hint }) {
  const id = useMemo(() => `checkbox-${++checkboxIdSeq}`, [])
  return (
    <label htmlFor={id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14, cursor: 'pointer' }}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
      <div aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${checked ? LIGHT.accent : LIGHT.border}`, background: checked ? LIGHT.accent : '#F5F5F7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
        {checked && <Check size={12} color="#fff" strokeWidth={3} />}
      </div>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: LIGHT.ink, lineHeight: 1.4 }}>{label}</div>
        {hint && <div style={{ fontSize: 10.5, color: LIGHT.sub, lineHeight: 1.4, marginTop: 2 }}>{hint}</div>}
      </div>
    </label>
  )
}

export function PrimaryButton({ children, onClick, disabled, style }) {
  return (
    <button className="tap" onClick={onClick} disabled={disabled} style={{ width: '100%', textAlign: 'center', background: LIGHT.ink, color: '#fff', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 14, fontWeight: 600, marginTop: 6, ...style }}>
      {children}
    </button>
  )
}

export function ErrorText({ children }) {
  if (!children) return null
  return <div style={{ color: LIGHT.alert, fontSize: 12.5, marginBottom: 10 }}>{children}</div>
}

// Small helper so every screen handles the signUp()-returned-no-session
// case (email confirmation required) the same way.
export function usePendingAction() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function run(fn) {
    setError('')
    setLoading(true)
    try {
      await fn()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }
  return { loading, error, run, setError }
}
