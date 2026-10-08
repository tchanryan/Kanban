import type { FileDelivery } from '../../contracts/platform';
function download(data: unknown, encrypted = false): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `kanban-calendar-backup-${new Date().toISOString().replaceAll(':', '-')}${encrypted ? '.encrypted' : ''}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const webFiles: FileDelivery = { download };
