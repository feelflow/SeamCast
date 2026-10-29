import { describe, expect, it } from 'vitest';
import { checkProfile, profileIdFromName } from '../src/index.js';

const ok = (value: unknown) => {
  const result = checkProfile(value);
  if (!result.ok) throw new Error(result.error);
  return result;
};
const bad = (value: unknown) => {
  const result = checkProfile(value);
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.error;
};

describe('checkProfile', () => {
  it('nimmt ein gültiges Profil an und nennt die Bilddateien', () => {
    const result = ok({
      name: 'Mein Design',
      colors: { panel: '#112233' },
      font: { family: "'Segoe UI', Arial", scale: 1.1 },
      scoreboard: { bild: { image: 'board.jpg' } },
      cards: { batter: { logo: 'logo.png' } },
    });
    expect(result.assets).toEqual(['board.jpg', 'logo.png']);
  });

  it('lehnt Nicht-Objekte, fehlenden Namen und unbekannte Abschnitte ab', () => {
    bad(null);
    bad([]);
    bad('text');
    bad({});
    bad({ name: '' });
    bad({ name: 'x'.repeat(61) });
    expect(bad({ name: 'A', skript: {} })).toContain('Unbekannter Abschnitt');
  });

  it('lehnt gefährliche Texte ab', () => {
    bad({ name: 'A', colors: { panel: 'url(https://böse.example/x.png)' } });
    bad({ name: 'A', labels: { top: '<img src=x>' } });
    bad({ name: 'A', labels: { top: 'javascript:alert(1)' } });
    bad({ name: 'A', labels: { top: '@import "x"' } });
    bad({ name: 'A', labels: { top: 'http://fremd.example' } });
    bad({ name: 'A<b>' });
    bad({ name: 'A', labels: { top: 'Zeile\u0000' } });
  });

  it('lehnt Bildangaben mit Pfad oder Adresse ab', () => {
    bad({ name: 'A', scoreboard: { bild: { image: '../geheim.png' } } });
    bad({ name: 'A', scoreboard: { bild: { image: 'ordner/bild.png' } } });
    bad({ name: 'A', scoreboard: { bild: { image: 'bild.gif' } } });
  });

  it('lehnt gefährliche Schlüssel, zu tiefe und zu große Profile ab', () => {
    bad(JSON.parse('{"name":"A","colors":{"__proto__":{"x":1}}}'));
    bad({ name: 'A', colors: { constructor: 'x' } });
    let deep: unknown = 1;
    for (let i = 0; i < 12; i += 1) deep = { a: deep };
    bad({ name: 'A', show: deep });
    bad({ name: 'A', show: { list: Array.from({ length: 201 }, () => 1) } });
    bad({ name: 'A', labels: { top: 'x'.repeat(301) } });
    bad({ name: 'A', radius: Number.POSITIVE_INFINITY });
  });
});

describe('profileIdFromName', () => {
  it('macht aus dem Namen eine gültige Kennung', () => {
    expect(profileIdFromName('Mein Schönes Design!')).toBe('mein-schones-design');
    expect(profileIdFromName('Größe')).toBe('grosse');
    expect(profileIdFromName('???')).toBe('design');
    expect(profileIdFromName('a'.repeat(80)).length).toBeLessThanOrEqual(40);
  });
});
