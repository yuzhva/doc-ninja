/**
 * Waits for `task`, or until `signal` aborts: then rejects with the signal's
 * reason at once, and `task` goes on — for a task others share, or one whose
 * work is worth finishing anyway. Its failure after that is nobody's to hear
 * and is not reported as unhandled. Without a signal, it is `task`.
 */
function untilAborted<T>(
  task: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return task;

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });

    task
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export { untilAborted };
