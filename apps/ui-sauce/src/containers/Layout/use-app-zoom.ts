import React from 'react';

const ZOOM_STORAGE_KEY = 'docNinja_zoomFactor';

// Chrome's own zoom steps, from 25%: with Windows scaling at 300%, 33% is
// how the app looks at 100% on an ordinary screen.
const ZOOM_STEPS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2,
];
const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
// Float noise between a stored factor and a step (0.33 vs 0.3300001).
const EPSILON = 0.001;

// Only the desktop app can zoom itself (see apps/electron/src/preload.cjs):
// a web page has no API for the browser's zoom — there, Ctrl + / Ctrl −
// already does it. Typed here rather than in file-system-bridge's
// ElectronAPI, which is about files.
type ElectronZoomAPI = { setZoomFactor?: (factor: number) => void };
const getElectronSetZoomFactor = () =>
  (
    window.electronAPI as
      (typeof window.electronAPI & ElectronZoomAPI) | undefined
  )?.setZoomFactor;

const readStoredZoomFactor = (): number => {
  try {
    const stored = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
    return stored >= MIN_ZOOM && stored <= MAX_ZOOM ? stored : 1;
  } catch {
    return 1;
  }
};

/**
 * Zoom for the desktop app, like a browser's: the whole window, breakpoints
 * included, so zooming out on a small screen with large Windows scaling
 * brings the desktop layout back.
 *
 * The app saves it and applies it again on start, rather than relying on
 * Electron to remember it across restarts. Ctrl + / Ctrl − / Ctrl 0 work
 * only while `areShortcutsEnabled` (the settings are open), so they never
 * catch a key meant for the page.
 */
const useAppZoom = ({
  areShortcutsEnabled,
}: {
  areShortcutsEnabled: boolean;
}) => {
  // Off and 100% on the server and the first render; the real values are
  // read on mount.
  const [isSupported, setIsSupported] = React.useState(false);
  const [zoomFactor, setZoomFactorState] = React.useState(1);
  // For the keyboard handler, which outlives renders.
  const zoomFactorRef = React.useRef(1);

  const applyZoomFactor = React.useCallback((factor: number) => {
    const setZoomFactor = getElectronSetZoomFactor();
    if (!setZoomFactor) return;
    setZoomFactor(factor);
    zoomFactorRef.current = factor;
    setZoomFactorState(factor);
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(factor));
    } catch (e) {
      console.warn('Failed to save the zoom', e);
    }
  }, []);

  // The next step up or down from wherever the zoom is now.
  const zoomBy = React.useCallback(
    (direction: 1 | -1) => {
      const current = zoomFactorRef.current;
      const next =
        direction > 0
          ? ZOOM_STEPS.find((step) => step > current + EPSILON)
          : [...ZOOM_STEPS].reverse().find((step) => step < current - EPSILON);
      if (next !== undefined) applyZoomFactor(next);
    },
    [applyZoomFactor],
  );

  React.useEffect(() => {
    if (!getElectronSetZoomFactor()) return;
    setIsSupported(true);
    applyZoomFactor(readStoredZoomFactor());
  }, [applyZoomFactor]);

  React.useEffect(() => {
    if (!isSupported || !areShortcutsEnabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      // By key position, so it works in any keyboard layout.
      if (event.code === 'Equal' || event.code === 'NumpadAdd') zoomBy(1);
      else if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
        zoomBy(-1);
      } else if (event.code === 'Digit0' || event.code === 'Numpad0') {
        applyZoomFactor(1);
      } else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSupported, areShortcutsEnabled, zoomBy, applyZoomFactor]);

  return {
    isSupported,
    zoomFactor,
    canZoomIn: zoomFactor < MAX_ZOOM - EPSILON,
    canZoomOut: zoomFactor > MIN_ZOOM + EPSILON,
    zoomIn: () => zoomBy(1),
    zoomOut: () => zoomBy(-1),
    resetZoom: () => applyZoomFactor(1),
    // A typed value: any percentage, kept within the steps' range.
    setZoom: (factor: number) =>
      applyZoomFactor(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor))),
  };
};

export { useAppZoom };
