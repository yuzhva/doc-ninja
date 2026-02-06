import WordExtractor from 'word-extractor';

import type {
  DocumentExtractorInput,
  DocumentExtractorParserParams,
} from '../document-extractor.types.js';
import {
  getBufferFromInput,
  getExtension,
} from '../document-extractor.utils.js';

class DocParserViaLib implements DocumentExtractorParserParams {
  private readonly supportedExtensions = ['.doc', '.dot'];

  canHandle(input: DocumentExtractorInput): boolean {
    const ext = getExtension(input).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  async extractText(input: DocumentExtractorInput): Promise<string> {
    try {
      const extractor = new WordExtractor();
      const buffer = await getBufferFromInput(input, this.supportedExtensions);
      const extracted = await extractor.extract(buffer);
      return extracted.getBody() || '';
    } catch (error) {
      throw new Error(
        `DOC extraction failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

export { DocParserViaLib };
