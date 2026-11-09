import React from 'react';
import { useTranslation } from 'react-i18next';

import { NotificationBridge } from '../../utils/notification-bridge';

const I18N_NS = 'page.search.searchRun';

type AddToast = (
  type: 'success' | 'error' | 'warning',
  content: React.ReactNode,
) => void;

// A search, as a function of the signal that cancels it: it resolves once
// done, and rejects when it fails or is cancelled
type Search = (signal: AbortSignal) => Promise<void>;

/**
 * One search at a time, from its start to the toast saying how it went:
 * whether one is running (for the form's button, the results' "searching"
 * and the footer), and cancelling it (the footer's button).
 */
const useSearchRun = (addToast: AddToast) => {
  const { t } = useTranslation();
  const [isSearching, setIsSearching] = React.useState(false);
  // The search running now is cancelled by this
  const abortControllerRef = React.useRef<AbortController | null>(null);

  const cancel = () => {
    abortControllerRef.current?.abort();
  };

  const run = async (search: Search) => {
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const { signal } = abortController;

    setIsSearching(true);
    try {
      await search(signal);
      // Cancelled just as it finished: it's cancelled
      signal.throwIfAborted();

      const message = t(`${I18N_NS}.successMessage`);
      addToast('success', message);
      NotificationBridge.notify(message);
    } catch (error) {
      // The user cancelled it, in the app: no system notification
      if (signal.aborted) {
        addToast('warning', t(`${I18N_NS}.cancelledMessage`));
        return;
      }

      console.error('Search failed:', error);
      const message = `❌ ${t(`${I18N_NS}.failedMessage`)}`;
      addToast('error', message);
      NotificationBridge.notify(message);
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setIsSearching(false);
    }
  };

  return { run, cancel, isSearching };
};

type SearchRun = ReturnType<typeof useSearchRun>;

export { useSearchRun };
export type { Search, SearchRun };
