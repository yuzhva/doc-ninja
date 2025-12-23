import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { executePythonScript } from '../../python-scripts/python-executor.mjs';
import type { ChunkFile, SliceOptions } from './doc-to-chunks.types.ts';

const sliceDocumentForChunks = async ({
  buffer,
  originalFileName = 'file.xlsx',
  sheetToChunkPosition = 1,
  headerRows = 1,
  splitColumnPosition = 1,
  maxColumnsToInclude,
  filenameSuffix,
  chunkNamePattern,
  includeHiddenSheets = false,
  additionalSheets = [],
}: SliceOptions): Promise<ChunkFile[]> => {
  const startTime = Date.now();

  const tempDir = os.tmpdir();
  const timestamp = Date.now();
  const runId = Math.random().toString(36).substring(7);

  const ext = path.extname(originalFileName) || '.xlsx';
  const inputFilePath = path.join(tempDir, `input_${timestamp}_${runId}${ext}`);
  const outputDir = path.join(tempDir, `output_${timestamp}_${runId}`);

  try {
    console.log(`🚀 Starting to slice Excel document (Python/openpyxl)`);
    console.log(`⏱️ Started at: ${new Date().toLocaleTimeString()}`);

    // Write buffer to temp file
    await fs.writeFile(inputFilePath, buffer);
    await fs.mkdir(outputDir, { recursive: true });

    // Prepare config
    const config = {
      sheetToChunkPosition,
      headerRows,
      splitColumnPosition,
      maxColumnsToInclude,
      filenameSuffix,
      chunkNamePattern,
      includeHiddenSheets,
      additionalSheets,
    };

    console.log('Spawning slicing process...');

    await executePythonScript(
      'slice_xlsx_for_chunks',
      [inputFilePath, outputDir, JSON.stringify(config)],
      {
        onLog: (str) => {
          if (!str.startsWith('JSON_RESULT:')) {
            console.log(`Python: ${str.trim()}`);
          }
        },
        onError: (str) => console.error(`Python Error: ${str}`),
      },
    );

    // Read generated files
    const files = await fs.readdir(outputDir);
    const chunkFiles: ChunkFile[] = [];

    for (const file of files) {
      // Accept both .xlsx and .xlsm files
      if (!file.endsWith('.xlsx') && !file.endsWith('.xlsm')) continue;

      const filePath = path.join(outputDir, file);
      const content = await fs.readFile(filePath);

      chunkFiles.push({
        name: file,
        content,
        relativePath: file,
      });
    }

    const totalTime = Date.now() - startTime;
    console.log(`✅ Slicing complete. ${chunkFiles.length} chunk(s) prepared.`);
    console.log(`⏱️ Total time: ${totalTime}ms`);

    return chunkFiles;
  } catch (error) {
    console.error('❌ Error slicing document:', error);
    throw error;
  } finally {
    // Cleanup
    await fs.unlink(inputFilePath).catch(() => {});
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
};

export { sliceDocumentForChunks as sliceDocumentForChunksViaPythonScript };
