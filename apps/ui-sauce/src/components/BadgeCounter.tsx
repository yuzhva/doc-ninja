import React from 'react';

const VARIANT_CLASSES = {
  red: 'bg-red-500 text-white',
  yellow: 'bg-yellow-400 text-yellow-900 shadow-sm',
  gray: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
};

const SIZE_CLASSES = {
  sm: 'h-5 min-w-5 px-1',
  md: 'h-6 min-w-6 px-1.5',
};

interface BadgeCounterProps {
  count: number | string;
  variant?: keyof typeof VARIANT_CLASSES;
  size?: keyof typeof SIZE_CLASSES;
  // Matches the "notification dot on top of a button" look — a corner badge
  // needs visual separation from whatever it's layered onto, a plain inline
  // counter (e.g. next to a label) doesn't.
  bordered?: boolean;
  // For positioning (e.g. "absolute -top-2 -end-2") or spacing (e.g. "ml-2")
  // — the caller's responsibility, this component only owns its own look.
  className?: string;
}

// min-w instead of a fixed w- is what lets this grow into a pill once the
// count is wider than the circle (e.g. 4+ digits) instead of clipping it.
const BadgeCounter = ({
  count,
  variant = 'gray',
  size = 'sm',
  bordered = false,
  className = '',
}: BadgeCounterProps) => (
  <span
    className={[
      'inline-flex items-center justify-center rounded-full text-xs font-bold leading-none',
      SIZE_CLASSES[size],
      VARIANT_CLASSES[variant],
      bordered && 'border-2 border-white dark:border-gray-800',
      className,
    ]
      .filter(Boolean)
      .join(' ')}
  >
    {count}
  </span>
);

export { BadgeCounter };
