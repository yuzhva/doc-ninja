import React from 'react';
import { useTranslation } from 'react-i18next';

import { UseFilePicker } from '../hooks/use-file-system';

const I18N_NS = 'component.formInputFileSelect';

interface FormInputFileSelectProps {
  id: string;
  name: string;
  type?: 'file';
  accept?: string;
  onClick: () => void;
  selectedItem: UseFilePicker['processedDir'] | null;
  webkitdirectory?: React.DetailedHTMLProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    HTMLInputElement
  >;
  directory?: string;
  isFileSystemAccessSupported: boolean;
  label: React.ReactNode;
  icon?: 'file' | 'folder';
}

const FormInputFileSelect = ({
  id,
  name,
  type = 'file',
  accept,
  onClick,
  selectedItem,
  webkitdirectory,
  directory,
  isFileSystemAccessSupported,
  label,
  icon = 'file', // "file" or "folder"
}: FormInputFileSelectProps) => {
  const { t } = useTranslation();
  const displayName = React.useMemo(() => {
    // Check if selectedItem exists AND if its structure property exists
    if (!selectedItem?.structure) return t(`${I18N_NS}.clickToSelect`);

    const name = selectedItem.structure.name;
    const kind = selectedItem.structure.fsItemType;
    return `${kind}://${name}`;
  }, [selectedItem, t]);

  const FileIcon = () => (
    <svg
      className="w-4 h-4 text-gray-500 dark:text-gray-400"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 20 16"
    >
      <path
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M8 8v1h4V8m4 7H4a1 1 0 0 1-1-1V5h14v9a1 1 0 0 1-1 1ZM2 1h16a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1Z"
      />
    </svg>
  );

  const FolderIcon = () => (
    <svg
      className="w-4 h-4 text-gray-500 dark:text-gray-400"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      viewBox="0 0 20 16"
    >
      <path d="M19 0H1a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V1a1 1 0 0 0-1-1ZM2 6v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6H2Zm11 3a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 2 0h2a1 1 0 0 1 2 0v1Z" />
    </svg>
  );

  return (
    <div
    // className="mb-5"
    >
      <label
        className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
        htmlFor={id}
      >
        {label}
      </label>
      <div className="flex">
        <span className="inline-flex items-center px-3 text-sm text-gray-900 bg-gray-200 border rounded-s-lg rounded-e-none border-gray-300 border-e-0 dark:bg-gray-600 dark:text-gray-400 dark:border-gray-600">
          {icon === 'folder' ? <FolderIcon /> : <FileIcon />}
        </span>
        <button
          type="button"
          onClick={onClick}
          disabled={!isFileSystemAccessSupported}
          className="rounded-none rounded-e-lg bg-gray-50 border text-gray-900 focus:ring-blue-500 focus:border-blue-500 block flex-1 min-w-0 w-full text-sm border-gray-300 p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 disabled:opacity-50 text-left cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
        >
          {displayName}
        </button>
        {/* Hidden input for fallback */}
        <input
          id={id}
          name={name}
          type={type}
          accept={accept}
          className="hidden"
          webkitdirectory={webkitdirectory}
          directory={directory}
        />
      </div>
    </div>
  );
};

export { FormInputFileSelect };
