import * as fs from 'fs';
// Import document parsing libraries
import * as mammoth from 'mammoth';
import * as path from 'path';
import { promisify } from 'util';
import WordExtractor from 'word-extractor';

interface ExtractionResult {
  text: string;
  originalPath: string;
  extractedPath?: string;
}

class DocumentExtractor {
  private supportedExtensions = new Set(['.doc', '.docx', '.txt', '.md']);

  constructor() {}

  /**
   * Extract text from a document file
   */
  async extractText(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();

    if (!this.supportedExtensions.has(ext)) {
      throw new Error(`Unsupported file type: ${ext}`);
    }

    try {
      switch (ext) {
        case '.docx':
          return await this.extractFromDocx(filePath);
        case '.doc':
          return await this.extractFromDoc(filePath);
        case '.txt':
        case '.md':
          return await this.extractFromText(filePath);
        default:
          throw new Error(`No handler for file type: ${ext}`);
      }
    } catch (error) {
      throw new Error(
        `Failed to extract text from ${path.basename(filePath)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Extract text from .docx files using mammoth
   */
  private async extractFromDocx(filePath: string): Promise<string> {
    try {
      const buffer = await promisify(fs.readFile)(filePath);
      const result = await mammoth.extractRawText({ buffer });

      if (result.messages.length > 0) {
        // Log warnings but don't fail
        console.warn(
          `Mammoth warnings for ${path.basename(filePath)}:`,
          result.messages,
        );
      }

      return result.value || '';
    } catch (error) {
      throw new Error(
        `DOCX extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Extract text from .doc files using word-extractor
   */
  private async extractFromDoc(filePath: string): Promise<string> {
    if (!WordExtractor) {
      throw new Error(
        'word-extractor library not available for .doc files. Please install: npm install word-extractor',
      );
    }

    try {
      const extractor = new WordExtractor();
      const extracted = await extractor.extract(filePath);
      return extracted.getBody() || '';
    } catch (error) {
      throw new Error(
        `DOC extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Extract text from plain text files
   */
  private async extractFromText(filePath: string): Promise<string> {
    try {
      return await promisify(fs.readFile)(filePath, 'utf8');
    } catch (error) {
      throw new Error(
        `Text file reading failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Convert document to .txt file and return the text content
   */
  async convertToTextFile(
    filePath: string,
    outputDir?: string,
  ): Promise<ExtractionResult> {
    const text = await this.extractText(filePath);

    // Generate output path with .txt extension
    const baseName = path.basename(filePath, path.extname(filePath));
    const txtFileName = `${baseName}.txt`;
    const txtPath = outputDir
      ? path.join(outputDir, txtFileName)
      : path.join(path.dirname(filePath), txtFileName);

    // Ensure output directory exists
    await fs.promises.mkdir(path.dirname(txtPath), { recursive: true });

    // Write text to .txt file
    await promisify(fs.writeFile)(txtPath, text, 'utf8');

    return {
      text,
      originalPath: filePath,
      extractedPath: txtPath,
    };
  }

  /**
   * Check if file type is supported
   */
  isSupported(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedExtensions.has(ext);
  }

  /**
   * Get list of supported file extensions
   */
  getSupportedExtensions(): string[] {
    return Array.from(this.supportedExtensions);
  }

  /**
   * Batch extract text from multiple files
   */
  async extractTextBatch(filePaths: string[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();

    const promises = filePaths.map(async (filePath) => {
      try {
        const text = await this.extractText(filePath);
        results.set(filePath, text);
      } catch (error) {
        console.error(`Failed to extract ${filePath}:`, error);
        results.set(filePath, ''); // Set empty string for failed extractions
      }
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * Get document metadata without full extraction
   */
  async getDocumentInfo(filePath: string): Promise<{
    fileName: string;
    fileSize: number;
    extension: string;
    isSupported: boolean;
    lastModified: number;
  }> {
    const stats = await promisify(fs.stat)(filePath);
    const ext = path.extname(filePath).toLowerCase();

    return {
      fileName: path.basename(filePath),
      fileSize: stats.size,
      extension: ext,
      isSupported: this.isSupported(filePath),
      lastModified: stats.mtimeMs,
    };
  }
}

export { DocumentExtractor, ExtractionResult };
