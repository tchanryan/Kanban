import { useState } from 'react';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Settings2, Plus } from 'lucide-react';
import { workspace } from '../../repositories/workspace';
import type { Column, Item, Tag } from '../../domain/model';
import type { Run } from '../../services/operations';
import { Card } from './Card';
export function ColumnView({
  column,
  itemTags,
  items,
  onOpen,
  onEdit,
  run,
}: {
  column: Column;
  itemTags: Record<string, Tag[]>;
  items: Item[];
  onOpen: (item: Item) => void;
  onEdit: () => void;
  run: Run;
}) {
  const [title, setTitle] = useState('');
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: column.id, data: { type: 'column', column } });
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="column"
      aria-label={`${column.name} column`}
    >
      <header className="column-header">
        <button
          className="drag-handle"
          aria-label={`Drag column ${column.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </button>
        <h2>{column.name}</h2>
        <span className="count">{items.length}</span>
        <button aria-label={`Configure ${column.name}`} onClick={onEdit}>
          <Settings2 size={16} />
        </button>
      </header>
      <div className="column-flags">
        {column.isDefaultNewItemColumn && <span>Default</span>}
        {column.startsWorkOnFirstEntry && <span>Starts work</span>}
        {column.completesItemOnEntry && <span>Completion</span>}
      </div>
      <SortableContext
        items={items.map((x) => x.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="card-list">
          {items.map((item) => (
            <Card
              key={item.id}
              tags={itemTags[item.id] || []}
              {...{ item, onOpen, run }}
            />
          ))}
          {!items.length && (
            <p className="column-empty">Room for what’s next.</p>
          )}
        </div>
      </SortableContext>
      <form
        className="quick-add"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await workspace.create(column.boardId, title, 'task', column.id);
            setTitle('');
          });
        }}
      >
        <input
          aria-label={`New task in ${column.name}`}
          placeholder="Add a task…"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          aria-label={`Add task to ${column.name}`}
          disabled={!title.trim()}
        >
          <Plus size={16} />
        </button>
      </form>
    </section>
  );
}
