interface DocumentExtractorInput {
  filePath?: string;
  fileBuffer?: Buffer;
  fileName?: string;
}

interface DocumentExtractorParserParams {
  canHandle(input: DocumentExtractorInput): boolean;
  extractText(input: DocumentExtractorInput): Promise<string>;
}

export type { DocumentExtractorInput, DocumentExtractorParserParams };
