import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import type {
  DocumentExtractorInput,
  DocumentExtractorParserParams,
} from './document-extractor.types.js';
import { getExtension } from './document-extractor.utils.js';
import {
  DocParser,
  DocParserViaLib,
  DocxParser,
  DocxParserViaLib,
  PdfParserViaLib,
  TextParser,
} from './parsers/index.mjs';

interface DocumentExtractorOptions {
  useLibraryParsers?: boolean;
}

// TODO: refactor mega-search to dynamically support complete set of all parsers extensions, and remove hardcoded extensions {const defaultConfig: SearchConfig}
const SUPPORTED_EXTENSIONS = [
  // doc parser
  '.doc',
  '.dot',
  // docx parser
  '.docx',
  '.docm',
  '.dotx',
  // pdf parser
  '.pdf',
  // text parser
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

class DocumentExtractor {
  private parsers: DocumentExtractorParserParams[];

  constructor(options: DocumentExtractorOptions = {}) {
    this.parsers = [new TextParser(), new PdfParserViaLib()];

    // Default to using library parsers (true)
    const useLibrary = options.useLibraryParsers !== false;

    if (useLibrary) {
      this.parsers.push(new DocxParserViaLib());
      this.parsers.push(new DocParserViaLib());
    } else {
      this.parsers.push(new DocxParser());
      this.parsers.push(new DocParser());
    }
  }

  async extractText(input: DocumentExtractorInput): Promise<string> {
    const sourceName =
      input.fileName ||
      (input.filePath ? path.basename(input.filePath) : 'buffer');

    try {
      const parser = this.parsers.find((p) => p.canHandle(input));

      if (!parser) {
        const ext = getExtension(input) || 'unknown';
        throw new Error(`No parser available for file extension: ${ext}`);
      }

      // Check if file exists and is readable ONLY if path is provided AND buffer is missing
      if (input.filePath && !input.fileBuffer) {
        try {
          await promisify(fs.access)(input.filePath, fs.constants.R_OK);
        } catch (accessError) {
          throw new Error(`File is not accessible: ${input.filePath}`);
        }
      }

      const text = await parser.extractText(input);
      return text || ''; // Ensure we always return a string
    } catch (error) {
      console.error(
        `Text extraction failed for ${sourceName}:`,
        error instanceof Error ? error.message : String(error),
      );
      throw new Error(
        `Document extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  addParser(parser: DocumentExtractorParserParams): void {
    this.parsers.push(parser);
  }
}

export { DocumentExtractor, SUPPORTED_EXTENSIONS };
