import { useRef } from 'react'

/**
 * A thin vertical divider that resizes an adjacent panel. `direction` is `1` when the
 * panel sits to the *left* of the handle (drag right grows it) and `-1` when the
 * panel is to the *right* (drag right shrinks it).
 */

interface ResizeHandleProps {
  value: number
  min: number
  max: number
  direction: 1 | -1
  onChange: (width: number) => void
}

export function ResizeHandle({ value, min, max, direction, onChange }: ResizeHandleProps) {
  const start = useRef<{ x: number; width: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    start.current = { x: e.clientX, width: value }

    // Listen on window so the drag continues even if the pointer leaves the handle.
    const onMove = (ev: PointerEvent) => {
      if (!start.current) return
      const dx = ev.clientX - start.current.x
      const next = start.current.width + direction * dx
      onChange(Math.min(max, Math.max(min, next)))
    }
    const onUp = () => {
      start.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
    }

    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return <div className="resize-handle" onPointerDown={onPointerDown} />
}
