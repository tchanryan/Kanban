import { useState } from 'react';
import type { Run } from '../services/operations';

/** Keep the requested value visible until the saved value reaches the view. */
export function AsyncCheckbox({
  checked,
  save,
  run,
}: {
  checked: boolean;
  save: (checked: boolean) => Promise<unknown>;
  run: Run;
}) {
  const [pending, setPending] = useState<boolean | null>(null);
  // A completed write can precede the live query notification. Reconcile with
  // the observed value, rather than clearing the optimistic value on resolve.
  if (pending !== null && pending === checked) setPending(null);

  return (
    <input
      type="checkbox"
      checked={pending ?? checked}
      disabled={pending !== null}
      onChange={(event) => {
        const value = event.target.checked;
        setPending(value);
        run(async () => {
          try {
            await save(value);
          } catch (error) {
            setPending(null);
            throw error;
          }
        });
      }}
    />
  );
}
