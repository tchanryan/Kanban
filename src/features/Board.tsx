import { useState, type CSSProperties } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Plus, ZoomIn, ZoomOut } from 'lucide-react';
import { workspace } from '../repositories/workspace';
import type { Column, Item } from '../domain/model';
import { useToday } from '../components/useToday';
import type { Run } from '../services/operations';
import { workItemActions } from '../services/workItemActions';
import { ColumnEditor } from './board/ColumnEditor';
import { ColumnView } from './board/ColumnView';
import { boardCollision } from './board/collision';
import { indexItemTags, filterBoardItems } from './board/selectors';
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
  const [zoom, setZoom] = useState(100);
  const [priority, setPriority] = useState('');
  const [kind, setKind] = useState('');
  const [due, setDue] = useState('');
  const [tag, setTag] = useState('');
  const tags = useLiveQuery(async () => workspace.tags(), []) || [];
  const relations =
    useLiveQuery(() => workspace.boardTagRelations(boardId), [boardId]) || [];
  const itemTags = indexItemTags(tags, relations);
  const [drag, setDrag] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const move = (item: Item, columnId: string, before: string | null = null) =>
    run(() => workItemActions.move(item, columnId, before));
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
  const filtered = filterBoardItems(
    items,
    { priority, kind, due, tag },
    itemTags,
    today,
  );
  return (
    <div
      className="board-area"
      style={{ '--board-zoom': zoom / 100 } as CSSProperties}
    >
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
        <div className="board-controls">
          <div className="board-zoom" role="group" aria-label="Board zoom">
            <button
              aria-label="Zoom out board"
              title="Zoom out to fit more columns"
              disabled={zoom === 50}
              onClick={() => setZoom((value) => Math.max(50, value - 10))}
            >
              <ZoomOut size={16} />
            </button>
            <button
              className="zoom-level"
              aria-label={`Reset board zoom (${zoom}%)`}
              title="Reset zoom to 100%"
              onClick={() => setZoom(100)}
            >
              {zoom}%
            </button>
            <button
              aria-label="Zoom in board"
              title="Zoom in for larger cards"
              disabled={zoom === 150}
              onClick={() => setZoom((value) => Math.min(150, value + 10))}
            >
              <ZoomIn size={16} />
            </button>
          </div>
          <button onClick={() => setEditing(null)}>
            <Plus size={16} />
            Column
          </button>
        </div>
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
                  itemTags={itemTags}
                  items={filtered.filter((i) => i.columnId === column.id)}
                  onOpen={onOpen}
                  onEdit={() => setEditing(column)}
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
