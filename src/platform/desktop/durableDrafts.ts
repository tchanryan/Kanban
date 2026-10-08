import { z } from 'zod';
import {
  CommitNotifications,
  replySchema,
  type NativeTransport,
} from './transport';

export const draftRecordSchema = z.object({
  id: z.string(),
  token: z.uuid(),
  entityId: z.string(),
  field: z.enum(['title', 'description', 'scratch']),
  text: z.string().max(1000000),
  expected: z.string().max(1000000),
  generation: z.uuid(),
  label: z.string().max(200),
});
export type DraftRecord = z.infer<typeof draftRecordSchema>;
export interface DesktopDraft {
  text: string;
  baseValue: string;
  label: string;
  status: 'Saving…' | 'Save failed — text retained';
  error: string;
  recoveryState: string;
  record: DraftRecord;
  recovered: boolean;
  durableToken: string | undefined;
}

/** Serializes journal and canonical writes so late acknowledgements cannot erase newer typing. */
export class DurableDrafts {
  private readonly drafts = new Map<string, DesktopDraft>();
  private readonly listeners = new Set<() => void>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly suspended = new Set<string>();
  private snapshot: ReadonlyArray<readonly [string, DesktopDraft]> = [];
  private queue: Promise<unknown> = Promise.resolve();
  public constructor(
    private readonly transport: NativeTransport,
    private readonly notifications: CommitNotifications,
  ) {}
  private schedule<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private emit(): void {
    this.snapshot = [...this.drafts.entries()];
    this.listeners.forEach((listener) => listener());
  }
  public get(id: string): DesktopDraft | undefined {
    return this.drafts.get(id);
  }
  public all = (): ReadonlyArray<readonly [string, DesktopDraft]> =>
    this.snapshot;
  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  public async load(): Promise<void> {
    const records = z
      .array(draftRecordSchema)
      .parse(await this.transport.invoke('draft_list'));
    for (const record of records)
      this.drafts.set(record.id, {
        text: record.text,
        baseValue: record.expected,
        label: record.label,
        record,
        recovered: true,
        durableToken: record.token,
        recoveryState: 'Recovery copy saved',
        status: 'Save failed — text retained',
        error:
          'Recovered after restart. Review the saved version before retrying or keeping this text.',
      });
    this.emit();
  }
  public edit(
    id: string,
    text: string,
    baseValue: string,
    label: string,
    generation?: string,
  ): void {
    if ([...this.suspended].some((prefix) => id.startsWith(prefix))) return;
    const old = this.drafts.get(id);
    const field =
      id === 'scratchpad-global'
        ? 'scratch'
        : id.endsWith('-title')
          ? 'title'
          : 'description';
    const record = draftRecordSchema.parse({
      id,
      token: crypto.randomUUID(),
      field,
      entityId:
        field === 'scratch' ? 'global' : id.slice(0, -(field.length + 1)),
      text,
      expected: old?.baseValue ?? baseValue,
      generation: old?.record.generation ?? generation,
      label,
    });
    this.drafts.set(id, {
      text,
      baseValue: record.expected,
      label,
      record,
      recovered: false,
      durableToken: undefined,
      status: 'Saving…',
      error: '',
      recoveryState: 'Saving recovery copy…',
    });
    this.emit();
    void this.schedule(() => this.stage(id)).catch((error: unknown) =>
      this.fail(id, error),
    );
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => {
        void this.flush(id).catch(() => undefined);
      }, 550),
    );
  }
  public rebase(id: string, value: string, generation?: string): void {
    const old = this.drafts.get(id);
    if (!old) return;
    const record = {
      ...old.record,
      expected: value,
      generation: generation ?? old.record.generation,
      token: crypto.randomUUID(),
    };
    this.drafts.set(id, {
      ...old,
      record,
      baseValue: value,
      recovered: false,
      durableToken: undefined,
    });
    this.emit();
  }
  private fail(id: string, error: unknown): void {
    const latest = this.drafts.get(id);
    if (latest)
      this.drafts.set(id, {
        ...latest,
        status: 'Save failed — text retained',
        error:
          error instanceof Error
            ? error.message
            : 'Native save failed. Retry or copy your text.',
      });
    this.emit();
  }
  private async stage(id: string): Promise<void> {
    const draft = this.drafts.get(id);
    if (!draft || draft.durableToken === draft.record.token) return;
    const token = await this.transport.invoke('draft_stage', {
      record: draft.record,
    });
    if (token !== draft.record.token)
      throw Error('Recovery acknowledgement did not match this edit');
    const latest = this.drafts.get(id);
    if (latest?.record.token === token) {
      this.drafts.set(id, {
        ...latest,
        durableToken: token,
        recoveryState: 'Recovery copy saved',
      });
      this.emit();
    }
  }
  public flush(id: string): Promise<void> {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    return this.schedule(async () => {
      if ([...this.suspended].some((prefix) => id.startsWith(prefix))) return;
      const draft = this.drafts.get(id);
      if (!draft) return;
      if (draft.recovered)
        throw Error(
          'Review recovered drafts in Settings or their editor before saving.',
        );
      try {
        await this.stage(id);
        // stage can overlap typing, but not another journal write. Commit exactly its acknowledged token.
        const reply = replySchema.parse(
          await this.transport.invoke('draft_commit', {
            id,
            token: draft.record.token,
          }),
        );
        this.notifications.publish(reply.version);
        const latest = this.drafts.get(id);
        if (latest?.record.token === draft.record.token) this.drafts.delete(id);
        else if (latest) {
          const title = z.object({ title: z.string() }).safeParse(reply.value);
          const saved =
            draft.record.field === 'title' && title.success
              ? title.data.title
              : draft.text;
          this.drafts.set(id, {
            ...latest,
            baseValue: saved,
            record: { ...latest.record, expected: saved },
            durableToken: undefined,
          });
        }
        this.emit();
      } catch (error) {
        this.fail(id, error);
        throw error;
      }
    });
  }
  public async flushAll(): Promise<void> {
    for (const id of this.drafts.keys()) await this.flush(id);
  }
  public async retainAll(): Promise<void> {
    await this.schedule(async () => {
      for (const id of this.drafts.keys()) await this.stage(id);
    });
  }
  public discard(prefix: string): Promise<void> {
    return this.withDiscarded([prefix], async () => undefined);
  }
  public async withDiscarded<T>(
    prefixes: string[],
    action: () => Promise<T>,
  ): Promise<T> {
    prefixes.forEach((prefix) => this.suspended.add(prefix));
    try {
      return await this.schedule(async () => {
        const selected = [...this.drafts.entries()].filter(([id]) =>
          prefixes.some((prefix) => id.startsWith(prefix)),
        );
        selected.forEach(([id]) => {
          clearTimeout(this.timers.get(id));
          this.timers.delete(id);
        });
        const result = await action();
        const persisted = z
          .array(draftRecordSchema)
          .parse(await this.transport.invoke('draft_list'));
        for (const [id] of selected) {
          const record = persisted.find((entry) => entry.id === id);
          if (record)
            await this.transport.invoke('draft_discard', {
              id,
              token: record.token,
            });
          this.drafts.delete(id);
        }
        this.emit();
        return result;
      });
    } finally {
      prefixes.forEach((prefix) => this.suspended.delete(prefix));
    }
  }
}
