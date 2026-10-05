import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve(import.meta.dirname, '../../../config/profiles');

describe('Grafikprofile', () => {
  it('sind gültiges JSON mit bekanntem Design', async () => {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    expect(files).toContain('default.json');
    expect(files).not.toContain('tafel.json');
    expect(files).toContain('hdh.json');
    for (const file of files) {
      const profile = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as {
        design?: string;
        scoreboard?: { design?: string };
        colors?: object;
        cards?: Record<string, { layout?: string; logo?: string; position?: string }>;
      };
      expect(profile.colors).toBeTypeOf('object');
      expect([undefined, 'modern', 'tafel']).toContain(profile.design);
      expect([undefined, 'modern', 'tafel']).toContain(profile.scoreboard?.design);
      for (const kind of ['batter', 'pitcher']) {
        expect([undefined, 'row', 'table', 'wide']).toContain(profile.cards?.[kind]?.layout);
        expect([undefined, 'top-left', 'top-right', 'bottom-left', 'bottom-right']).toContain(profile.cards?.[kind]?.position);
      }
    }
  });

  it('Layout HDH zeigt das Scoreboard als Anzeigetafel, ohne die Karten zu verändern', async () => {
    const hdh = JSON.parse(await readFile(path.join(dir, 'hdh.json'), 'utf8')) as {
      design?: string;
      scoreboard?: { design?: string; labels?: { top?: string } };
      cards?: { batter?: { layout?: string }; pitcher?: { layout?: string } };
    };
    expect(hdh.scoreboard?.design).toBe('tafel');
    expect(hdh.scoreboard?.labels?.top).toBe('TOP');
    expect(hdh.design).toBeUndefined();
    expect(hdh.cards?.batter?.layout).toBe('wide');
    expect(hdh.cards?.pitcher?.layout).toBe('table');
  });

  it('verweisen nur auf vorhandene Logo-Dateien in config/assets', async () => {
    const assets = path.resolve(dir, '../assets');
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
      const profile = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as {
        cards?: Record<string, { logo?: string }>;
      };
      for (const kind of ['batter', 'pitcher']) {
        const logo = profile.cards?.[kind]?.logo;
        if (logo) expect(await readFile(path.join(assets, logo))).toBeInstanceOf(Buffer);
      }
    }
  });
});
