import React from 'react';

type SelectOption = {
  value: string;
  label: string;
};

const Select = ({
  value,
  onChange,
  options,
  label,
  name,
  id,
  disabled,
  labelClassName = '',
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label?: React.ReactNode;
  name?: string;
  id?: string;
  disabled?: boolean;
  labelClassName?: string;
}) => {
  return (
    // min-w-0 lets this shrink below its content's intrinsic width when
    // placed in a flex row (e.g. alongside a button) instead of overflowing
    // it and pushing the dropdown arrow off-screen.
    <div className="min-w-0">
      {label && (
        <label
          htmlFor={id}
          className={`block mb-2 text-sm font-medium text-gray-900 dark:text-white ${labelClassName}`}
        >
          {label}
        </label>
      )}
      <select
        id={id}
        name={name}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full truncate border disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer transition-colors bg-gray-50 border-gray-300 text-gray-900 enabled:hover:border-blue-400 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:enabled:hover:border-blue-500 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export { Select };
export type { SelectOption };
