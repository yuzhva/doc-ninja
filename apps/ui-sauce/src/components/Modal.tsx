import React from 'react';

// Reference-counted so nested/sibling modals don't fight over restoring the
// body's original overflow value — only the last one to close restores it.
let bodyScrollLockCount = 0;
let previousBodyOverflow = '';

const lockBodyScroll = () => {
  if (bodyScrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  bodyScrollLockCount++;
};

const unlockBodyScroll = () => {
  bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
  if (bodyScrollLockCount === 0) {
    document.body.style.overflow = previousBodyOverflow;
  }
};

const Modal = ({
  title,
  isOpen,
  onBtnCloseClick,
  footer,
  children,
  maxWidthClassName = 'max-w-4xl',
  bodyClassName = 'p-4 space-y-4 md:p-6',
}: {
  title: string;
  isOpen: boolean;
  onBtnCloseClick: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
  maxWidthClassName?: string;
  bodyClassName?: string;
}) => {
  React.useEffect(() => {
    if (!isOpen) return;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center w-full h-full bg-black/50 backdrop-blur-sm p-4 overflow-x-hidden overflow-y-auto"
      tabIndex={-1}
      aria-hidden="true"
    >
      <div className={`relative w-full ${maxWidthClassName} max-h-full`}>
        {/* Modal content */}
        <div className="relative bg-white border border-gray-200 rounded-lg shadow-xl dark:bg-gray-800 dark:border-gray-700 flex flex-col max-h-[90vh]">
          {/* Modal header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 md:p-5">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              {title}
            </h3>
            <button
              type="button"
              className="text-gray-400 bg-transparent hover:bg-gray-200 hover:text-gray-900 rounded-lg text-sm w-8 h-8 ms-auto inline-flex justify-center items-center dark:hover:bg-gray-600 dark:hover:text-white"
              onClick={onBtnCloseClick}
            >
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
              <span className="sr-only">Close modal</span>
            </button>
          </div>
          {/* Modal body */}
          <div
            className={`${bodyClassName} text-gray-600 dark:text-gray-400 overflow-y-auto`}
          >
            {children}
          </div>
          {/* Modal footer */}
          {footer && (
            <div className="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-700 md:p-5">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export { Modal };
