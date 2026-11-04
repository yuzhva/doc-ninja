import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import type { UseFilePicker } from '../hooks/use-file-system';

const I18N_NS = 'component.formFileDropzone';

const hasAllowedExtension = (fileName: string, extensions: string[]) =>
  extensions.some((extension) =>
    fileName.toLowerCase().endsWith(extension.toLowerCase()),
  );

const isFileDrag = (event: DragEvent | React.DragEvent) =>
  [...(event.dataTransfer?.types ?? [])].includes('Files');

/**
 * A file input you can drop a file onto, or click to open the usual picker.
 * Accepts one file of the given extensions; a rejected drop keeps the
 * previous selection and says why.
 */
const FormFileDropzone = ({
  id,
  label,
  extensions,
  selectedItem,
  onClick,
  onDropFile,
  isFileSystemAccessSupported,
}: {
  id: string;
  label: React.ReactNode;
  // With the dot, e.g. ['.xlsx', '.xlsm'].
  extensions: string[];
  selectedItem: UseFilePicker['processedDir'] | null;
  onClick: () => void;
  // Called synchronously from the drop handler with an accepted file.
  onDropFile: (dataTransfer: DataTransfer) => void;
  isFileSystemAccessSupported: boolean;
}) => {
  const { t, i18n } = useTranslation();
  const zoneRef = React.useRef<HTMLButtonElement>(null);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [dropError, setDropError] = React.useState<string | null>(null);
  // dragenter/dragleave also fire when moving between the zone's children.
  const dragDepthRef = React.useRef(0);

  const extensionsLabel = extensions.join(', ');
  const selectedName = selectedItem?.structure?.name;
  // The picker dialog may offer more types than this zone accepts.
  const selectedFileError =
    selectedName && !hasAllowedExtension(selectedName, extensions)
      ? t(`${I18N_NS}.unsupportedType`, {
          name: selectedName,
          extensions: extensionsLabel,
        })
      : null;

  // A file dropped next to the zone would otherwise be opened by the
  // browser in place of the app, losing everything on the page.
  React.useEffect(() => {
    const blockStrayFileDrop = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      if (zoneRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', blockStrayFileDrop);
    window.addEventListener('drop', blockStrayFileDrop);
    return () => {
      window.removeEventListener('dragover', blockStrayFileDrop);
      window.removeEventListener('drop', blockStrayFileDrop);
    };
  }, []);

  const isEnabled = isFileSystemAccessSupported;

  const handleDragEnter = (event: React.DragEvent) => {
    if (!isEnabled || !isFileDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (!isEnabled || !isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: React.DragEvent) => {
    if (!isEnabled || !isFileDrag(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragOver(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    if (!isEnabled || !isFileDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOver(false);

    const { files } = event.dataTransfer;
    if (files.length !== 1) {
      setDropError(t(`${I18N_NS}.multipleFiles`));
      return;
    }
    if (!hasAllowedExtension(files[0].name, extensions)) {
      setDropError(
        t(`${I18N_NS}.unsupportedType`, {
          name: files[0].name,
          extensions: extensionsLabel,
        }),
      );
      return;
    }

    setDropError(null);
    onDropFile(event.dataTransfer);
  };

  const formatSize = (bytes: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'unit',
      unit: bytes < 1024 * 1024 ? 'kilobyte' : 'megabyte',
      unitDisplay: 'short',
      maximumFractionDigits: 1,
    }).format(bytes < 1024 * 1024 ? bytes / 1024 : bytes / (1024 * 1024));

  const error = dropError ?? selectedFileError;

  return (
    <div>
      <label
        htmlFor={id}
        className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
      >
        {label}
      </label>
      <button
        ref={zoneRef}
        id={id}
        type="button"
        onClick={() => {
          setDropError(null);
          onClick();
        }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        disabled={!isEnabled}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`flex w-full flex-col items-center justify-center gap-1 px-4 py-6 text-center text-sm border-2 border-dashed rounded-lg cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          isDragOver
            ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/30'
            : error
              ? 'border-red-300 bg-gray-50 enabled:hover:bg-gray-100 dark:border-red-800 dark:bg-gray-700 dark:enabled:hover:bg-gray-600'
              : 'border-gray-300 bg-gray-50 enabled:hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:enabled:hover:bg-gray-600'
        }`}
      >
        {/* Children ignore the pointer so drag events come from the zone
            itself and the dragenter/dragleave count stays simple. */}
        <span className="pointer-events-none flex flex-col items-center gap-1">
          {isDragOver ? (
            <>
              <UploadIcon className="w-8 h-8 mb-1 text-blue-600 dark:text-blue-400" />
              <span className="font-semibold text-blue-700 dark:text-blue-300">
                {t(`${I18N_NS}.releaseToSelect`)}
              </span>
            </>
          ) : selectedName && selectedItem?.structure ? (
            <>
              <FileIcon className="w-8 h-8 mb-1 text-blue-600 dark:text-blue-400" />
              <span className="max-w-full truncate font-semibold text-gray-900 dark:text-white">
                {selectedName}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {formatSize(selectedItem.structure.size ?? 0)} ·{' '}
                {t(`${I18N_NS}.replaceHint`)}
              </span>
            </>
          ) : (
            <>
              <UploadIcon className="w-8 h-8 mb-1 text-gray-500 dark:text-gray-400" />
              <span className="text-gray-600 dark:text-gray-300">
                <Trans
                  t={t}
                  i18nKey={`${I18N_NS}.clickOrDrop`}
                  components={{
                    strong: (
                      <span className="font-semibold text-gray-900 dark:text-white" />
                    ),
                  }}
                />
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t(`${I18N_NS}.acceptedTypes`, { extensions: extensionsLabel })}
              </span>
            </>
          )}
        </span>
      </button>
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-2 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  );
};

const UploadIcon = ({ className }: { className: string }) => (
  <svg
    className={className}
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 20 16"
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"
    />
  </svg>
);

const FileIcon = ({ className }: { className: string }) => (
  <svg
    className={className}
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M8 13h8M8 17h8" />
  </svg>
);

export { FormFileDropzone, hasAllowedExtension };
