// @ts-ignore - pdfjs-dist does not have official TypeScript types, so we ignore type errors for this import.
import type * as PdfjsLib from 'pdfjs-dist/legacy/build/pdf.min.mjs';

import type {
  DocumentExtractorInput,
  DocumentExtractorParserParams,
} from '../document-extractor.types.js';
import {
  getBufferFromInput,
  getExtension,
} from '../document-extractor.utils.js';

// No `GlobalWorkerOptions.workerSrc` setup needed here: pdf.js detects
// Node.js at module load and disables the real worker automatically,
// falling back to an in-process "fake worker" that dynamically imports
// its own default worker script relative to itself. Assigning a module
// namespace object (as opposed to a string) to `workerSrc` throws
// ("Invalid `workerSrc` type"), since the setter requires a string.
//
// That fallback's own dynamic import is marked `@vite-ignore`/`webpackIgnore`,
// so bundlers deliberately leave it untouched as a genuine runtime import of
// "./pdf.worker.mjs" resolved next to wherever be-krang's bundled chunk ends
// up — a file that never actually exists there, since only the bundled JS
// (not pdfjs-dist's own asset files) ships with the packaged Electron app.
// pdfjs-dist skips that import entirely if `globalThis.pdfjsWorker` is
// already populated, so we import the worker module ourselves (a plain,
// bundler-visible import, unlike pdf.js's ignored one) and hand it over.

let pdfjsLibPromise: Promise<typeof PdfjsLib> | undefined;

// pdfjs-dist's Node build unconditionally instantiates `DOMMatrix` at module
// load time to support canvas rendering, even though we only call
// `getTextContent()` and never render a page. It tries to source `DOMMatrix`
// from the optional native `@napi-rs/canvas` dependency, which isn't
// available in the packaged Electron app (only the bundled JS ships, not
// node_modules) and throws an uncaught ReferenceError there. Stubbing the
// global before the (dynamic, non-hoisted) import avoids needing that native
// dependency at all, since text extraction never touches these APIs.
function loadPdfjsLib(): Promise<typeof PdfjsLib> {
  if (!pdfjsLibPromise) {
    if (typeof globalThis.DOMMatrix === 'undefined') {
      // @ts-expect-error - minimal stub; only pdf.js's unused render path needs a real implementation.
      globalThis.DOMMatrix = class DOMMatrix {};
    }
    if (typeof globalThis.Path2D === 'undefined') {
      // @ts-expect-error - see above.
      globalThis.Path2D = class Path2D {};
    }
    pdfjsLibPromise = Promise.all([
      // @ts-ignore - pdfjs-dist does not have official TypeScript types, so we ignore type errors for this import.
      import('pdfjs-dist/legacy/build/pdf.min.mjs'),
      // @ts-ignore - pdfjs-dist does not have official TypeScript types, so we ignore type errors for this import.
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
    ]).then(([lib, worker]) => {
      (globalThis as any).pdfjsWorker = worker;
      return lib;
    });
  }
  return pdfjsLibPromise;
}

class PdfParserViaLib implements DocumentExtractorParserParams {
  private readonly supportedExtensions = ['.pdf'];

  canHandle(input: DocumentExtractorInput): boolean {
    const ext = getExtension(input).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  async extractText(input: DocumentExtractorInput): Promise<string> {
    let loadingTask: ReturnType<typeof PdfjsLib.getDocument> | undefined;

    try {
      const pdfjsLib = await loadPdfjsLib();
      const buffer = await getBufferFromInput(input, this.supportedExtensions);
      // View the existing memory rather than copying it — meaningful for
      // multi-MB PDFs processed in bulk during indexing.
      const data = new Uint8Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength,
      );

      loadingTask = pdfjsLib.getDocument({
        data,
        useSystemFonts: true,
        disableFontFace: true,
        isEvalSupported: false,
      });
      const pdfDocument = await loadingTask.promise;

      const pageTexts: string[] = [];

      for (
        let pageNumber = 1;
        pageNumber <= pdfDocument.numPages;
        pageNumber++
      ) {
        try {
          const page = await pdfDocument.getPage(pageNumber);
          const textContent = await page.getTextContent();
          pageTexts.push(this.reconstructPageText(textContent.items));
        } catch (pageError) {
          // One corrupted page shouldn't discard every page already
          // extracted from an otherwise-fine document.
          console.warn(
            `Failed to extract text from PDF page ${pageNumber}:`,
            pageError instanceof Error ? pageError.message : String(pageError),
          );
        }
      }

      return pageTexts.join('\n\n');
    } catch (error) {
      throw new Error(
        `PDF extraction failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      await loadingTask?.destroy();
    }
  }

  /**
   * Reassemble a page's text items into readable lines/paragraphs using
   * their layout position, since pdf.js's own `hasEOL` flag is unreliable
   * across PDF generators (Word-to-PDF exports, scanned/OCR'd documents).
   * Items are bucketed into visual lines by Y position, sorted left-to-right
   * within a line, then joined across lines — inserting a paragraph break
   * on a large vertical gap or a numbered-clause marker (e.g. "18.1.6.",
   * "§ 4"), and a plain space for wrapped continuation lines.
   */
  private reconstructPageText(items: Array<{ str?: string }>): string {
    interface LineItem {
      str: string;
      x: number;
      height: number;
    }

    const yTolerance = 5; // px tolerance to consider text on the same line
    const lines = new Map<number, LineItem[]>();

    for (const item of items) {
      // TextMarkedContent entries (no `str`) are only present when
      // `includeMarkedContent` is requested, which we don't do here.
      if (typeof item.str !== 'string') continue;

      const { str, transform, height } = item as {
        str: string;
        transform: number[];
        height: number;
      };
      const [, , , scaleY, x, y] = transform;

      let lineY = [...lines.keys()].find(
        (existingY) => Math.abs(existingY - y) < yTolerance,
      );
      if (lineY === undefined) {
        lineY = y;
        lines.set(lineY, []);
      }
      lines.get(lineY)!.push({ str, x, height: height || Math.abs(scaleY) });
    }

    // PDF Y coordinates increase upward, so sort top-to-bottom descending.
    const sortedY = [...lines.keys()].sort((a, b) => b - a);

    let pageText = '';
    let prevY: number | null = null;
    let prevLineHeight = 0;

    for (const y of sortedY) {
      const lineItems = lines.get(y)!.sort((a, b) => a.x - b.x);
      const lineText = lineItems
        .map((it) => it.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!lineText) continue;

      const currentLineHeight = Math.max(...lineItems.map((it) => it.height));

      if (prevY === null) {
        pageText += lineText;
      } else {
        const gap = Math.abs(prevY - y);
        const isParagraphBreak =
          gap > (prevLineHeight || currentLineHeight) * 1.5;
        const isMarkerStart = /^(§|\d+\.)/.test(lineText);

        pageText +=
          isParagraphBreak || isMarkerStart
            ? `\n\n${lineText}`
            : ` ${lineText}`;
      }

      prevY = y;
      prevLineHeight = currentLineHeight;
    }

    return pageText;
  }
}

export { PdfParserViaLib };
