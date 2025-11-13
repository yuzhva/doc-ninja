import React from 'react';

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
}) => {
  const displayName = React.useMemo(() => {
    if (!selectedItem) return 'Натисніть, щоб обрати ...';

    const name = selectedItem.name;
    const kind = selectedItem.kind;

    return `${kind}://${name}`;
  }, [selectedItem]);

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
        <span className="inline-flex items-center px-3 text-sm text-gray-900 bg-gray-200 border rounded-e-0 border-gray-300 border-e-0 rounded-s-md dark:bg-gray-600 dark:text-gray-400 dark:border-gray-600">
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

// Loading spinner component
const LoadingSpinner = () => (
  <svg
    className="animate-spin -ml-1 mr-3 h-4 w-4 text-white"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

// Button component with loading state
const ProcessingButton = ({ children, isLoading, ...props }) => (
  <button
    {...props}
    disabled={isLoading || props.disabled}
    className={`
        cursor-pointer text-white font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center
        focus:ring-4 focus:outline-none
        ${
          isLoading || props.disabled
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-blue-700 hover:bg-blue-800 focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800'
        }
        flex items-center justify-center
      `}
  >
    {isLoading && <LoadingSpinner />}
    {children}
  </button>
);

export { FormInputFileSelect, LoadingSpinner, ProcessingButton };
