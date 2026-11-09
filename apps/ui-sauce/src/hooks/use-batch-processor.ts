import type { FormEvent } from 'react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  BatchFile,
  FSBatchProcessorOptions,
  WriteFilesViaDestinationHandle,
} from '../utils/file-system-processor';
import { FileSystemAPIProcessor } from '../utils/file-system-processor';
import { NotificationBridge } from '../utils/notification-bridge';
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
  // Shown once the run was cancelled (see useBatchProcessor's `cancel`)
  cancelledMessage?: string;
}

// One batch's request. `signal` aborts once the run is cancelled: hand it to
// fetchRequest, and the request stops.
type BatchApiCall = (
  batchFiles: BatchFile[],
  batchIndex: number,
  totalBatches: number,
  structure: any,
  signal: AbortSignal,
) => Promise<any>;

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
    apiCall: BatchApiCall,
  ) => Promise<void>;
  initSubmitHandler: (
    fn: (data: { [k: string]: FormDataEntryValue }) => Promise<any>,
  ) => (e: FormEvent<HTMLFormElement>) => void;
}

function useBatchProcessor(
  addToast: (type: 'success' | 'error' | 'warning', msg: string) => void,
) {
  const { t } = useTranslation();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({
    current: 0,
    total: 0,
    batch: 0,
  });
  // The run in progress is cancelled by this
  const abortControllerRef = useRef<AbortController | null>(null);

  // Stops the run in progress: its request is cancelled, and execute()
  // reports it cancelled, not done
  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const execute = useCallback(
    async (options: BatchProcessorHookOptions, apiCall: BatchApiCall) => {
      const {
        processedDir,
        destinationHandle,
        cancelledMessage,
        ...executeBatchParams
      } = options;

      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      const { signal } = abortController;

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
          // executeBatch counts a batch that throws as failed, logs it as an
          // error and goes on: a cancelled one is neither, so it comes back
          // as nothing done, and the check below reports the cancel
          async (batchFiles, batchIndex, totalBatches, structure) => {
            if (signal.aborted) return {};
            try {
              return await apiCall(
                batchFiles,
                batchIndex,
                totalBatches,
                structure,
                signal,
              );
            } catch (error) {
              if (signal.aborted) return {};
              throw error;
            }
          },
        );

        // A cancelled run comes back from executeBatch as done: it isn't
        signal.throwIfAborted();

        addToast('success', result.message);
        NotificationBridge.notify(result.message);
      } catch (error) {
        // The user cancelled it, in the app: no system notification
        if (signal.aborted) {
          addToast(
            'warning',
            cancelledMessage || t('component.batchProcessor.cancelledMessage'),
          );
          return;
        }

        console.error('Processing failed:', error);
        const msg = `❌ ${t('component.batchProcessor.failedMessage')}`;
        addToast('error', msg);
        NotificationBridge.notify(msg);
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
        setIsProcessing(false);
      }
    },
    [addToast, t],
  );

  return { execute, cancel, isProcessing, progress };
}

export { useBatchProcessor };
export type { BatchFileProcessingSectionProps, BatchProcessorHookOptions };
