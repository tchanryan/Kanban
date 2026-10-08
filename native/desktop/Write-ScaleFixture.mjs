import { rolldown } from 'rolldown';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';

const destination = process.argv[2];
if (!destination || !isAbsolute(destination)) {
  throw new Error('Provide an absolute output path for the synthetic fixture.');
}
const bundle = await rolldown({
  input: resolve('e2e/scale-fixture.ts'),
  platform: 'node',
});
try {
  const output = await bundle.generate({ format: 'esm' });
  const chunks = output.output.filter((entry) => entry.type === 'chunk');
  if (chunks.length !== 1)
    throw new Error('Expected one self-contained fixture module.');
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(chunks[0].code).toString('base64')}`
  );
  await writeFile(destination, JSON.stringify(module.scaleFixture()), {
    flag: 'wx',
  });
} finally {
  await bundle.close();
}
