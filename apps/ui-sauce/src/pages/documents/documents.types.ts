import type { FormEvent } from 'react';

import type {
  UseDirectoryPicker,
  UseFilePicker,
} from '../../hooks/use-file-system';
import type { BatchFile } from '../../utils/file-system-processor';
import type { BatchProcessorHookOptions } from './use-batch-processor';

interface FormPageSectionProps {
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
  onSelectSourceDirectory: () => void;
  onSelectOutputDirectory: () => void;
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

export { FormPageSectionProps };
