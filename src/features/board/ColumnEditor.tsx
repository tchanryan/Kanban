import { useState } from 'react';
import { workspace } from '../../repositories/workspace';
import type { Column } from '../../domain/model';
import type { Run } from '../../services/operations';
import { Modal } from '../../components/ui';
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
            data-autofocus
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
