import { useCallback, useRef, useState } from 'react';

import type {
  PickDirectoryOptions,
  PickFileOptions,
} from '../utils/file-system-bridge';
import { FileSystemBridge } from '../utils/file-system-bridge';

// Shared shape behind useFilePicker/useDirectoryPicker below — both are just
// "call this one imperative pick function, track its result/error." A picker
// rejecting (permission denied, OS-level failure, ...) must never become an
// unhandled rejection in whatever onClick called select(); every consumer
// across the app relies on it always resolving. FileSystemBridge already
// logs non-cancel failures, so just swallow here.
function usePicker<T>(pick: () => Promise<T | null>) {
  const [processedDir, setValue] = useState<T | null>(null);
  // Distinguishes "user cancelled" (null, no error — expected, stay quiet)
  // from a genuine failure a caller may want to surface to the user.
  const [error, setError] = useState<Error | null>(null);
  // Mirrors `error`, but updates synchronously — a caller that awaits
  // select() and immediately checks for a failure in the same function is
  // reading a closure captured at the render *before* this call, so the
  // `error` state above would still show last call's value until the next
  // render. `errorRef.current` is the same object across renders, so
  // mutating it here is visible immediately, same call.
  const errorRef = useRef<Error | null>(null);

  // Runs any way of getting a value (a picker dialog, a drop, ...) with the
  // same result/error tracking. `getValue` is called synchronously — a drop
  // depends on that (see FileSystemBridge.readDroppedFile).
  const run = useCallback(async (getValue: () => Promise<T | null>) => {
    setError(null);
    errorRef.current = null;
    try {
      const result = await getValue();
      if (result) {
        setValue(result);
      }
      return result;
    } catch (err: any) {
      setError(err);
      errorRef.current = err;
      return null;
    }
  }, []);

  const select = useCallback(() => run(pick), [run, pick]);

  // Drops a stale/broken pick (e.g. permission revoked after the fact) so
  // the next select() call re-prompts instead of a caller silently reusing
  // a handle that's known to no longer work.
  const reset = useCallback(() => {
    setValue(null);
    setError(null);
    errorRef.current = null;
  }, []);

  return {
    processedDir,
    select,
    run,
    reset,
    error,
    errorRef,
    isSupported: FileSystemBridge.isSupported(),
  };
}

function useFilePicker(options: PickFileOptions = {}) {
  const pick = useCallback(() => FileSystemBridge.pickFile(options), [options]);
  const { select: selectFile, run, ...rest } = usePicker(pick);

  // Call straight from the `drop` handler, without awaiting anything first.
  const selectDroppedFile = useCallback(
    (dataTransfer: DataTransfer) =>
      run(() => FileSystemBridge.readDroppedFile(dataTransfer)),
    [run],
  );

  return { ...rest, selectFile, selectDroppedFile };
}

function useDirectoryPicker(options: PickDirectoryOptions = {}) {
  const pick = useCallback(
    () => FileSystemBridge.pickDirectory(options),
    [options],
  );
  const { select: selectDirectory, run, ...rest } = usePicker(pick);

  // Opens the picker in the folder of `startIn` (a file handle opens in the
  // file's own folder). A separate function rather than an argument of
  // selectDirectory, which is passed straight to onClick and would receive
  // the click event.
  const selectDirectoryStartingIn = useCallback(
    (startIn: FileSystemHandle | null | undefined) =>
      run(() =>
        FileSystemBridge.pickDirectory(
          startIn ? { ...options, startIn } : options,
        ),
      ),
    [run, options],
  );

  return { ...rest, selectDirectory, selectDirectoryStartingIn };
}

type UseFilePicker = ReturnType<typeof useFilePicker>;
type UseDirectoryPicker = ReturnType<typeof useDirectoryPicker>;

export { useDirectoryPicker, useFilePicker };
export type { UseDirectoryPicker, UseFilePicker };
