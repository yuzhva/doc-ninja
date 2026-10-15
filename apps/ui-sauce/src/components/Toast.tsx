import React from 'react';
import { useTranslation } from 'react-i18next';

const I18N_NS = 'component.toast';

interface ToastMessage {
  id: number;
  type: 'success' | 'error' | 'warning';
  // Usually plain text; markup when the message carries an action, like the
  // "open folder" link after saving generated documents.
  content: React.ReactNode;
}

const AUTO_CLOSE_SECONDS = 3;
const LEAVE_ANIMATION_MS = 300;

const TYPE_STYLES: Record<
  ToastMessage['type'],
  { accent: string; icon: string }
> = {
  success: {
    accent: 'border-l-green-500 dark:border-l-green-500',
    icon: 'text-green-500 dark:text-green-400',
  },
  error: {
    accent: 'border-l-red-500 dark:border-l-red-500',
    icon: 'text-red-500 dark:text-red-400',
  },
  warning: {
    accent: 'border-l-orange-500 dark:border-l-orange-500',
    icon: 'text-orange-500 dark:text-orange-400',
  },
};

const Toast = ({
  id,
  type,
  content,
  onClose,
}: ToastMessage & { onClose: (id: number) => void }) => {
  const { t } = useTranslation();

  const [secondsLeft, setSecondsLeft] = React.useState(AUTO_CLOSE_SECONDS);
  const [isAutoCloseCancelled, setIsAutoCloseCancelled] = React.useState(false);

  // Starts off-screen/transparent, then flips true on the next frame so the
  // transition below actually animates instead of snapping to its end state.
  const [isVisible, setIsVisible] = React.useState(false);
  const [isLeaving, setIsLeaving] = React.useState(false);

  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setIsVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleClose = React.useCallback(() => {
    setIsLeaving(true);
    setTimeout(() => onClose(id), LEAVE_ANIMATION_MS);
  }, [id, onClose]);

  React.useEffect(() => {
    if (isAutoCloseCancelled) return;

    if (secondsLeft <= 0) {
      handleClose();
      return;
    }

    const timeoutId = setTimeout(() => {
      setSecondsLeft((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [secondsLeft, isAutoCloseCancelled, handleClose]);

  const { accent, icon: iconColor } = TYPE_STYLES[type];

  const icon =
    type === 'success' ? (
      <svg
        className={`w-5 h-5 shrink-0 ${iconColor}`}
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M5 11.917 9.724 16.5 19 7.5"
        />
        <span className="sr-only">{t(`${I18N_NS}.successIconAlt`)}</span>
      </svg>
    ) : type === 'error' ? (
      <svg
        className={`w-5 h-5 shrink-0 ${iconColor}`}
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M6 18 17.94 6M18 18 6.06 6"
        />
        <span className="sr-only">{t(`${I18N_NS}.errorIconAlt`)}</span>
      </svg>
    ) : (
      <svg
        className={`w-5 h-5 shrink-0 ${iconColor}`}
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M12 13V8m0 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        />
        <span className="sr-only">{t(`${I18N_NS}.warningIconAlt`)}</span>
      </svg>
    );

  return (
    <div
      className={`w-full max-w-sm p-4 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 border-l-4 mb-4 transform transition-all duration-300 ease-out ${accent} ${
        isVisible && !isLeaving
          ? 'translate-x-0 opacity-100'
          : 'translate-x-full opacity-0'
      }`}
      role="alert"
    >
      <div className="flex items-center">
        {icon}
        <div className="ms-3 text-sm font-normal whitespace-pre-wrap">
          {content}
        </div>
        <button
          type="button"
          className="ms-auto -mx-1.5 -my-1.5 bg-transparent text-gray-400 hover:text-gray-900 dark:text-gray-500 dark:hover:text-white rounded-lg focus:ring-2 focus:ring-gray-300 p-1.5 hover:bg-black/5 dark:hover:bg-white/10 inline-flex items-center justify-center h-8 w-8 cursor-pointer"
          aria-label={t(`${I18N_NS}.closeLabel`)}
          onClick={handleClose}
        >
          <span className="sr-only">{t(`${I18N_NS}.closeLabel`)}</span>
          <svg
            className="w-3 h-3"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 14 14"
          >
            <path
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"
            />
          </svg>
        </button>
      </div>

      {!isAutoCloseCancelled && (
        <>
          <div className="my-2 border-t border-gray-200 dark:border-gray-700" />
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>
              {t(`${I18N_NS}.autoCloseCountdown`, { count: secondsLeft })}
            </span>
            <button
              type="button"
              className="font-medium text-blue-600 hover:underline dark:text-blue-500 cursor-pointer"
              onClick={() => setIsAutoCloseCancelled(true)}
            >
              {t(`${I18N_NS}.cancelAutoCloseButton`)}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export { Toast };
export type { ToastMessage };
