import fs from 'fs/promises';
import mammoth from 'mammoth';
import path from 'path';
import textract from 'textract';

/**
 * Converts a single .doc/.docx file into .txt content
 */
async function convertDocToTxt(filePath: string) {
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
export { convertDocToTxt };
