import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

interface DocumentInput {
  filePath?: string;
  fileBuffer?: Buffer;
  fileName?: string;
}

// Helper to get extension for checks
function getExtension(input: DocumentInput): string {
  if (input.fileName) {
    return path.extname(input.fileName).toLowerCase();
  }
  if (input.filePath) {
    return path.extname(input.filePath).toLowerCase();
  }
  return '';
}

// Helper to ensure we have a buffer
async function getBufferFromInput(input: DocumentInput): Promise<Buffer> {
  let buffer: Buffer;
  if (input.fileBuffer) {
    buffer = input.fileBuffer;
  } else if (input.filePath) {
    buffer = await promisify(fs.readFile)(input.filePath);
  } else {
    throw new Error('Invalid input: neither fileBuffer nor filePath provided');
  }

  // Auto-detect and decode Base64 content for binary formats
  // This fixes issues where files are uploaded as Base64 strings inside Blobs
  const ext = getExtension(input);
  if ((ext === '.docx' || ext === '.doc') && buffer.length > 4) {
    const header = buffer.subarray(0, 4).toString();
    // DOCX/ZIP starts with 'PK..' -> Base64 'UEsD'
    // DOC/OLE starts with D0CF11E0 -> Base64 '0M8R'
    if (header === 'UEsD' || header === '0M8R') {
      try {
        const decoded = Buffer.from(buffer.toString(), 'base64');
        if (decoded.length > 0) {
          return decoded;
        }
      } catch (e) {
        // Ignore invalid base64, return original buffer
      }
    }
  }

  return buffer;
}

export { getBufferFromInput, getExtension };

export type { DocumentInput };
