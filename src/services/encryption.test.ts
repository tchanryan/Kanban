// @vitest-environment node
import { expect, it } from 'vitest';
import { Database } from '../db/database';
import { WorkspaceRepository } from '../repositories/workspace';
import { exportBackup, encryptBackup, readBackup } from './backups';
it('authenticates encryption, rejects wrong keys/corruption and uses unique randomness', async () => {
  const db = new Database(`encryption-${crypto.randomUUID()}`);
  try {
    const repo = new WorkspaceRepository(db);
    await repo.initialize();
    await repo.saveScratch('Confidential text');
    const original = await exportBackup(db);
    const pass = 'correct horse battery staple';
    const encrypted = await encryptBackup(original, pass);
    const second = await encryptBackup(original, pass);
    expect(encrypted.salt).not.toBe(second.salt);
    expect(encrypted.iv).not.toBe(second.iv);
    expect(JSON.stringify(encrypted)).not.toContain('Confidential text');
    expect(await readBackup(JSON.stringify(encrypted), pass)).toEqual(original);
    await expect(
      readBackup(JSON.stringify(encrypted), 'incorrect passphrase'),
    ).rejects.toThrow('Incorrect passphrase');
    const bytes = Buffer.from(encrypted.ciphertext, 'base64');
    bytes[10] = bytes[10]! ^ 1;
    await expect(
      readBackup(
        JSON.stringify({ ...encrypted, ciphertext: bytes.toString('base64') }),
        pass,
      ),
    ).rejects.toThrow('damaged');
    await expect(
      readBackup(JSON.stringify({ ...encrypted, iterations: 1 }), pass),
    ).rejects.toThrow();
    await expect(
      readBackup(JSON.stringify({ ...encrypted, version: 2 }), pass),
    ).rejects.toThrow();
    await expect(encryptBackup(original, 'short')).rejects.toThrow(
      '12 characters',
    );
  } finally {
    await db.delete();
  }
});
