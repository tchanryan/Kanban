import { desktopDrafts } from './runtime';
export const recoveryDescription =
  'Recovery copies are saved separately from your work. Recovered text is never applied automatically. Review it in its editor, or copy it here before discarding.';
export const getDraft = (id: string) => desktopDrafts.get(id);
export const getDrafts = desktopDrafts.all;
export const subscribeDrafts = desktopDrafts.subscribe;
export const subscribeDraft = (_id: string, listener: () => void) =>
  desktopDrafts.subscribe(listener);
export function editDraft(
  id: string,
  text: string,
  _save: unknown,
  baseValue = '',
  label = id,
  generation?: string,
): void {
  desktopDrafts.edit(id, text, baseValue, label, generation);
}
export function rebaseDraft(
  id: string,
  value: string,
  _save: unknown,
  generation?: string,
): void {
  desktopDrafts.rebase(id, value, generation);
}
export const flushDraft = (id: string) => desktopDrafts.flush(id);
export const flushDrafts = () => desktopDrafts.flushAll();
export const discardDrafts = async (id: string): Promise<void> => {
  try {
    await desktopDrafts.discard(id);
  } catch (error) {
    window.dispatchEvent(
      new CustomEvent('save-error', {
        detail:
          error instanceof Error
            ? error.message
            : 'Could not discard recovery text. Please retry.',
      }),
    );
  }
};
export const withDiscardedDrafts = <T>(
  ids: string[],
  action: () => Promise<T>,
) => desktopDrafts.withDiscarded(ids, action);
