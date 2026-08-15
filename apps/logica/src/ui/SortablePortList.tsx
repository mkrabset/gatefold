import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Port } from '@logica/model'

interface SortablePortListProps {
  direction: 'input' | 'output'
  ports: Port[]
  isConnected: (port: Port) => boolean
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  onReorder: (direction: 'input' | 'output', ids: string[]) => void
}

/**
 * An animated, drag-reorderable list of ports. The sortable animations are handled by
 * @dnd-kit (items slide out of the way during the drag); the final order is committed
 * to the store on drop, computed from the store's current order.
 */
export function SortablePortList({ direction, ports, isConnected, onRename, onRemove, onReorder }: SortablePortListProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const items = ports.map((p) => p.id)

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (over && active.id !== over.id) {
      const oldIndex = items.indexOf(String(active.id))
      const newIndex = items.indexOf(String(over.id))
      if (oldIndex !== -1 && newIndex !== -1) {
        onReorder(direction, arrayMove(items, oldIndex, newIndex))
      }
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {ports.map((port) => (
          <SortablePortRow
            key={port.id}
            id={port.id}
            port={port}
            connected={isConnected(port)}
            onRename={onRename}
            onRemove={onRemove}
          />
        ))}
      </SortableContext>
    </DndContext>
  )
}

function SortablePortRow({
  id,
  port,
  connected,
  onRename,
  onRemove,
}: {
  id: string
  port: Port
  connected: boolean
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
    zIndex: isDragging ? 1 : undefined,
  }
  return (
    <div ref={setNodeRef} style={style} className="port-row">
      <span ref={setActivatorNodeRef} {...attributes} {...listeners} className="drag-handle" title="Drag to reorder">
        ⣿
      </span>
      <input value={port.name} title={port.name} onChange={(e) => onRename(port.id, e.target.value)} />
      <button
        className="mini-btn"
        title={connected ? `${port.name} is connected` : `Remove ${port.name}`}
        disabled={connected}
        onClick={() => onRemove(port.id)}
      >
        −
      </button>
    </div>
  )
}
