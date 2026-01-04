import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Extract date from file path with multiple strategies
 */
function extractDateFromPath(filePath: string): Date | null {
  const basename = path.basename(filePath);

  // Strategy 1: DD.MM.YYYY format
  const dateMatch = basename.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dateMatch) {
    const [, day, month, year] = dateMatch;
    return new Date(`${year}-${month}-${day}`);
  }

  // Strategy 2: YYYY-MM-DD format
  const isoMatch = basename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(isoMatch[0]);
  }

  // Strategy 3: 4-digit year in path
  const yearMatch = filePath.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    return new Date(yearMatch[1]);
  }

  return null;
}

async function safeWriteFile(filePath: string, content: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot write file ${path.basename(filePath)}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

export { extractDateFromPath, safeWriteFile };
