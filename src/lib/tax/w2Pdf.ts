// Loading a W-2 PDF in the browser and reading its boxes.
//
// pdf.js runs here, in the user's browser, from this app's own bundle (no
// CDN): the file never leaves the device. It is loaded only when someone
// uploads a W-2, so other pages do not carry it.

import type { TextItem, W2Read } from './w2Parse';
import { parseW2 } from './w2Parse';

/** The parts of the pdf.js API used here, so tests can pass the Node build. */
export interface PdfJsLike {
  getDocument: (src: { data: Uint8Array; isEvalSupported?: boolean; disableFontFace?: boolean }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }>;
      destroy: () => Promise<void>;
    }>;
  };
}

const MAX_PAGES = 6;

/** Every positioned text item in the first pages of a PDF. */
export async function extractTextItems(data: Uint8Array, pdfjs: PdfJsLike): Promise<TextItem[]> {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
  try {
    const items: TextItem[] = [];
    for (let page = 1; page <= Math.min(doc.numPages, MAX_PAGES); page++) {
      const content = await (await doc.getPage(page)).getTextContent();
      for (const raw of content.items) {
        const item = raw as { str?: string; transform?: number[]; width?: number; height?: number };
        if (typeof item.str !== 'string' || !item.transform) continue;
        const [a, b, , d, e, f] = item.transform;
        items.push({
          str: item.str,
          x: e,
          y: f,
          width: item.width ?? 0,
          height: item.height || Math.hypot(a, b) || Math.abs(d),
          page,
        });
      }
    }
    return items;
  } finally {
    await doc.destroy();
  }
}

let browserPdfJs: Promise<PdfJsLike> | null = null;

const loadBrowserPdfJs = (): Promise<PdfJsLike> => {
  browserPdfJs ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs as unknown as PdfJsLike;
  })();
  return browserPdfJs;
};

const MAX_BYTES = 10 * 1024 * 1024;

/** Read the W-2 boxes from an uploaded file, in the browser. */
export async function readW2File(file: File): Promise<W2Read> {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    return { ok: false, reason: 'Upload the W-2 as a PDF. Photos and other files are not read yet - type the boxes in by hand.' };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, reason: 'This file is larger than a W-2 PDF should be (over 10 MB).' };
  }
  try {
    const items = await extractTextItems(new Uint8Array(await file.arrayBuffer()), await loadBrowserPdfJs());
    return parseW2(items);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password/i.test(message)) {
      return { ok: false, reason: 'This PDF is password-protected. Open it, save an unprotected copy, and upload that - or type the boxes in.' };
    }
    return { ok: false, reason: 'This PDF could not be read. Type the boxes in by hand.' };
  }
}
