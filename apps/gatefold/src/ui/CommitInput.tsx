import { useEffect, useRef } from 'react'

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

  const commit = () => {
    const el = ref.current
    if (!el || el.readOnly) return
    committedRef.current = el.value
    onCommitRef.current(el.value)
  }

  // Flush a pending edit on unmount (only when it actually changed), so a value typed
  // but not yet blurred/Entered still commits.
  useEffect(() => {
    return () => {
      const value = currentRef.current
      if (value !== committedRef.current) onCommitRef.current(value)
    }
  }, [])

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
