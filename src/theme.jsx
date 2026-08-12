// Shared with src/auth/ui.jsx (which re-exports these) so the auth screens
// and the dashboard screens use one definition instead of two copies.
//
// sub/accent/success/alert/info were all measured against WCAG AA's 4.5:1
// text-contrast minimum (accessibility audit) and every one of them failed
// against at least one background it's actually used on:
//   sub     on card (#FFF):        3.94:1  (needs 4.5)
//   accent  on accentSoft:         2.49:1  (badge/label text - way under)
//   success on successSoft:        4.28:1  (just under)
//   alert   on alertSoft:          3.90:1
//   info    on infoSoft:           3.78:1
// Each value below is darkened just enough to clear 4.5:1 against BOTH its
// own *Soft background and plain white/card, while keeping the same hue so
// the palette still reads as the same brand colors. *Soft background tints
// and icon-only fills are untouched (icons only need the looser 3:1
// non-text ratio, which the originals already met or nearly met).
export const LIGHT = {
  bg: '#F5F4ED', card: '#FFFFFF', ink: '#1F1E1D', sub: '#6B6964', border: '#E5E1D8',
  accent: '#94513A', accentSoft: '#F3E3DB', success: '#376E53', successSoft: '#E4EEE7',
  alert: '#A24133', alertSoft: '#F5E2DE', info: '#4D6877', infoSoft: '#E4EBEE',
}

export function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; }
      .tap { cursor: pointer; transition: opacity 0.12s ease, transform 0.12s ease; border: none; background: none; }
      .tap:active { transform: scale(0.98); }
      .tap:disabled { opacity: 0.6; cursor: default; }
      input::placeholder, textarea::placeholder { color: #6B6964; }
      input, select, textarea { font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; }
      body { margin: 0; background: ${LIGHT.bg}; }

      /* Visible keyboard focus everywhere - the default outline some of
         these elements would otherwise get is either invisible (buttons
         with no border) or suppressed by the browser's own mouse-vs-
         keyboard heuristic. :focus-visible (not :focus) means this only
         shows for keyboard/switch-device focus, never on a mouse click, so
         it doesn't add a ring mouse users didn't ask for. */
      a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible,
      textarea:focus-visible, [tabindex]:focus-visible, .tap:focus-visible {
        outline: 2px solid ${LIGHT.info};
        outline-offset: 2px;
        border-radius: 4px;
      }

      /* Pulsing dot/badge for the live-location indicator and map pins. */
      @keyframes pulseLoc { 0% { box-shadow: 0 0 0 0 rgba(61,122,92,0.5); } 70% { box-shadow: 0 0 0 8px rgba(61,122,92,0); } 100% { box-shadow: 0 0 0 0 rgba(61,122,92,0); } }
      .pulse-loc { animation: pulseLoc 1.8s cubic-bezier(0.22,1,0.36,1) infinite; }
      @media (prefers-reduced-motion: reduce) {
        .tap:active { transform: none; }
        .pulse-loc { animation: none; }
      }
    `}</style>
  )
}
