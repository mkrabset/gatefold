import { useRef } from 'react'

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
