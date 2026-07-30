import React from 'react';

const ButtonCopyToClipboard = ({
  textToCopy,
  className = '',
  placement = 'right',
}: {
  textToCopy: string;
  className?: string;
  placement?: 'right' | 'left';
}) => {
  const [showCopied, setShowCopied] = React.useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(textToCopy);
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={handleCopy}
        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none transition-colors p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
      >
        {showCopied ? (
          <svg
            className="w-4 h-4 text-green-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        ) : (
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        )}
      </button>
      {showCopied && (
        <span
          className={`absolute whitespace-nowrap bg-green-100 text-green-800 text-xs font-medium px-1.5 py-0.5 rounded dark:bg-green-900 dark:text-green-100 animate-fade-in transition-opacity duration-300 z-10 ${
            placement === 'right'
              ? 'left-full ml-2'
              : 'right-full mr-2 top-1/2 -translate-y-1/2'
          }`}
        >
          Скопійовано!
        </span>
      )}
    </div>
  );
};

export { ButtonCopyToClipboard };
