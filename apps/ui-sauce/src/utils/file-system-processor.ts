import type { FileSystemProcessedResult } from 'toolkit--local/browser';
import { FileSystemService } from 'toolkit--local/browser';

import type { UseDirectoryPicker } from '../hooks/use-file-system';

type WriteFilesViaDestinationHandle = NonNullable<
  NonNullable<UseDirectoryPicker['processedDir']>['browserFSAPIhandle']
>;

interface APIResponseFileData {
  name: string;
  content: string;
  relativePath: string;
  originalPath?: string;
}

interface FSBatchProcessorOptions {
  subfolderPath?: FormDataEntryValue | string | undefined;
  successMessage?: string;
  isWritingFilesSkipped?: boolean;
  onProgress?: (progress: {
    current: number;
    total: number;
    batch: number;
  }) => void;
}

interface FSBatchExecutionResult {
  totalProcessed: number;
  totalFailed: number;
  allErrors: any[];
  message: string;
}

type BatchFile = FileSystemProcessedResult['files'][0] & {
  contentAsBlob: Blob;
};

class FileSystemAPIProcessor {
  /**
   * Write processed files back to file system maintaining structure
   */
  static async writeProcessedFiles(
    processedFiles: APIResponseFileData[],
    destinationHandle: WriteFilesViaDestinationHandle,
    subfolderPath?: FSBatchProcessorOptions['subfolderPath'],
  ): Promise<void> {
    for (const file of processedFiles) {
      await this.writeFileToPath(file, destinationHandle, subfolderPath);
    }
  }

