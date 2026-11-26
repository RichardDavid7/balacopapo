import fs from 'node:fs/promises';
import path from 'node:path';

/** Cache de áudio em disco com despejo LRU por tamanho total (usa mtime como "último uso"). */
export class AudioCache {
  constructor(
    readonly dir: string,
    private readonly maxBytes: number,
  ) {}

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  /** Procura um arquivo completo no cache cujo nome comece com `key.`; marca como usado. */
  async find(key: string): Promise<string | null> {
    const entries = await fs.readdir(this.dir).catch(() => [] as string[]);
    const hit = entries.find((f) => f.startsWith(`${key}.`) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
    if (!hit) return null;
    const full = path.join(this.dir, hit);
    const now = new Date();
    await fs.utimes(full, now, now).catch(() => undefined);
    return full;
  }

  async prune(): Promise<number> {
    const entries = await fs.readdir(this.dir).catch(() => [] as string[]);
    const files = (
      await Promise.all(
        entries.map(async (name) => {
          const full = path.join(this.dir, name);
          const st = await fs.stat(full).catch(() => null);
          return st?.isFile() ? { full, size: st.size, mtime: st.mtimeMs } : null;
        }),
      )
    ).filter((f): f is { full: string; size: number; mtime: number } => f !== null);

    let total = files.reduce((s, f) => s + f.size, 0);
    let removed = 0;
    for (const f of files.sort((a, b) => a.mtime - b.mtime)) {
      if (total <= this.maxBytes) break;
      await fs.rm(f.full, { force: true });
      total -= f.size;
      removed++;
    }
    return removed;
  }
}
