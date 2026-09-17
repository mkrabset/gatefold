import { useEffect, useRef } from 'react'

/**
 * Shared dialog-behaviour hooks. `useAutoFocus` puts keyboard focus on a dialog's
 * primary action when it opens; `useEscapeToClose` closes the dialog when Escape is
 * pressed. Both take an `enabled` flag (default true) so dialogs that render null while
 * closed can re-arm the behaviour only while open.
 */

/**
 * Focus `ref.current` once the dialog opens, returning the ref to attach to the element.
 * The focus is deferred past the opening click/pointer gesture (a `setTimeout(0)`), whose
 * mouse-up/click would otherwise move focus back to the triggering button. Pass
 * `enabled = false` for dialogs that stay mounted but render null while closed.
 */
export function useAutoFocus<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!enabled) return
    const t = setTimeout(() => ref.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [enabled])
  return ref
}

/**
 * Close a dialog on Escape via a `window` keydown listener. Active only while `enabled`
 * is true (so a closed dialog never swallows Escape meant for canvas navigation).
 */
export function useEscapeToClose(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, enabled])
}
