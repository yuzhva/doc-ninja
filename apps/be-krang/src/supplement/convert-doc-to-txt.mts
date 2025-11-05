import fs from 'fs/promises';
import mammoth from 'mammoth';
import path from 'path';
import textract from 'textract';

/**
 * Converts a single .doc/.docx file into .txt content
 */
async function convertDocViaRawTextToTxt(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.docx') {
    const buffer = await fs.readFile(filePath);
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }

  if (ext === '.doc') {
    return new Promise((resolve, reject) => {
      textract.fromFileWithPath(filePath, (err: Error | null, text: string) => {
        if (err) reject(err);
        else resolve(text);
      });
    });
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

/**
 * Converts a single .doc/.docx file into .txt content with preserved formatting
 */
async function convertDocViaHtmlToTxt(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.docx') {
    const buffer = await fs.readFile(filePath);

    // Use convertToHtml to preserve structure, then convert to clean text
    const { value: html } = await mammoth.convertToHtml({ buffer });

    // Convert HTML to text while preserving paragraph structure
    return html
      .replace(/<p[^>]*>/g, '') // Remove opening <p> tags
      .replace(/<\/p>/g, '\n\n') // Replace closing </p> with double newlines
      .replace(/<br\s*\/?>/g, '\n') // Replace <br> with single newlines
      .replace(/<h[1-6][^>]*>/g, '') // Remove heading opening tags
      .replace(/<\/h[1-6]>/g, '\n\n') // Replace heading closing with double newlines
      .replace(/<li[^>]*>/g, '• ') // Replace list items with bullets
      .replace(/<\/li>/g, '\n') // End list items with newlines
      .replace(/<ul[^>]*>|<\/ul>/g, '\n') // Handle unordered lists
      .replace(/<ol[^>]*>|<\/ol>/g, '\n') // Handle ordered lists
      .replace(/<div[^>]*>/g, '') // Remove div opening tags
      .replace(/<\/div>/g, '\n') // Replace div closing with newlines
      .replace(/<[^>]*>/g, '') // Remove all remaining HTML tags
      .replace(/&nbsp;/g, ' ') // Replace non-breaking spaces
      .replace(/&amp;/g, '&') // Replace HTML entities
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\n\s*\n\s*\n/g, '\n\n') // Collapse multiple newlines to double
      .replace(/^\s+|\s+$/g, '') // Trim whitespace from start/end
      .trim();
  }

  if (ext === '.doc') {
    return new Promise<string>((resolve, reject) => {
      // Configure textract to preserve line breaks and formatting
      const options = {
        preserveLineBreaks: true,
        exec: {
          maxBuffer: 1024 * 1024 * 10, // 10MB buffer for large files
        },
      };

      textract.fromFileWithPath(
        filePath,
        options,
        (err: Error | null, text: string) => {
          if (err) {
            reject(err);
          } else {
            // Clean up the extracted text while preserving structure
            const cleanedText = (text || '')
              .replace(/\r\n/g, '\n') // Normalize line endings
              .replace(/\r/g, '\n') // Convert remaining \r to \n
              .replace(/\n\s*\n\s*\n/g, '\n\n') // Collapse multiple newlines
              .replace(/^\s+|\s+$/g, '') // Trim whitespace
              .trim();

            resolve(cleanedText);
          }
        },
      );
    });
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

/**
 * Enhanced version that works with both file paths and buffers
 */
async function convertDocViaHtmlToTxtAdvanced(
  input: string | Buffer,
  fileName?: string,
): Promise<{ text: string; metadata?: any }> {
  let buffer: Buffer;
  let filePath: string | undefined;

  if (Buffer.isBuffer(input)) {
    buffer = input;
    filePath = fileName;
  } else {
    buffer = await fs.readFile(input);
    filePath = input;
  }

  const ext = fileName
    ? path.extname(fileName).toLowerCase()
    : path.extname(filePath || '').toLowerCase();

  if (ext === '.docx') {
    // Extract both text and metadata
    const result = await mammoth.convertToHtml({
      buffer,
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
      ],
    });

    const text = result.value
      .replace(/<h([1-6])[^>]*>/g, '\n=== HEADING $1 ===\n')
      .replace(/<\/h[1-6]>/g, '\n')
      .replace(/<p[^>]*>/g, '')
      .replace(/<\/p>/g, '\n\n')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();

    return {
      text,
      metadata: {
        messages: result.messages,
        originalFile: filePath || fileName || 'uploaded-file',
        extractedAt: new Date().toISOString(),
      },
    };
  }

  // For .doc files, we need the file path approach
  if (ext === '.doc') {
    if (!filePath) {
      throw new Error('.doc files require file system processing');
    }
    const text = await convertDocViaHtmlToTxt(filePath);
    return {
      text,
      metadata: {
        originalFile: filePath,
        extractedAt: new Date().toISOString(),
      },
    };
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

export {
  convertDocViaHtmlToTxt,
  convertDocViaHtmlToTxtAdvanced,
  convertDocViaRawTextToTxt,
};
