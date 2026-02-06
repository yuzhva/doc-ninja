// @ts-ignore - pdfjs-dist does not have official TypeScript types, so we ignore type errors for this import.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.min.mjs';
// @ts-ignore - pdfjs-dist does not have official TypeScript types, so we ignore type errors for this import.
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';

import type {
  DocumentExtractorInput,
  DocumentExtractorParserParams,
} from '../document-extractor.types.js';
import {
  getBufferFromInput,
  getExtension,
} from '../document-extractor.utils.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

class PdfParserViaLib implements DocumentExtractorParserParams {
  private readonly supportedExtensions = ['.pdf'];

  canHandle(input: DocumentExtractorInput): boolean {
    const ext = getExtension(input).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  async extractText(input: DocumentExtractorInput): Promise<string> {
    try {
      const buffer = await getBufferFromInput(input, this.supportedExtensions);
      const uint8Array = new Uint8Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength,
      );

      const loadingTask = pdfjsLib.getDocument({
        data: uint8Array,
        useSystemFonts: true,
        disableFontFace: true,
        isEvalSupported: false,
      });

      const pdfDocument = await loadingTask.promise;
      const numPages = pdfDocument.numPages;
      const pagesText: string[] = [];

      for (let i = 1; i <= numPages; i++) {
        const page = await pdfDocument.getPage(i);
        const textContent = await page.getTextContent();

        // 1. Group items into visual lines (rows) based on Y coordinate
        interface LineItem {
          str: string;
          x: number;
          height: number;
        }
        const linesMap = new Map<number, LineItem[]>();
        const yTolerance = 5; // Pixels tolerance to consider text on the same line

        for (const item of textContent.items as any[]) {
          const tx = item.transform; // [scaleX, skewY, skewX, scaleY, x, y]
          const y = tx[5];
          const x = tx[4];
          const height = item.height || Math.abs(tx[3]);

          // Find an existing line bucket within tolerance
          let matchedY = [...linesMap.keys()].find(
            (ky) => Math.abs(ky - y) < yTolerance,
          );
          if (matchedY === undefined) {
            matchedY = y;
          }
          linesMap.set(matchedY!, []);
          linesMap.get(matchedY!)!.push({ str: item.str, x, height });
        }

        // 2. Sort rows from Top to Bottom (Y descending in PDF coords)
        const sortedY = [...linesMap.keys()].sort((a, b) => b - a);

        let pageStr = '';
        let prevY: number | null = null;
        let prevLineHeight = 0;

        for (const y of sortedY) {
          const items = linesMap.get(y)!.slice();
          // Sort items in this row from Left to Right
          items.sort((a, b) => a.x - b.x);

          // Join items in the row with spaces (compacting multiple spaces)
          const lineText = items
            .map((it) => it.str)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

          if (!lineText) continue;

          // Estimate current line height (max of items)
          const currentHeight = Math.max(...items.map((it) => it.height)) || 12;

          if (prevY === null) {
            pageStr += lineText;
          } else {
            // 3. Calculate Vertical Gap
            const gap = Math.abs(prevY - y);

            // Heuristic 1: Large gap (> 1.5x line height) -> New Paragraph
            const isParagraphBreak =
              gap > (prevLineHeight || currentHeight) * 1.5;

            // Heuristic 2: Explicit pattern start (e.g., "§ 4", "11.") -> New Paragraph
            const isMarkerStart = /^(\§|\d+\.)/.test(lineText);

            if (isParagraphBreak || isMarkerStart) {
              pageStr += '\n\n' + lineText;
            } else {
              // Otherwise, it's a wrapped line -> join with space
              pageStr += ' ' + lineText;
            }
          }

          prevY = y;
          prevLineHeight = currentHeight;
        }

        pagesText.push(pageStr);
      }

      return pagesText.join('\n\n');
    } catch (error) {
      throw new Error(
        `PDF extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export { PdfParserViaLib };
