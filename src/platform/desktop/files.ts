import type { FileDelivery } from '../../contracts/platform';
import type { NativeTransport } from './transport';

export class DesktopFiles implements FileDelivery {
  public constructor(private readonly transport: NativeTransport) {}
  public async download(data: unknown, encrypted = false): Promise<void> {
    const saved = await this.transport.invoke('save_portable_file', {
      payload: JSON.stringify(data),
      encrypted,
    });
    if (saved !== true)
      throw Error('Export cancelled. No backup file was saved.');
  }
}
