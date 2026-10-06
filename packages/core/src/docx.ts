import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { parseXml, serializeXml, type XDocument } from './xml';

const DOCUMENT = 'word/document.xml';
const MAX_ENTRIES = 5000;
const MAX_PART = 64 * 1024 * 1024;
const MAX_TOTAL = 192 * 1024 * 1024;

export class DocxError extends Error {}

/** An unzipped DOCX. Parts other than the main document are kept as bytes. */
export interface Docx {
  files: Record<string, Uint8Array>;
  document: XDocument;
}


export function readDocx(bytes: Uint8Array): Docx {
  let files: Record<string, Uint8Array>;
  let total = 0;
  let entries = 0;
  try {
    files = unzipSync(bytes, {
      // Refuse archives that expand far beyond any real agreement.
      filter: (file) => {
        total += file.originalSize;
        if (++entries > MAX_ENTRIES || file.originalSize > MAX_PART || total > MAX_TOTAL) {
          throw new DocxError('This document is too large to use as a template.');
        }
        return true;
      },
    });
  } catch (e) {
    if (e instanceof DocxError) throw e;
    throw new DocxError('This file is not a Word document (.docx).');
  }
  const main = files[DOCUMENT];
  if (!main) {
    throw new DocxError('This file is not a Word document (.docx). Older .doc files are not supported.');
  }
  return { files, document: parseXml(strFromU8(main)) };
}

export function readPart(docx: Docx, path: string): XDocument | null {
  const part = docx.files[path];
  return part ? parseXml(strFromU8(part)) : null;
}

export function writeDocx(docx: Docx): Uint8Array {
  const files: Record<string, Uint8Array> = { ...docx.files, [DOCUMENT]: strToU8(serializeXml(docx.document)) };
  // [Content_Types].xml must be the first entry for strict readers.
  const ordered: Record<string, Uint8Array> = {};
  const first = '[Content_Types].xml';
  if (files[first]) ordered[first] = files[first];
  for (const [name, data] of Object.entries(files)) if (name !== first) ordered[name] = data;
  return zipSync(ordered, { level: 6 });
}

/** A deep copy whose document can be edited without touching the original. */
export function cloneDocx(docx: Docx): Docx {
  return { files: docx.files, document: parseXml(serializeXml(docx.document)) };
}
