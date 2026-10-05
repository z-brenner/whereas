import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, sha256 } from './crypto';

/**
 * Files are stored under their SHA-256, so a stored file can never change
 * and the same upload is only kept once.
 */
export class BlobStore {
  private root: string;

  constructor(dataDir: string) {
    this.root = join(dataDir, 'blobs');
    mkdirSync(this.root, { recursive: true });
  }

  private path(hash: string): string {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid file reference.');
    return join(this.root, hash.slice(0, 2), hash);
  }

  put(data: Uint8Array): string {
    const hash = sha256(data);
    const path = this.path(hash);
    if (!existsSync(path)) {
      mkdirSync(join(this.root, hash.slice(0, 2)), { recursive: true });
      // Write then rename, so a crash never leaves a half-written file.
      const tmp = `${path}.${newId(6)}.tmp`;
      writeFileSync(tmp, data);
      renameSync(tmp, path);
    }
    return hash;
  }

  get(hash: string): Uint8Array {
    return new Uint8Array(readFileSync(this.path(hash)));
  }
}
