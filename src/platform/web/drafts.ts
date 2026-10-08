import type { DraftCoordinator } from '../../contracts/platform';
import { flushDrafts, withDiscardedDrafts } from '../../services/drafts';
export const webDrafts: DraftCoordinator = {
  flush: flushDrafts,
  withDiscarded: withDiscardedDrafts,
};
