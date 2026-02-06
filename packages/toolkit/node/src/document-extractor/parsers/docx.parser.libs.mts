import mammoth from 'mammoth';
import path from 'path';

import type {
  DocumentExtractorInput,
  DocumentExtractorParserParams,
} from '../document-extractor.types.js';
import {
  getBufferFromInput,
  getExtension,
} from '../document-extractor.utils.js';

class DocxParserViaLib implements DocumentExtractorParserParams {
  private readonly supportedExtensions = ['.docx', '.docm', '.dotx'];

  canHandle(input: DocumentExtractorInput): boolean {
    const ext = getExtension(input).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  async extractText(input: DocumentExtractorInput): Promise<string> {
    try {
      const buffer = await getBufferFromInput(input, this.supportedExtensions);
      const result = await mammoth.extractRawText({ buffer });

      if (result.messages.length > 0) {
        const sourceName =
          input.fileName ||
          (input.filePath ? path.basename(input.filePath) : 'buffer');
        // Log warnings but don't fail
        console.warn(`Mammoth warnings for ${sourceName}:`, result.messages);
      }

      return result.value || '';
    } catch (error) {
      throw new Error(
        `DOCX extraction failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

export { DocxParserViaLib };
