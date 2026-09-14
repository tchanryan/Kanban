import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  pointerWithin,
  closestCorners,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Settings2 } from 'lucide-react';
import { workspace } from '../repositories/workspace';
import { overdue, localDate, type Column, type Item } from '../domain/model';
import { Modal } from '../components/ui';
import { useToday } from '../components/useToday';
import { addLocalDays } from '../domain/model';
export type Run = (fn: () => Promise<unknown>, message?: string) => void;
const boardCollision: CollisionDetection = (args) => {
  const columnDrag = args.active.data.current?.type === 'column';
  const droppableContainers = args.droppableContainers.filter(
    (container) =>
      container.id !== args.active.id &&
      (!columnDrag || container.data.current?.type === 'column'),
  );
  const candidates = { ...args, droppableContainers };
  if (columnDrag) return closestCorners(candidates);
  if (args.pointerCoordinates) {
    const hits = pointerWithin(candidates);
    const cardHits = hits.filter(
      (hit) =>
        droppableContainers.find((c) => c.id === hit.id)?.data.current?.type ===
        'item',
    );
    return cardHits.length ? cardHits : hits;
  }
  return closestCorners(candidates);
};
export function Card({
  item,
  inColumn,
  columns,
  onOpen,
  move,
  run,
}: {
  item: Item;
  inColumn: Item[];
  columns: Column[];
  onOpen: (item: Item) => void;
  move: (item: Item, columnId: string, before?: string | null) => void;
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
  const index = inColumn.findIndex((x) => x.id === item.id);
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
            value={children.filter((x) => x.completedAt).length}
            max={children.length || 1}
          />
          <small>
            {children.filter((x) => x.completedAt).length}/{children.length}{' '}
            tasks
          </small>
        </div>
      )}
      <details className="card-actions">
        <summary>Move to…</summary>
        <select
          aria-label={`Move ${item.title} to`}
          value={item.columnId}
          onChange={(e) => move(item, e.target.value)}
        >
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="button-row">
          <button
            disabled={index <= 0}
            onClick={() =>
              run(() =>
                workspace.move(item.id, item.columnId, inColumn[index - 1]!.id),
              )
            }
          >
            Move up
          </button>
          <button
            disabled={index === inColumn.length - 1}
            onClick={() =>
              run(() =>
                workspace.move(
                  item.id,
                  item.columnId,
                  inColumn[index + 2]?.id || null,
                ),
              )
            }
          >
            Move down
          </button>
        </div>
      </details>
    </article>
  );
}
function ColumnView({
  column,
  columns,
  items,
  onOpen,
  onEdit,
  move,
  run,
}: {
  column: Column;
  columns: Column[];
  items: Item[];
  onOpen: (item: Item) => void;
  onEdit: () => void;
  move: (item: Item, columnId: string, before?: string | null) => void;
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
              inColumn={items}
              {...{ item, columns, onOpen, move, run }}
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
export function ColumnEditor({
  boardId,
  column,
  columns,
  onClose,
  run,
}: {
  boardId: string;
  column: Column | null;
  columns: Column[];
  onClose: () => void;
  run: Run;
}) {
  const [name, setName] = useState(column?.name || '');
  const [isDefault, setDefault] = useState(
    column?.isDefaultNewItemColumn || !columns.length,
  );
  const [starts, setStarts] = useState(column?.startsWorkOnFirstEntry || false);
  const [completes, setCompletes] = useState(
    column?.completesItemOnEntry || false,
  );
  const [deleting, setDeleting] = useState(false);
  const [destination, setDestination] = useState('');
  const index = columns.findIndex((x) => x.id === column?.id);
  return (
    <Modal title={column ? 'Configure column' : 'New column'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await workspace.saveColumn(
              boardId,
              {
                name,
                isDefaultNewItemColumn: isDefault,
                startsWorkOnFirstEntry: starts,
                completesItemOnEntry: completes,
              },
              column?.id,
            );
            onClose();
          });
        }}
      >
        <label className="field">
          Column name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setDefault(e.target.checked)}
          />
          Default for new items
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={starts}
            onChange={(e) => setStarts(e.target.checked)}
          />
          Start work on first entry
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={completes}
            onChange={(e) => setCompletes(e.target.checked)}
          />
          Complete items on entry
        </label>
        <p className="muted">
          Behaviours apply to future moves. Changing flags preserves existing
          timestamps and history.
        </p>
        {completes &&
          columns.some(
            (c) => c.id !== column?.id && c.completesItemOnEntry,
          ) && (
            <p>
              The existing completion column will lose its completion
              designation.
            </p>
          )}
        <button className="primary">
          {column ? 'Save column' : 'Create column'}
        </button>
      </form>
      {column && (
        <>
          <hr />
          <div className="button-row">
            <button
              disabled={index === 0}
              onClick={() =>
                run(() =>
                  workspace.reorderColumn(column.id, columns[index - 1]!.id),
                )
              }
            >
              Move left
            </button>
            <button
              disabled={index === columns.length - 1}
              onClick={() =>
                run(() =>
                  workspace.reorderColumn(
                    column.id,
                    columns[index + 2]?.id || null,
                  ),
                )
              }
            >
              Move right
            </button>
            <button className="danger" onClick={() => setDeleting(true)}>
              Delete column…
            </button>
          </div>
          {deleting && (
            <div className="warning">
              <p>
                Delete “{column.name}”? All cards, including archived cards,
                will move to the selected column and adopt its workflow
                behaviour. Completion history is preserved. Projects may
                complete without changing child tasks.
              </p>
              <label className="field">
                Destination / replacement default
                <select
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                >
                  <option value="">Select destination</option>
                  {columns
                    .filter((c) => c.id !== column.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="danger"
                onClick={() =>
                  run(async () => {
                    await workspace.deleteColumn(
                      column.id,
                      destination || null,
                      true,
                    );
                    onClose();
                  }, 'Column deleted')
                }
              >
                Confirm delete column
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
export function BoardView({
  boardId,
  onOpen,
  run,
}: {
  boardId: string;
  onOpen: (item: Item) => void;
  run: Run;
}) {
  const today = useToday();
  const cols =
    useLiveQuery(async () => workspace.columns(boardId), [boardId]) || [];
  const items =
    useLiveQuery(async () => workspace.items(boardId), [boardId]) || [];
  const [editing, setEditing] = useState<Column | null | undefined>();
  const [priority, setPriority] = useState('');
  const [kind, setKind] = useState('');
  const [due, setDue] = useState('');
  const [tag, setTag] = useState('');
  const tags = useLiveQuery(async () => workspace.tags(), []) || [];
  const tagged = useLiveQuery(async () => {
    if (!tag) return null;
    return new Set(
      (
        await Promise.all(
          items.map(async (i) =>
            (await workspace.itemTags(i.id)).some((r) => r.tagId === tag)
              ? i.id
              : null,
          ),
        )
      ).filter(Boolean),
    );
  }, [tag, items]);
  const [drag, setDrag] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const move = (item: Item, columnId: string, before: string | null = null) =>
    run(async () => {
      const col = cols.find((c) => c.id === columnId);
      let confirmed = false;
      if (
        item.kind === 'project' &&
        col?.completesItemOnEntry &&
        !item.completedAt
      ) {
        const n = (await workspace.children(item.id)).filter(
          (x) => !x.completedAt,
        ).length;
        if (n) {
          confirmed = window.confirm(
            `Complete “${item.title}” with ${n} incomplete child tasks? Child tasks will remain unchanged.`,
          );
          if (!confirmed) return;
        }
      }
      await workspace.move(item.id, columnId, before, confirmed);
    });
  const onDragEnd = (e: DragEndEvent) => {
    setDrag('');
    if (!e.over || e.active.id === e.over.id) return;
    const source = e.active.data.current;
    const target = e.over.data.current;
    if (source?.type === 'column' && target?.type === 'column') {
      const from = cols.findIndex((c) => c.id === e.active.id);
      const to = cols.findIndex((c) => c.id === e.over!.id);
      run(() =>
        workspace.reorderColumn(
          String(e.active.id),
          from < to ? cols[to + 1]?.id || null : String(e.over!.id),
        ),
      );
    }
    if (source?.type === 'item') {
      const item = source.item as Item;
      const destination =
        target?.type === 'item'
          ? (target.item as Item).columnId
          : String(e.over.id);
      const siblings = items.filter((x) => x.columnId === destination);
      const from = siblings.findIndex((x) => x.id === item.id),
        to = siblings.findIndex((x) => x.id === e.over!.id);
      const before =
        target?.type === 'item'
          ? from >= 0 && from < to
            ? siblings[to + 1]?.id || null
            : String(e.over.id)
          : null;
      move(item, destination, before);
    }
  };
  const filtered = items.filter(
    (i) =>
      (!priority || i.priority === priority) &&
      (!kind || i.kind === kind) &&
      (!due ||
        (due === 'overdue'
          ? overdue(i, today)
          : !!i.dueDate &&
            !i.completedAt &&
            i.dueDate >= today &&
            i.dueDate <= addLocalDays(today, 2))) &&
      (!tag || tagged?.has(i.id)),
  );
  return (
    <div className="board-area">
      <div className="board-toolbar">
        <div className="button-row">
          <select
            aria-label="Filter priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="">All priorities</option>
            {['low', 'medium', 'high'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select
            aria-label="Filter type"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">All types</option>
            <option>task</option>
            <option>project</option>
          </select>
          <select
            aria-label="Filter due dates"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          >
            <option value="">All dates</option>
            <option value="overdue">Overdue</option>
            <option value="soon">Due soon</option>
          </select>
          <select
            aria-label="Filter tag"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          >
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <button onClick={() => setEditing(null)}>
          <Plus size={16} />
          Column
        </button>
      </div>
      {!cols.length ? (
        <div className="empty-state">
          <div className="empty-mark">▥</div>
          <h2>Your workflow starts here</h2>
          <p>
            No columns yet. Create your first workflow column to start tracking
            work.
          </p>
          <button className="primary" onClick={() => setEditing(null)}>
            + Column
          </button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={boardCollision}
          onDragStart={(e) =>
            setDrag(
              e.active.data.current?.item?.title ||
                e.active.data.current?.column?.name ||
                '',
            )
          }
          onDragCancel={() => setDrag('')}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={cols.map((c) => c.id)}
            strategy={horizontalListSortingStrategy}
          >
            <div className="board">
              {cols.map((column) => (
                <ColumnView
                  key={column.id}
                  column={column}
                  columns={cols}
                  items={filtered.filter((i) => i.columnId === column.id)}
                  onOpen={onOpen}
                  onEdit={() => setEditing(column)}
                  move={move}
                  run={run}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {drag ? <div className="drag-overlay">{drag}</div> : null}
          </DragOverlay>
        </DndContext>
      )}
      {editing !== undefined && (
        <ColumnEditor
          boardId={boardId}
          column={editing}
          columns={cols}
          onClose={() => setEditing(undefined)}
          run={run}
        />
      )}
    </div>
  );
}
