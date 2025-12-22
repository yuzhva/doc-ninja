import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

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

  // Setup paths
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
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

    // Spawn Python script
    const scriptPath = path.join(
      __dirname,
      '../../scripts/slice_xlsx_for_chunks.py',
    );
    console.log('Spawning Python slicing script...');

    await new Promise<void>((resolve, reject) => {
      const pythonProcess = spawn(
        'python3',
        ['-u', scriptPath, inputFilePath, outputDir, JSON.stringify(config)], // show logs
        // [scriptPath, inputFilePath, outputDir, JSON.stringify(config)], // without logs
        { env: process.env },
      );

      pythonProcess.stdout.on('data', (data) => {
        const str = data.toString();
        if (!str.startsWith('JSON_RESULT:')) {
          console.log(`Python: ${str.trim()}`);
        }
      });

      pythonProcess.stderr.on('data', (data) =>
        console.error(`Python Error: ${data}`),
      );

      pythonProcess.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Python script exited with code ${code}`));
      });
    });

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