  /**
   * Helper: Write a single file to the correct path in destination
   */
  private static async writeFileToPath(
    file: APIResponseFileData,
    destinationHandle: WriteFilesViaDestinationHandle,
    subfolderPath?: FSBatchProcessorOptions['subfolderPath'],
  ): Promise<void> {
    // Start with the destination handle
    let currentDir = destinationHandle;

    // Create subfolder structure if specified (handle nested paths)
    if (subfolderPath) {
      const subfolderParts = subfolderPath
        .toString()
        .split('/')
        .filter((part) => part !== '');

      for (const folderName of subfolderParts) {
        try {
          currentDir = await currentDir.getDirectoryHandle(folderName, {
            create: true,
          });
          console.log(`📁 Created/using subfolder: ${folderName}`);
        } catch (error) {
          console.warn(`Could not create subfolder '${folderName}':`, error);
          break; // Stop creating nested folders if one fails
        }
      }
    }

    // Parse the file's relative path to navigate/create directory structure
    const pathParts = file.relativePath
      .split('/')
      .filter((part) => part !== '');
    const fileName = pathParts.pop()!;

    // Navigate/create nested directories from the file's original structure
    for (const dirName of pathParts) {
      try {
        currentDir = await currentDir.getDirectoryHandle(dirName, {
          create: true,
        });
      } catch (error) {
        console.warn(`Could not create directory ${dirName}:`, error);
      }
    }

    // Write the file
    const fileHandle = await currentDir.getFileHandle(fileName, {
      create: true,
    });
    const writable = await fileHandle.createWritable();

    // Check if content is base64 (for binary files like Excel)
    const fileExtension =
      FileSystemService.getFileExtension(fileName).toLowerCase(); // Use toolkit method
    const isBinaryFile = [
      'xlsx',
      'xlsm',
      'xlsb',
      'xls',
      'docx',
      'pdf',
      'png',
      'jpg',
      'jpeg',
    ].includes(fileExtension);

    if (isBinaryFile && this.isBase64String(file.content)) {
      // Convert base64 to binary data for Excel/binary files
      try {
        const binaryString = atob(file.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Create blob with appropriate MIME type
        const mimeType = this.getMimeType(fileExtension);
        const blob = new Blob([bytes], { type: mimeType });

        await writable.write(blob);
        console.log(
          `✅ Binary file written: ${fileName} (${bytes.length} bytes)`,
        );
      } catch (error) {
        console.error(`❌ Failed to decode base64 for ${fileName}:`, error);
        // Fallback to text writing
        await writable.write(file.content);
      }
    } else {
      // Write as text for non-binary files
      await writable.write(file.content);
    }

    await writable.close();
  }

  /**
   * Helper: Check if string is base64 encoded
   */
  private static isBase64String(str: string): boolean {
    try {
      // Basic check: base64 strings are typically long and contain only valid base64 characters
      return (
        str.length > 100 &&
        /^[A-Za-z0-9+/=]+$/.test(str) &&
        str.length % 4 === 0
      );
    } catch {
      return false;
    }
  }

  /**
   * Helper: Get MIME type for file extension
   */
  private static getMimeType(extension: string): string {
    const mimeTypes: Record<string, string> = {
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
      xlsb: 'application/vnd.ms-excel.sheet.macroEnabled.12',
      xls: 'application/vnd.ms-excel',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      txt: 'text/plain',
    };

    return mimeTypes[extension] || 'application/octet-stream';
  }

  static async executeBatch(
    processedDir: Omit<
      NonNullable<UseDirectoryPicker['processedDir']>,
      'browserFSAPIhandle'
    >,
    destinationHandle: WriteFilesViaDestinationHandle,
    options: FSBatchProcessorOptions,
    apiCall: (
      batchFiles: BatchFile[],
      batchIndex: number,
      totalBatches: number,
      structure: any,
    ) => Promise<any>,
  ): Promise<FSBatchExecutionResult> {
    const { subfolderPath, successMessage, isWritingFilesSkipped, onProgress } =
      options;

    try {
      const result = processedDir;
      console.log(`Processing ${result.files.length} files`);

      const BATCH_SIZE = 50;
      const batches: any[][] = [];
      for (let i = 0; i < result.files.length; i += BATCH_SIZE) {
        batches.push(result.files.slice(i, i + BATCH_SIZE));
      }

      let totalProcessed = 0;
      let totalFailed = 0;
      const allErrors: any[] = [];

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchIndex = i + 1;

        if (onProgress) {
          onProgress({
            current: totalProcessed + totalFailed,
            total: result.files.length,
            batch: batchIndex,
          });
        }

        try {
          // Pre-fetch content for all files in the batch to stay DRY
          const enrichedBatch = await Promise.all(
            batch.map(async (file: any) => {
              if (typeof file.getFileContent === 'function') {
                const content = await file.getFileContent();
                return { ...file, contentAsBlob: new Blob([content]) };
              }

              return file;
            }),
          );

          const response = await apiCall(
            enrichedBatch,
            batchIndex,
            batches.length,
            result.structure,
          );

          console.log(`Batch ${batchIndex} response:`, response);

          if (response.processedFiles?.length > 0 && !isWritingFilesSkipped) {
            await this.writeProcessedFiles(
              response.processedFiles,
              destinationHandle,
              subfolderPath,
            );
          }

          totalProcessed += response.processedFiles?.length || 0;
          if (response.failedFiles?.length > 0) {
            totalFailed += response.failedFiles.length;
            allErrors.push(...response.failedFiles);
          }
        } catch (error: any) {
          console.error(`Batch ${batchIndex} failed:`, error);
          totalFailed += batch.length;
          allErrors.push({ batch: batchIndex, error: error.message });
        }
      }

      const message =
        `✅ ${successMessage || 'Processing complete'}\n` +
        `📄 Successfully processed: ${totalProcessed}\n` +
        `❌ Failed: ${totalFailed}\n` +
        `📁 Files saved to selected output folder${
          subfolderPath ? ` (subfolder: ${subfolderPath})` : ''
        }.`;

      if (allErrors.length > 0) {
        console.warn('Processing errors:', allErrors);
      }

      return {
        totalProcessed,
        totalFailed,
        allErrors,
        message,
      };
    } catch (error: any) {
      console.error('Processing failed:', error);
      throw error;
    }
  }
}

export { FileSystemAPIProcessor };
export type {
  BatchFile,
  FSBatchProcessorOptions,
  WriteFilesViaDestinationHandle,
};
