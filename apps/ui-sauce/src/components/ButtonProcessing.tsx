import React from 'react';

import { LoadingSpinner } from './LoadingSpinner';

interface ButtonProcessingProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isLoading?: boolean;
  children: React.ReactNode;
}

// Button component with loading state
const ButtonProcessing = ({
  children,
  isLoading,
  ...props
}: ButtonProcessingProps) => (
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

export { ButtonProcessing };
