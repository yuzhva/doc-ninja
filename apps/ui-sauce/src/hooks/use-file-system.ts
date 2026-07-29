import { useCallback, useRef, useState } from 'react';

import type {
  PickDirectoryOptions,
  PickFileOptions,
} from '../utils/file-system-bridge';
import { FileSystemBridge } from '../utils/file-system-bridge';

function useFilePicker(options: PickFileOptions = {}) {
  const [processedDir, setFile] = useState<Awaited<
    ReturnType<typeof FileSystemBridge.pickFile>
  > | null>(null);
  // Distinguishes "user cancelled" (null, no error — expected, stay quiet)
  // from a genuine failure a caller may want to surface to the user.
  const [error, setError] = useState<Error | null>(null);

  // A picker rejecting (permission denied, OS-level failure, ...) must never
  // become an unhandled rejection in whatever onClick called this — every
  // consumer across the app relies on selectFile() always resolving.
  // FileSystemBridge already logs non-cancel failures, so just swallow here.
  const selectFile = useCallback(async () => {
    setError(null);
    try {
      const pickedResult = await FileSystemBridge.pickFile(options);
      if (pickedResult) {
        setFile(pickedResult);
      }
      return pickedResult;
    } catch (err: any) {
      setError(err);
      return null;
    }
  }, [options]);

  // Drops a stale/broken pick (e.g. permission revoked after the fact) so
  // the next selectFile() call re-prompts instead of a caller silently
  // reusing a handle that's known to no longer work.
  const reset = useCallback(() => {
    setFile(null);
    setError(null);
  }, []);

  return {
    processedDir,
    selectFile,
    reset,
    error,
    isSupported: FileSystemBridge.isSupported(),
  };
}

function useDirectoryPicker(options: PickDirectoryOptions = {}) {
  const [processedDir, setDirectory] = useState<Awaited<
    ReturnType<typeof FileSystemBridge.pickDirectory>
  > | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // Mirrors `error`, but updates synchronously — a caller that awaits
  // selectDirectory() and immediately checks for a failure in the same
  // function is reading a closure captured at the render *before* this
  // call, so the `error` state above would still show last call's value
  // until the next render. `errorRef.current` is the same object across
  // renders, so mutating it here is visible immediately, same call.
  const errorRef = useRef<Error | null>(null);

  // Same reasoning as useFilePicker.selectFile above.
  const selectDirectory = useCallback(async () => {
    setError(null);
    errorRef.current = null;
    try {
      const pickedResult = await FileSystemBridge.pickDirectory(options);
      if (pickedResult) {
        setDirectory(pickedResult);
      }
      return pickedResult;
    } catch (err: any) {
      setError(err);
      errorRef.current = err;
      return null;
    }
  }, [options]);

  const reset = useCallback(() => {
    setDirectory(null);
    setError(null);
    errorRef.current = null;
  }, []);

  return {
    processedDir,
    selectDirectory,
    reset,
    error,
    errorRef,
    isSupported: FileSystemBridge.isSupported(),
  };
}

type UseFilePicker = ReturnType<typeof useFilePicker>;
type UseDirectoryPicker = ReturnType<typeof useDirectoryPicker>;

export { useDirectoryPicker, useFilePicker };
export type { UseDirectoryPicker, UseFilePicker };
