import { useEffect } from 'react'

// Every modal in this app closes via a click on a backdrop or an X button
// - neither works for a keyboard-only user who can't click anything. This
// gives every modal the same Escape-to-close behavior a mouse user already
// gets for free by clicking outside it. Call with the modal's own onClose;
// pass a falsy onClose (or omit calling the hook) to skip wiring it for a
// modal that's mid-loading and has no close handler yet.
export function useEscapeToClose(onClose) {
  useEffect(() => {
    if (!onClose) return
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])
}
