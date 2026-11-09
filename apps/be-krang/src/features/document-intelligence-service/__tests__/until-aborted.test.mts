import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';

import { untilAborted } from '../until-aborted.mjs';

/** A task that ends when told to: `settle.resolve()` or `settle.reject()`. */
const pendingTask = () => {
  const settle = {} as {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  };
  const task = new Promise<string>((resolve, reject) => {
    settle.resolve = resolve;
    settle.reject = reject;
  });
  return { task, settle };
};

describe('untilAborted()', () => {
  it('is the task itself without a signal', () => {
    const { task } = pendingTask();
    assert.equal(untilAborted(task, undefined), task);
  });

  it('resolves and rejects as the task does while not aborted', async () => {
    const done = pendingTask();
    const waitingDone = untilAborted(done.task, new AbortController().signal);
    done.settle.resolve('indexed');
    assert.equal(await waitingDone, 'indexed');

    const failed = pendingTask();
    const waitingFailed = untilAborted(
      failed.task,
      new AbortController().signal,
    );
    failed.settle.reject(new Error('index failed'));
    await assert.rejects(waitingFailed, /index failed/);
  });

  it('rejects with the reason at once on abort, and leaves the task to go on', async () => {
    const { task, settle } = pendingTask();
    const controller = new AbortController();

    const waiting = untilAborted(task, controller.signal);
    controller.abort();

    await assert.rejects(waiting, { name: 'AbortError' });
    settle.resolve('indexed');
    assert.equal(await task, 'indexed');
  });

  it('rejects at once for a signal aborted already', async () => {
    const { task } = pendingTask();
    await assert.rejects(untilAborted(task, AbortSignal.abort()), {
      name: 'AbortError',
    });
  });

  it('leaves no unhandled rejection when the task fails after the abort', async (t) => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    t.after(() => process.off('unhandledRejection', onUnhandled));

    const { task, settle } = pendingTask();
    const controller = new AbortController();
    const waiting = untilAborted(task, controller.signal);
    controller.abort();
    await assert.rejects(waiting, { name: 'AbortError' });

    settle.reject(new Error('index failed'));
    await nextTurn();

    assert.deepEqual(unhandled, []);
  });
});
