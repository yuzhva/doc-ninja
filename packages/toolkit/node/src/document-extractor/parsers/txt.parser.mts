import type {
  DocumentExtractorInput,
  DocumentExtractorParserParams,
} from '../document-extractor.types.ts';
import {
  getBufferFromInput,
  getExtension,
} from '../document-extractor.utils.js';

class TextParser implements DocumentExtractorParserParams {
  private readonly supportedExtensions = [
    '.txt',
    '.md',
    '.csv',
    '.json',
    '.xml',
    '.log',
    '.yml',
    '.yaml',
    '.ini',
  ];

  canHandle(input: DocumentExtractorInput): boolean {
    const ext = getExtension(input).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  async extractText(input: DocumentExtractorInput): Promise<string> {
    const buffer = await getBufferFromInput(input, this.supportedExtensions);
    return buffer.toString('utf8');
  }
}

export { TextParser };
