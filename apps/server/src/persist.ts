import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface Persistence {
  /** Lädt den gespeicherten Stand; null, wenn keiner da oder lesbar ist. */
  load(): Promise<unknown>;
  /** Plant das Speichern des aktuellen Stands. Mehrere Aufrufe werden zusammengefasst. */
  save(): void;
  /** Wartet, bis alles geschrieben ist (zum sauberen Beenden). */
  flush(): Promise<void>;
}

/**
 * Speichert einen JSON-Stand atomar (erst temporäre Datei, dann umbenennen),
 * damit ein Absturz mitten im Schreiben nie eine kaputte Datei hinterlässt.
 * Schreibfehler werden gemeldet, blockieren oder beenden aber nie das Programm.
 */
export function createPersistence(
  file: string,
  getData: () => unknown,
  log: (message: string) => void = console.error,
): Persistence {
  let dirty = false;
  let current: Promise<void> | null = null;

  async function write(): Promise<void> {
    while (dirty) {
      dirty = false;
      try {
        await mkdir(path.dirname(file), { recursive: true });
        const temp = `${file}.tmp`;
        await writeFile(temp, JSON.stringify(getData()), 'utf8');
        await rename(temp, file);
      } catch (error) {
        log(`Speichern fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  function kick(): void {
    current ??= write().finally(() => {
      current = null;
      if (dirty) kick();
    });
  }

  return {
    async load() {
      try {
        return JSON.parse(await readFile(file, 'utf8')) as unknown;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          log(`Gespeicherter Stand nicht lesbar, starte neu: ${String(error)}`);
        }
        return null;
      }
    },
    save() {
      dirty = true;
      kick();
    },
    async flush() {
      while (current) await current;
    },
  };
}
