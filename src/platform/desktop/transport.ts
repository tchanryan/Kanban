import { z } from 'zod';

export interface NativeTransport {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  listen(
    event: string,
    listener: (payload: unknown) => void,
  ): Promise<() => void>;
}
interface TauriApi {
  core: { invoke: NativeTransport['invoke'] };
  event: {
    listen(
      event: string,
      listener: (event: { payload: unknown }) => void,
    ): Promise<() => void>;
  };
}
export function tauriTransport(): NativeTransport {
  const api = (window as unknown as { __TAURI__?: TauriApi }).__TAURI__;
  if (!api)
    throw Error(
      'Native storage is unavailable. Launch the desktop application.',
    );
  return {
    invoke: async (command, args) => {
      try {
        return await api.core.invoke(command, args);
      } catch (error) {
        const parsed = z.object({ message: z.string() }).safeParse(error);
        throw Error(
          parsed.success
            ? parsed.data.message
            : 'Native operation failed. Your saved data has not been cleared.',
          { cause: error },
        );
      }
    },
    listen: (event, listener) =>
      api.event.listen(event, (value) => listener(value.payload)),
  };
}
export const versionSchema = z.object({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  generation: z.uuid(),
});
export type WorkspaceVersion = z.infer<typeof versionSchema>;
export const replySchema = z.object({
  version: versionSchema,
  value: z.unknown(),
});

export class CommitNotifications {
  private version: WorkspaceVersion | undefined;
  private readonly listeners = new Set<() => void>();
  public publish(input: unknown): void {
    const next = versionSchema.parse(input);
    if (
      this.version?.generation === next.generation &&
      this.version.revision >= next.revision
    )
      return;
    this.version = next;
    this.listeners.forEach((listener) => listener());
  }
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
