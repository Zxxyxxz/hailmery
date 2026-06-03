// Text extraction for uploaded corpus documents.
//
// Supports the four upload types the dashboard accepts:
//   .md / .txt  - decoded directly as UTF-8 (any runtime)
//   .docx       - native ZIP reader + DecompressionStream (workerd + Node),
//                 with mammoth as a Node fallback
//   .pdf        - pdf-parse (Node ingestion path; lazy-loaded)
//
// The .md/.txt and .docx paths run in the Cloudflare Worker (incl. `wrangler
// dev`) AND in the Node CLI. pdf-parse is Node-oriented (pdfjs/canvas) and only
// runs in the Node ingestion path; inside the Worker it fails the import and the
// upload route records extraction_status='failed' rather than 500-ing. Every
// extractor throws ExtractionError on failure so the caller degrades gracefully.

export const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'md', 'txt'] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

/** Lowercased file extension without the dot, or '' if none. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

export function isSupportedExtension(ext: string): ext is SupportedExtension {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Extract plain text from an uploaded document. Throws ExtractionError on any
 * unsupported type or parse failure so the caller can record a failed ingest.
 */
export async function extractText(
  bytes: Uint8Array,
  filename: string,
): Promise<string> {
  const ext = extensionOf(filename);

  if (ext === 'md' || ext === 'txt') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  if (ext === 'docx') {
    return extractDocx(bytes);
  }
  if (ext === 'pdf') {
    return extractPdf(bytes);
  }
  throw new ExtractionError(`unsupported file type: .${ext || '(none)'}`);
}

// -- DOCX ------------------------------------------------------------
// A .docx is an OOXML ZIP; the body lives in word/document.xml. We read that one
// entry straight out of the ZIP and inflate it with DecompressionStream (built
// into both workerd and Node 18+), then strip the XML to text. Falls back to
// mammoth if the native reader trips on an unusual ZIP layout.

async function extractDocx(bytes: Uint8Array): Promise<string> {
  try {
    const xml = await readZipEntry(bytes, 'word/document.xml');
    if (xml) {
      const text = docxXmlToText(new TextDecoder('utf-8').decode(xml));
      if (text.trim()) return text;
    }
  } catch {
    // fall through to mammoth
  }

  try {
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return (result.value ?? '').trim();
  } catch (err) {
    throw new ExtractionError('DOCX text extraction failed', err);
  }
}

/**
 * Map word/document.xml to plain text. In OOXML, visible text only ever appears
 * inside <w:t> runs, so once we turn structural elements (paragraph ends, tabs,
 * line breaks) into whitespace we can strip every remaining tag and the run text
 * falls out in order.
 */
function docxXmlToText(xml: string): string {
  const s = xml
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n') // end of paragraph -> newline
    .replace(/<[^>]+>/g, ''); // strip all tags; only <w:t> text survives
  return decodeXmlEntities(s)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&'); // last, so a literal &amp;lt; survives correctly
}

/**
 * Read a single named entry out of a ZIP archive. Locates it via the central
 * directory (which always carries sizes), then inflates the local entry with
 * DecompressionStream. Returns null if the entry is absent.
 */
async function readZipEntry(zip: Uint8Array, name: string): Promise<Uint8Array | null> {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  // Find the End Of Central Directory record (sig 0x06054b50), scanning back
  // from the end (the trailing comment is usually empty, so it's near the tail).
  let eocd = -1;
  const minScan = Math.max(0, zip.length - 22 - 0xffff);
  for (let i = zip.length - 22; i >= minScan; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return null;

  let ptr = dv.getUint32(eocd + 16, true); // central directory offset
  const entries = dv.getUint16(eocd + 10, true);

  for (let e = 0; e < entries; e++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break; // central dir header sig
    const method = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localOff = dv.getUint32(ptr + 42, true);
    const entryName = new TextDecoder('utf-8').decode(zip.subarray(ptr + 46, ptr + 46 + nameLen));

    if (entryName === name) {
      // Use the local header to compute the real data offset (its name/extra
      // lengths can differ from the central directory's).
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = zip.subarray(dataStart, dataStart + compSize);
      return method === 0 ? comp : inflateRaw(comp);
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** Inflate a raw DEFLATE stream using the platform DecompressionStream. */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Response(data).body!.pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

// -- PDF -------------------------------------------------------------

async function extractPdf(bytes: Uint8Array): Promise<string> {
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: bytes });
    const result = await parser.getText();
    return (result.text ?? '').trim();
  } catch (err) {
    throw new ExtractionError('PDF text extraction failed', err);
  }
}
