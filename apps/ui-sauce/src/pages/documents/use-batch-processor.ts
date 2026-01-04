import { useCallback, useState } from 'react';
import type { FileSystemProcessedResult } from 'toolkit--local/browser';

import type { UseDirectoryPicker } from '../../hooks/use-file-system';
import type {
  BatchFile,
  FSBatchProcessorOptions,
  WriteFilesViaDestinationHandle,
} from '../../utils/file-system-processor';
import { FileSystemAPIProcessor } from '../../utils/file-system-processor';

interface BatchProcessorHookOptions extends Pick<
  FSBatchProcessorOptions,
  'subfolderPath' | 'isWritingFilesSkipped'
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
          files: [{} as any],
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
export type { BatchProcessorHookOptions };
