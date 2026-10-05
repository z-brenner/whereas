import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { parseXml, serializeXml, type XDocument } from './xml';

const DOCUMENT = 'word/document.xml';

/** An unzipped DOCX. Parts other than the main document are kept as bytes. */
export interface Docx {
  files: Record<string, Uint8Array>;
  document: XDocument;
}

export class DocxError extends Error {}

export function readDocx(bytes: Uint8Array): Docx {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
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
