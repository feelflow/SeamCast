import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve(import.meta.dirname, '../../../config/profiles');

describe('Grafikprofile', () => {
  it('sind gültiges JSON mit bekanntem Design', async () => {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    expect(files).toContain('default.json');
    expect(files).toContain('tafel.json');
    for (const file of files) {
      const profile = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as { design?: string; colors?: object };
      expect(profile.colors).toBeTypeOf('object');
      expect([undefined, 'modern', 'tafel']).toContain(profile.design);
    }
  });
});
