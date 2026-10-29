import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ZipError, readZip, writeZip } from '../src/zip.js';

const limits = { maxEntries: 10, maxEntryBytes: 1000, maxTotalBytes: 2000 };
const sample = () =>
  writeZip([
    { name: 'design.json', data: Buffer.from('{"name":"A"}') },
    { name: 'assets/bild.png', data: Buffer.alloc(900, 7) },
    { name: 'assets/ä.txt', data: Buffer.from('Umlaut') },
  ]);

describe('ZIP', () => {
  it('schreibt und liest ein Archiv', () => {
    const entries = readZip(sample(), limits);
    expect(entries.map((e) => e.name)).toEqual(['design.json', 'assets/bild.png', 'assets/ä.txt']);
    expect(entries[0]!.data.toString()).toBe('{"name":"A"}');
    expect(entries[1]!.data.equals(Buffer.alloc(900, 7))).toBe(true);
  });

  it('lehnt kein-ZIP, abgeschnittene und verfälschte Archive ab', () => {
    expect(() => readZip(Buffer.from('kein zip'), limits)).toThrow(ZipError);
    expect(() => readZip(sample().subarray(0, 40), limits)).toThrow(ZipError);
    const broken = Buffer.from(sample());
    broken[41] = broken[41]! ^ 0xff; // Nutzdaten verändern: Prüfsumme stimmt nicht mehr
    expect(() => readZip(broken, limits)).toThrow(ZipError);
  });

  it('hält Grenzen für Anzahl und Größe ein', () => {
    expect(() => readZip(sample(), { ...limits, maxEntries: 2 })).toThrow('Zu viele');
    expect(() => readZip(sample(), { ...limits, maxEntryBytes: 100 })).toThrow('zu groß');
    expect(() => readZip(sample(), { ...limits, maxTotalBytes: 500 })).toThrow('zu groß');
  });

  it('erkennt eine Zip-Bombe mit gelogener Größenangabe', () => {
    const big = Buffer.alloc(500_000, 0);
    const archive = writeZip([{ name: 'a.bin', data: big }]);
    // Größe im Zentralverzeichnis und im lokalen Kopf auf 10 Byte fälschen
    const eocd = archive.length - 22;
    const centralOffset = archive.readUInt32LE(eocd + 16);
    archive.writeUInt32LE(10, centralOffset + 24);
    expect(() => readZip(archive, limits)).toThrow(ZipError);
    expect(deflateRawSync(big).length).toBeLessThan(2000);
  });

  it('lehnt doppelte Namen, Verschlüsselung und fremde Methoden ab', () => {
    const dup = writeZip([
      { name: 'x', data: Buffer.from('1') },
      { name: 'x', data: Buffer.from('2') },
    ]);
    expect(() => readZip(dup, limits)).toThrow('Doppelter');
    const enc = Buffer.from(writeZip([{ name: 'x', data: Buffer.from('1') }]));
    const centralOffset = enc.readUInt32LE(enc.length - 22 + 16);
    enc.writeUInt16LE(1, centralOffset + 8);
    expect(() => readZip(enc, limits)).toThrow('Verschlüsselte');
    const method = Buffer.from(writeZip([{ name: 'x', data: Buffer.from('1') }]));
    method.writeUInt16LE(12, method.readUInt32LE(method.length - 22 + 16) + 10);
    expect(() => readZip(method, limits)).toThrow('Komprimierung');
  });
});
