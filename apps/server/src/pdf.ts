import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class PdfUnavailableError extends Error {
  constructor() {
    super('PDF conversion needs LibreOffice, which is not installed on this server. Download the Word file instead.');
  }
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err) => (err ? reject(err) : resolve()));
  });
}

let available: Promise<boolean> | null = null;

export function pdfAvailable(): Promise<boolean> {
  available ??= run('soffice', ['--version'], 20_000).then(
    () => true,
    () => false,
  );
  return available;
}

// LibreOffice is not safe to run in parallel against one profile, so
// conversions wait their turn.
let queue: Promise<unknown> = Promise.resolve();

export function docxToPdf(docx: Uint8Array): Promise<Uint8Array> {
  const job = queue.then(async () => {
    if (!(await pdfAvailable())) throw new PdfUnavailableError();
    const dir = await mkdtemp(join(tmpdir(), 'whereas-pdf-'));
    try {
      await writeFile(join(dir, 'in.docx'), docx);
      await run(
        'soffice',
        [`-env:UserInstallation=file://${join(dir, 'profile')}`, '--headless', '--convert-to', 'pdf', '--outdir', dir, join(dir, 'in.docx')],
        120_000,
      );
      return new Uint8Array(await readFile(join(dir, 'in.pdf')));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  queue = job.catch(() => undefined);
  return job;
}
