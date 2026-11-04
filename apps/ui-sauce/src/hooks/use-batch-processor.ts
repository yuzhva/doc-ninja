import type { FormEvent } from 'react';
import { useCallback, useState } from 'react';

import type {
  BatchFile,
  FSBatchProcessorOptions,
  WriteFilesViaDestinationHandle,
} from '../utils/file-system-processor';
import { FileSystemAPIProcessor } from '../utils/file-system-processor';
import type { UseDirectoryPicker, UseFilePicker } from './use-file-system';

interface BatchProcessorHookOptions extends Pick<
  FSBatchProcessorOptions,
  'subfolderPath' | 'isWritingFilesSkipped' | 'isLocalFileSystemRequest'
> {
  formDataJSON: any;
  processedDir: Omit<
    NonNullable<UseDirectoryPicker['processedDir']>,
    'browserFSAPIhandle'
  >;
  destinationHandle: WriteFilesViaDestinationHandle;
  validationMessage: string;
  successMessage: string;
}

// The prop contract handed down to a page section that wires up
// useDirectoryPicker + useFilePicker + useBatchProcessor together (both
// ProcessPage and SearchPage's tab items/panes follow this same pattern).
interface BatchFileProcessingSectionProps {
  sourceDirectory: UseDirectoryPicker['processedDir'];
  outputDirectory: UseDirectoryPicker['processedDir'];
  selectedFile: UseFilePicker['processedDir'];
  progress: {
    current: number;
    total: number;
    batch: number;
  };
  isFileSystemAccessSupported: boolean;
  isProcessing: boolean;
  onSelectFile: () => void;
  // The same as onSelectFile, for a file dropped onto the page — call it
  // synchronously from the `drop` handler.
  onDropFile?: (dataTransfer: DataTransfer) => void;
  onSelectSourceDirectory: () => void;
  onSelectOutputDirectory: () => void;
  // The same as onSelectOutputDirectory, opening the picker in the folder of
  // `startIn` (e.g. the selected file's own folder).
  onSelectOutputDirectoryStartingIn?: (
    startIn: FileSystemHandle | null | undefined,
  ) => void;
  executeBatch: (
    options: BatchProcessorHookOptions,
    apiCall: (
      batchFiles: BatchFile[],
      batchIndex: number,
      totalBatches: number,
      structure: any,
    ) => Promise<any>,
  ) => Promise<void>;
  initSubmitHandler: (
    fn: (data: { [k: string]: FormDataEntryValue }) => Promise<any>,
  ) => (e: FormEvent<HTMLFormElement>) => void;
}

function useBatchProcessor(
  addToast: (type: 'success' | 'error' | 'warning', msg: string) => void,
) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({
    current: 0,
    total: 0,
    batch: 0,
  });

  const execute = useCallback(
    async (
      options: BatchProcessorHookOptions,
      apiCall: (
        batchFiles: BatchFile[],
        batchIndex: number,
        totalBatches: number,
        structure: any,
      ) => Promise<any>,
    ) => {
      const { processedDir, destinationHandle, ...executeBatchParams } =
        options;

      setIsProcessing(true);
      setProgress({ current: 0, total: 0, batch: 0 });

      try {
        // --- Source is already processed (Unified Object) ---
        // Use processedDir directly or fallback to empty structure
        const source = processedDir || {
          // TODO: delete workaround to make API call when there is no FileSelector
          files: [{}],
          // files: [],
          structure: {
            name: 'root',
            path: '/',
            fsItemType: 'directory',
            fsNestedItems: [],
          },
        };

        // --- Execute Service ---
        const result = await FileSystemAPIProcessor.executeBatch(
          source,
          destinationHandle,
          {
            ...executeBatchParams,
            onProgress: setProgress,
          },
          apiCall,
        );

        addToast('success', result.message);
        if (window.document.hidden) new Notification(result.message);
      } catch (error) {
        console.error('Processing failed:', error);
        const msg = '❌ Processing failed. Check console for details.';
        addToast('error', msg);
        if (window.document.hidden) new Notification(msg);
      } finally {
        setIsProcessing(false);
      }
    },
    [addToast],
  );

  return { execute, isProcessing, progress };
}

export { useBatchProcessor };
export type { BatchFileProcessingSectionProps, BatchProcessorHookOptions };
