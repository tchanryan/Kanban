import { useLiveQuery } from 'dexie-react-hooks';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2 } from 'lucide-react';
import { workspace } from '../../repositories/workspace';
import { overdue, localDate, type Item, type Tag } from '../../domain/model';
import type { Run } from '../../services/operations';
import { workItemActions } from '../../services/workItemActions';
export function Card({
  item,
  tags,
  onOpen,
  run,
}: {
  item: Item;
  tags: Tag[];
  onOpen: (item: Item) => void;
  run: Run;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: item.id, data: { type: 'item', item } });
  const children =
    useLiveQuery(
      async () =>
        item.kind === 'project'
          ? workspace.children(item.id)
          : Promise.resolve([]),
      [item.id, item.kind],
    ) || [];
  const completedCount = children.filter((child) => child.completedAt).length;
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`card ${item.kind} color-${item.projectColorToken || 'violet'}`}
    >
      <div className="card-meta">
        <span>{item.kind}</span>
        <span className={`priority ${item.priority}`}>{item.priority}</span>
        {overdue(item) && <span className="overdue">Overdue</span>}
        <button
          className="drag-handle"
          aria-label={`Drag ${item.title}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
        <button
          className="tile-delete"
          aria-label={`Delete ${item.kind} ${item.title}`}
          title={`Delete ${item.kind}`}
          onClick={() => run(() => workItemActions.deleteFromTile(item))}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <button className="card-title" onClick={() => onOpen(item)}>
        {item.title}
      </button>
      <p className="card-dates">
        {item.plannedStartDate ||
          (item.firstStartedAt
            ? localDate(item.firstStartedAt)
            : 'No start')}{' '}
        <span>→</span> {item.dueDate || 'No due date'}
      </p>
      {item.kind === 'project' && (
        <div className="progress">
          <progress
            aria-label={`${item.title} task completion`}
            value={completedCount}
            max={children.length || 1}
          />
          <small>
            {completedCount}/{children.length} tasks
          </small>
        </div>
      )}
      {tags.length > 0 && (
        <div className="tag-chips card-tags" aria-label="Tags">
          {tags.map((tag) => (
            <span key={tag.id} className={`tag-chip color-${tag.colorToken}`}>
              <span className="tag-dot" />
              {tag.name}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
