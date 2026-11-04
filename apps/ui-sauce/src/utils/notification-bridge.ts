/**
 * System notifications for the browser and the desktop app alike.
 *
 * Both run the same Web Notification API (Electron's renderer implements it
 * too), so the only difference is what a click should do: bring the app back.
 * A browser tab does that itself with window.focus() from the click handler;
 * an Electron window can't raise itself from the renderer, so there the main
 * process does it (see apps/electron/src/main.mts).
 *
 * Every call is a no-op where notifications don't exist (SSR, browsers
 * without the API), so a notification can never break the code that sends it.
 */

// Only the desktop app exposes it (see apps/electron/src/preload.cjs).
// Typed here rather than in file-system-bridge's ElectronAPI, which is about
// files, the same way use-app-zoom types setZoomFactor.
type ElectronWindowAPI = { focusWindow?: () => void };

class NotificationBridge {
  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  /**
   * Asks for permission while the user hasn't decided yet. A browser never
   * prompts again once it's been granted or denied, so there's nothing to ask
   * for after that.
   */
  static requestPermission(): void {
    if (!NotificationBridge.isSupported()) return;
    if (Notification.permission !== 'default') return;

    void Notification.requestPermission();
  }

  /**
   * Shows `message` as a system notification, but only while the app isn't
   * on screen: when it is, the in-app toast already says the same thing.
   * Clicking the notification brings the app back to the front.
   */
  static notify(message: string): void {
    if (!NotificationBridge.isSupported()) return;
    if (Notification.permission !== 'granted' || !document.hidden) return;

    try {
      const notification = new Notification(message);
      notification.onclick = () => {
        NotificationBridge.focusApp();
        notification.close();
      };
    } catch (error) {
      // Chrome on Android has the API but throws on the constructor (it only
      // shows notifications sent from a service worker).
      console.warn('Failed to show a system notification', error);
    }
  }

  private static focusApp(): void {
    const { focusWindow } = (window.electronAPI ?? {}) as ElectronWindowAPI;

    if (focusWindow) focusWindow();
    else window.focus();
  }
}

export { NotificationBridge };
