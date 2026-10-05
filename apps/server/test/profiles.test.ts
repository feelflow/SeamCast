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
      expect([undefined, 'modern', 'tafel', 'bild']).toContain(profile.design);
      expect([undefined, 'modern', 'tafel', 'bild']).toContain(profile.scoreboard?.design);
      for (const kind of ['batter', 'pitcher']) {
        expect([undefined, 'row', 'table', 'wide']).toContain(profile.cards?.[kind]?.layout);
        expect([undefined, 'top-left', 'top-right', 'bottom-left', 'bottom-right']).toContain(profile.cards?.[kind]?.position);
      }
    }
  });

  it('Layout HDH zeigt das Scoreboard nach der Bildvorlage, ohne die Karten zu verändern', async () => {
    const hdh = JSON.parse(await readFile(path.join(dir, 'hdh.json'), 'utf8')) as {
      design?: string;
      scoreboard?: { design?: string; labels?: { top?: string }; bild?: { image?: string; fields?: Record<string, { x?: number; y?: number; width?: number; height?: number }> } };
      cards?: { batter?: { layout?: string }; pitcher?: { layout?: string } };
    };
    expect(hdh.scoreboard?.design).toBe('bild');
    const fields = hdh.scoreboard?.bild?.fields ?? {};
    for (const key of ['away', 'awayScore', 'home', 'homeScore', 'inning', 'pitch', 'count', 'out']) {
      expect(fields[key]?.x).toBeTypeOf('number');
      expect(fields[key]?.y).toBeTypeOf('number');
      expect(fields[key]?.width).toBeGreaterThan(0);
      expect(fields[key]?.height).toBeGreaterThan(0);
    }
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
        scoreboard?: { bild?: { image?: string } };
        lineup?: { feld?: { back?: { image?: string }; plate?: { image?: string } } };
      };
      const back = profile.scoreboard?.bild?.image;
      if (back) expect(await readFile(path.join(assets, back))).toBeInstanceOf(Buffer);
      for (const image of [profile.lineup?.feld?.back?.image, profile.lineup?.feld?.plate?.image]) {
        if (image) expect(await readFile(path.join(assets, image))).toBeInstanceOf(Buffer);
      }
      for (const kind of ['batter', 'pitcher']) {
        const logo = profile.cards?.[kind]?.logo;
        if (logo) expect(await readFile(path.join(assets, logo))).toBeInstanceOf(Buffer);
      }
    }
  });

  it('Layout HDH zeigt die Aufstellung nach Feldpositionen, alle zehn Plätze mit Maßen', async () => {
    const hdh = JSON.parse(await readFile(path.join(dir, 'hdh.json'), 'utf8')) as {
      lineup?: { design?: string; feld?: { order?: string[]; positions?: Record<string, { x?: number; y?: number }>; plate?: { width?: number; height?: number } } };
    };
    expect(hdh.lineup?.design).toBe('feld');
    const feld = hdh.lineup?.feld;
    const keys = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
    expect(Object.keys(feld?.positions ?? {}).sort()).toEqual([...keys].sort());
    expect([...(feld?.order ?? [])].sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(feld?.positions?.[key]?.x).toBeTypeOf('number');
      expect(feld?.positions?.[key]?.y).toBeTypeOf('number');
    }
    expect(feld?.plate?.width).toBeGreaterThan(0);
    expect(feld?.plate?.height).toBeGreaterThan(0);
  });

  it('Standardprofil hat keine Feld-Aufstellung (bleibt bei der Liste)', async () => {
    const def = JSON.parse(await readFile(path.join(dir, 'default.json'), 'utf8')) as { lineup?: unknown };
    expect(def.lineup).toBeUndefined();
  });
});
