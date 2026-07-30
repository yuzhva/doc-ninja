import React from 'react';

interface ToastMessage {
  id: number;
  type: 'success' | 'error' | 'warning';
  content: string;
}

const AUTO_CLOSE_SECONDS = 3;

const Toast = ({
  id,
  type,
  content,
  onClose,
}: ToastMessage & { onClose: (id: number) => void }) => {
  const [secondsLeft, setSecondsLeft] = React.useState(AUTO_CLOSE_SECONDS);
  const [isAutoCloseCancelled, setIsAutoCloseCancelled] = React.useState(false);

  React.useEffect(() => {
    if (isAutoCloseCancelled) return;

    if (secondsLeft <= 0) {
      onClose(id);
      return;
    }

    const timeoutId = setTimeout(() => {
      setSecondsLeft((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [secondsLeft, isAutoCloseCancelled, id, onClose]);

  const icon =
    type === 'success' ? (
      <div className="inline-flex items-center justify-center shrink-0 w-8 h-8 text-green-500 bg-green-100 rounded-lg dark:bg-green-800 dark:text-green-200">
        <svg
          className="w-5 h-5"
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
        </svg>
        <span className="sr-only">Check icon</span>
      </div>
    ) : type === 'error' ? (
      <div className="inline-flex items-center justify-center shrink-0 w-8 h-8 text-red-500 bg-red-100 rounded-lg dark:bg-red-800 dark:text-red-200">
        <svg
          className="w-5 h-5"
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
        </svg>
        <span className="sr-only">Error icon</span>
      </div>
    ) : (
      <div className="inline-flex items-center justify-center shrink-0 w-8 h-8 text-orange-500 bg-orange-100 rounded-lg dark:bg-orange-700 dark:text-orange-200">
        <svg
          className="w-5 h-5"
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
        </svg>
        <span className="sr-only">Warning icon</span>
      </div>
    );

  return (
    <div
      className="w-full max-w-sm p-4 text-gray-500 bg-white rounded-lg shadow dark:text-gray-400 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 mb-4"
      role="alert"
    >
      <div className="flex items-center">
        {icon}
        <div className="ms-3 text-sm font-normal whitespace-pre-wrap">
          {content}
        </div>
        {/* {isAutoCloseCancelled && ( */}
        <button
          type="button"
          className="ms-auto -mx-1.5 -my-1.5 bg-white text-gray-400 hover:text-gray-900 rounded-lg focus:ring-2 focus:ring-gray-300 p-1.5 hover:bg-gray-100 inline-flex items-center justify-center h-8 w-8 dark:text-gray-500 dark:hover:text-white dark:bg-gray-800 dark:hover:bg-gray-700 cursor-pointer"
          aria-label="Close"
          onClick={() => onClose(id)}
        >
          <span className="sr-only">Close</span>
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
        {/* )} */}
      </div>

      {!isAutoCloseCancelled && (
        <>
          <div className="my-2 border-t border-gray-200 dark:border-gray-700" />
          <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
            <span>
              Notification will be auto closed in {secondsLeft} sec ...
            </span>
            <button
              type="button"
              className="font-medium text-blue-600 hover:underline dark:text-blue-500 cursor-pointer"
              onClick={() => setIsAutoCloseCancelled(true)}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export { Toast };
export type { ToastMessage };
