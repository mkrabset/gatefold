import { useCallback, useEffect, useRef } from 'react'

interface CommitInputProps {
  defaultValue?: string | number
  onCommit: (value: string) => void
  type?: 'text' | 'number'
  min?: number
  max?: number
  step?: number
  readOnly?: boolean
  title?: string
}

/**
 * An input that commits its raw value on Enter or blur, via `onCommit`. Callers decide
 * whether to trim/clamp/interpret the value. When `readOnly`, no commit is fired.
 *
 * Commits are also fired on the browser's native `change` event, which is when the
 * browser "commits" a value: immediately on each inc/dec spinner click (a `<input
 * type="number">` click), and on blur. React's `onChange` maps to the `input` event,
 * which fires per keystroke *and* per spinner click, so it cannot distinguish the two;
 * listening for `change` instead makes spinner clicks take effect immediately while a
 * typed value still applies on blur (including when focus leaves via a click on the
 * canvas, which blurs the field).
 *
 * An in-progress edit is also flushed when the input unmounts without a blur (e.g. the
 * sidebar's selection is cleared by a canvas click before the field loses focus), so a
 * typed-but-not-committed value is never silently lost.
 */
export function CommitInput({ defaultValue, onCommit, type = 'text', min, max, step, readOnly, title }: CommitInputProps) {
  const ref = useRef<HTMLInputElement>(null)
  const initial = String(defaultValue)
  const currentRef = useRef(initial)
  const committedRef = useRef(initial)
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  const commit = useCallback(() => {
    const el = ref.current
    if (!el || el.readOnly) return
    if (el.value === committedRef.current) return
    committedRef.current = el.value
    onCommitRef.current(el.value)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('change', commit)
    return () => {
      el.removeEventListener('change', commit)
      // Flush a pending edit on unmount (only when it actually changed), so a value typed
      // but not yet blurred/Entered still commits.
      if (currentRef.current !== committedRef.current) onCommitRef.current(currentRef.current)
    }
  }, [commit])

  return (
    <input
      ref={ref}
      type={type}
      defaultValue={initial}
      min={min}
      max={max}
      step={step}
      readOnly={readOnly}
      title={title}
      onChange={(e) => {
        currentRef.current = e.target.value
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
          e.currentTarget.blur()
        }
      }}
      onBlur={commit}
    />
  )
}
