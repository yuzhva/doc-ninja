import React from 'react';
import { useTranslation } from 'react-i18next';

import { Modal } from './Modal';

const I18N_NS = 'component.confirmModal';

const outlinedButtonClassName =
  'px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-2 focus:outline-none focus:ring-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700 dark:focus:ring-gray-700 cursor-pointer transition-colors';

/**
 * A small yes/no dialog in place of window.confirm — same look as the app's
 * other modals. Focus starts on Cancel, and Escape cancels, so a stray
 * Enter never confirms a destructive action.
 *
 * A milder way to go ahead (`alternativeLabel`) can sit between the two: with
 * it, Cancel moves to the left, away from the two ways to go ahead.
 */
const ConfirmModal = ({
  isOpen,
  title,
  message,
  confirmLabel,
  onConfirm,
  alternativeLabel,
  onAlternative,
  onCancel,
}: {
  isOpen: boolean;
  title: React.ReactNode;
  message: React.ReactNode;
  confirmLabel: React.ReactNode;
  onConfirm: () => void;
  alternativeLabel?: React.ReactNode;
  onAlternative?: () => void;
  onCancel: () => void;
}) => {
  const hasAlternative = alternativeLabel != null && onAlternative != null;
  const { t } = useTranslation();

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  return (
    <Modal
      title={title}
      isOpen={isOpen}
      onBtnCloseClick={onCancel}
      // Wider with three buttons, which would otherwise not fit on one line
      maxWidthClassName={hasAlternative ? 'max-w-xl' : 'max-w-md'}
      footer={
        <div className="flex grow flex-wrap justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className={`${outlinedButtonClassName} ${hasAlternative ? 'me-auto' : ''}`}
          >
            {t(`${I18N_NS}.cancelButton`)}
          </button>
          {hasAlternative && (
            <button
              type="button"
              onClick={onAlternative}
              className={outlinedButtonClassName}
            >
              {alternativeLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 focus:ring-2 focus:outline-none focus:ring-red-300 dark:bg-red-600 dark:hover:bg-red-700 dark:focus:ring-red-900 cursor-pointer transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div className="flex items-start gap-3">
        <span className="flex items-center justify-center w-9 h-9 shrink-0 rounded-full bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400">
          <svg
            className="w-5 h-5"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </span>
        <p className="pt-1.5 text-sm text-gray-600 dark:text-gray-300">
          {message}
        </p>
      </div>
    </Modal>
  );
};

export { ConfirmModal };
