import React from 'react';

const Checkbox = ({
  checked,
  onChange,
  label,
  labelPlacement = 'end',
  theme = 'default',
  name,
  id,
  disabled,
  className = '',
  labelClassName = '',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  // Which side of the box/toggle the label sits on. 'start' is for rows that
  // read as "<setting name> [toggle]" — e.g. a control parked at the end of a
  // field's own label line, where the toggle has to stay flush with the edge.
  labelPlacement?: 'start' | 'end';
  theme?: 'default' | 'toggle';
  name?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
}) => {
  const isLabelFirst = labelPlacement === 'start';

  if (theme === 'toggle') {
    return (
      <label className={`inline-flex items-center cursor-pointer ${className}`}>
        {isLabelFirst && label && (
          <span
            className={`me-3 text-sm font-medium text-gray-900 dark:text-gray-300 ${labelClassName}`}
          >
            {label}
          </span>
        )}
        <input
          type="checkbox"
          name={name}
          id={id}
          className="sr-only peer"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className="relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
        {!isLabelFirst && label && (
          <span
            className={`ms-3 text-sm font-medium text-gray-900 dark:text-gray-300 ${labelClassName}`}
          >
            {label}
          </span>
        )}
      </label>
    );
  }

  return (
    <label
      className={`inline-flex items-center cursor-pointer ${className}`}
      htmlFor={id}
    >
      {isLabelFirst && label && (
        <span
          className={`mr-2 text-sm font-medium text-gray-900 dark:text-gray-100 ${labelClassName}`}
        >
          {label}
        </span>
      )}
      <input
        type="checkbox"
        name={name}
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 bg-gray-100 border-gray-300 rounded text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-700 focus:ring-2 dark:bg-gray-600 dark:border-gray-500"
      />
      {!isLabelFirst && label && (
        <span
          className={`ml-2 text-sm font-medium text-gray-900 dark:text-gray-100 ${labelClassName}`}
        >
          {label}
        </span>
      )}
    </label>
  );
};

export { Checkbox };
