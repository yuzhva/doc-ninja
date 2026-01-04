import { useCallback, useState } from 'react';

import type {
  PickDirectoryOptions,
  PickFileOptions,
} from '../utils/file-system-bridge';
import { FileSystemBridge } from '../utils/file-system-bridge';

function useFilePicker(options: PickFileOptions = {}) {
  const [processedDir, setFile] = useState<Awaited<
    ReturnType<typeof FileSystemBridge.pickFile>
  > | null>(null);

  const selectFile = useCallback(async () => {
    const pickedResult = await FileSystemBridge.pickFile(options);
    if (pickedResult) {
      setFile(pickedResult);
    }
  }, [options]);

  return {
    processedDir,
    selectFile,
    isSupported: FileSystemBridge.isSupported(),
  };
}

function useDirectoryPicker(options: PickDirectoryOptions = {}) {
  const [processedDir, setDirectory] = useState<Awaited<
    ReturnType<typeof FileSystemBridge.pickDirectory>
  > | null>(null);

  const selectDirectory = useCallback(async () => {
    const pickedResult = await FileSystemBridge.pickDirectory(options);
    if (pickedResult) {
      setDirectory(pickedResult);
    }
  }, [options]);

  return {
    processedDir,
    selectDirectory,
    isSupported: FileSystemBridge.isSupported(),
  };
}

type UseFilePicker = ReturnType<typeof useFilePicker>;
type UseDirectoryPicker = ReturnType<typeof useDirectoryPicker>;

export { useDirectoryPicker, useFilePicker };
export type { UseDirectoryPicker, UseFilePicker };
