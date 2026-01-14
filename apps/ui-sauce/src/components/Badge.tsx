import React from 'react';

const Badge = ({
  label,
  value,
  variant = 'blue',
  hideLabel = false,
}: {
  label: string;
  value?: string | null;
  variant?: 'blue' | 'purple';
  hideLabel?: boolean;
}) => {
  const displayValue = value || '---';

  const variantClasses = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800/50',
    purple:
      'bg-purple-50 text-purple-700 border-purple-100 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-800/50',
  };

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-0.5 rounded border ${variantClasses[variant]}`}
    >
      {!hideLabel && (
        <span className="text-[10px] uppercase font-bold opacity-60">
          {label}:
        </span>
      )}
      <span className="text-xs font-medium">{displayValue}</span>
    </div>
  );
};

export { Badge };
