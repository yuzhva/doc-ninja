import { MessageChannelMain, utilityProcess } from 'electron';
import type { UtilityProcess, WebContents } from 'electron';
import os from 'os';

/**
 * The backend process (see backend-process.mts), seen from the main process:
 * started once, connected to each window that asks, and started again by the
 * next request if it stops.
 */
class BackendProcess {
  #child: UtilityProcess | null = null;
  /** The windows connected to it: told when it stops, so they reconnect. */
  readonly #windows = new Set<WebContents>();

  constructor(
    private readonly modulePath: string,
    private readonly backendPath: string,
  ) {}

  start(): UtilityProcess {
    if (this.#child) return this.#child;

    const child = utilityProcess.fork(this.modulePath, [], {
      serviceName: 'DocNinja backend',
      env: { ...process.env, DOC_NINJA_BACKEND_PATH: this.backendPath },
    });
    // Below the window's priority: when the computer is busy, the OS gives the
    // window its time first, and a search or the indexing of a folder waits.
    child.once('spawn', () => {
      try {
        os.setPriority(child.pid!, os.constants.priority.PRIORITY_BELOW_NORMAL);
      } catch (error) {
        console.warn('Could not lower the backend’s priority', error);
      }
    });
    child.once('exit', (code) => {
      if (this.#child !== child) return; // stopped on purpose
      this.#child = null;
      const reason = `The backend stopped (exit code ${code})`;
      console.error(`❌ ${reason}`);
      for (const contents of this.#windows) {
        contents.send('backend:stopped', reason);
      }
    });

    this.#child = child;
    return child;
  }

  /** Gives a window a port of its own to the backend. */
  connect(contents: WebContents): void {
    const { port1, port2 } = new MessageChannelMain();
    this.start().postMessage({ type: 'connect' }, [port1]);
    contents.postMessage('backend:port', null, [port2]);

    if (!this.#windows.has(contents)) {
      this.#windows.add(contents);
      contents.once('destroyed', () => this.#windows.delete(contents));
    }
  }

  stop(): void {
    const child = this.#child;
    this.#child = null;
    child?.kill();
  }
}

export { BackendProcess };
