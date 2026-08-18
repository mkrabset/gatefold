import { useRef } from 'react'

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
 */
export function CommitInput({ defaultValue, onCommit, type = 'text', min, max, step, readOnly, title }: CommitInputProps) {
  const ref = useRef<HTMLInputElement>(null)

  const commit = () => {
    const el = ref.current
    if (!el || el.readOnly) return
    onCommit(el.value)
  }

  return (
    <input
      ref={ref}
      type={type}
      defaultValue={defaultValue}
      min={min}
      max={max}
      step={step}
      readOnly={readOnly}
      title={title}
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
