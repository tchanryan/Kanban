import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ColorPicker } from '../components/ColorPicker';
import { confirmAction } from '../services/confirm';
import { workspace } from '../repositories/workspace';
import type { Tag } from '../domain/model';
import type { Run } from '../services/operations';
export function TagManager({ run }: { run: Run }) {
  const tags = useLiveQuery(async () => workspace.tags(), []) || [];
  const [name, setName] = useState('');
  const [color, setColor] = useState<Tag['colorToken']>('violet');
  const [editId, setEditId] = useState<string | undefined>();
  return (
    <section className="settings-section">
      <h2>Tags</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await workspace.saveTag(name, color, editId);
            setName('');
            setEditId(undefined);
          });
        }}
      >
        <label className="field">
          Tag name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
          />
        </label>
        <ColorPicker value={color} onChange={setColor} />
        <button className="primary">
          {editId ? 'Save tag' : 'Create tag'}
        </button>
        {editId && (
          <button
            type="button"
            onClick={async () => {
              setName('');
              setEditId(undefined);
            }}
          >
            Cancel edit
          </button>
        )}
      </form>
      <div className="tag-management">
        {tags.map((t) => (
          <div key={t.id} className={`tag-row color-${t.colorToken}`}>
            <span>{t.name}</span>
            <button
              onClick={async () => {
                setEditId(t.id);
                setName(t.name);
                setColor(t.colorToken);
              }}
            >
              Edit
            </button>
            <button
              onClick={async () => {
                if (
                  await confirmAction(
                    `Delete tag “${t.name}”? Work items will be preserved.`,
                  )
                )
                  run(() => workspace.deleteTag(t.id));
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
