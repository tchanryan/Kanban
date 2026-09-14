// In-memory drafts outlive editors. The original field value is retained until
// a successful write, so another tab's edit cannot silently become our baseline.
export interface Draft {
  text: string;
  baseValue: string;
  label: string;
  status: 'Saving…' | 'Save failed — text retained';
  error: string;
  save: (text: string, expected: string) => Promise<unknown>;
}
const drafts = new Map<string, Draft>();
const listeners = new Map<string, Set<() => void>>();
const allListeners = new Set<() => void>();
let snapshot: ReadonlyArray<readonly [string, Draft]> = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, Promise<void>>();
const suspended = new Set<string>();
const paused = (id: string) =>
  [...suspended].some((prefix) => id.startsWith(prefix));
function emit(id: string) {
  snapshot = [...drafts.entries()];
  listeners.get(id)?.forEach((fn) => fn());
  allListeners.forEach((fn) => fn());
}
export const getDraft = (id: string) => drafts.get(id);
export const getDrafts = () => snapshot;
export function subscribeDrafts(listener: () => void) {
  allListeners.add(listener);
  return () => {
    allListeners.delete(listener);
  };
}
export function subscribeDraft(id: string, listener: () => void) {
  const set = listeners.get(id) || new Set();
  set.add(listener);
  listeners.set(id, set);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(id);
  };
}
export function editDraft(
  id: string,
  text: string,
  save: Draft['save'],
  baseValue = '',
  label = id,
) {
  const old = drafts.get(id);
  drafts.set(id, {
    text,
    save,
    baseValue: old?.baseValue ?? baseValue,
    label,
    status: 'Saving…',
    error: '',
  });
  emit(id);
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => {
      void flushDraft(id).catch(() => undefined);
    }, 550),
  );
}
export function rebaseDraft(id: string, value: string, save: Draft['save']) {
  const old = drafts.get(id);
  if (old) {
    drafts.set(id, {
      ...old,
      baseValue: value,
      save,
      status: 'Saving…',
      error: '',
    });
    emit(id);
  }
}
export async function flushDraft(id: string): Promise<void> {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (paused(id)) return;
  const running = pending.get(id);
  if (running) {
    await running;
    if (drafts.has(id)) await flushDraft(id);
    return;
  }
  const draft = drafts.get(id);
  if (!draft) return;
  drafts.set(id, { ...draft, status: 'Saving…' });
  emit(id);
  // Deferring invocation also handles a save callback that throws synchronously.
  const promise = Promise.resolve()
    .then(() => draft.save(draft.text, draft.baseValue))
    .then((savedValue) => {
      const latest = drafts.get(id);
      if (latest?.text === draft.text) drafts.delete(id);
      else if (latest)
        drafts.set(id, {
          ...latest,
          baseValue: typeof savedValue === 'string' ? savedValue : draft.text,
        });
    })
    .catch((error: unknown) => {
      const latest = drafts.get(id);
      if (latest)
        drafts.set(id, {
          ...latest,
          status: 'Save failed — text retained',
          error:
            error instanceof Error
              ? error.message
              : 'Could not save. Please retry.',
        });
      window.dispatchEvent(
        new CustomEvent('save-error', {
          detail:
            'An edit could not be saved. Your text is retained. Reopen its editor or use Recovery drafts in Settings.',
        }),
      );
      throw error;
    })
    .finally(() => {
      pending.delete(id);
      emit(id);
    });
  pending.set(id, promise);
  await promise;
}
export async function flushDrafts() {
  for (const id of drafts.keys()) await flushDraft(id);
}
export function discardDrafts(prefix: string) {
  for (const id of drafts.keys())
    if (id.startsWith(prefix)) {
      clearTimeout(timers.get(id));
      timers.delete(id);
      drafts.delete(id);
      emit(id);
    }
}
// A confirmed deletion waits for writes already in flight. Failed deletion keeps
// drafts; successful deletion clears only the affected item/child drafts.
export async function withDiscardedDrafts<T>(
  prefixes: string[],
  action: () => Promise<T>,
): Promise<T> {
  prefixes.forEach((prefix) => suspended.add(prefix));
  try {
    const ids = [...drafts.keys()].filter((id) =>
      prefixes.some((p) => id.startsWith(p)),
    );
    ids.forEach((id) => {
      clearTimeout(timers.get(id));
      timers.delete(id);
    });
    await Promise.allSettled(ids.map((id) => pending.get(id)));
    const result = await action();
    prefixes.forEach(discardDrafts);
    return result;
  } finally {
    prefixes.forEach((prefix) => suspended.delete(prefix));
  }
}
if (typeof window !== 'undefined')
  window.addEventListener('beforeunload', (e) => {
    if (drafts.size) {
      e.preventDefault();
      void flushDrafts().catch(() => undefined);
    }
  });
