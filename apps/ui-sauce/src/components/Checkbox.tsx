import React from 'react';

const Checkbox = ({
  checked,
  onChange,
  label,
  labelPlacement = 'end',
  theme = 'default',
  shape = 'rounded',
  name,
  id,
  disabled,
  indeterminate = false,
  title,
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
  // Default theme only. The Flowbite theme sets `--radius` (what a bare
  // `rounded` resolves to) to 8px, so 'rounded' draws a circle on a 16px box;
  // 'square' keeps Flowbite's own checkbox corners.
  shape?: 'rounded' | 'square';
  name?: string;
  id?: string;
  disabled?: boolean;
  // The "some but not all" state of a box that stands for a whole list.
  // Default theme only — a toggle has no third position to show it in.
  indeterminate?: boolean;
  // Hover hint, and the accessible name when there's no visible label.
  title?: string;
  className?: string;
  labelClassName?: string;
}) => {
  const isLabelFirst = labelPlacement === 'start';
  const inputRef = React.useRef<HTMLInputElement>(null);

  // `indeterminate` is a DOM property with no HTML attribute behind it, so it
  // can only be set imperatively.
  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  if (theme === 'toggle') {
    return (
      // `relative` anchors the `sr-only` (absolutely positioned) input to this
      // label. Otherwise it anchors to the nearest positioned ancestor, and
      // inside a scroll container (the Search form column) it escapes the
      // clipping and stretches the page's scroll height below the footer.
      <label
        className={`relative inline-flex items-center cursor-pointer ${className}`}
      >
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
      title={title}
    >
      {isLabelFirst && label && (
        <span
          className={`mr-2 text-sm font-medium text-gray-900 dark:text-gray-100 ${labelClassName}`}
        >
          {label}
        </span>
      )}
      {/* The tick and the dash are drawn here rather than left to the Flowbite
          plugin, which sizes its marks in `em` — so the same box shows a
          smaller tick in a `text-xs` table header than in a `text-sm` row —
          and draws the dash as a near edge-to-edge bar. `bg-none` switches
          its images off (its fill colour, `currentColor`, still applies), and
          one fixed 16px glyph with the same stroke serves both states.
          The focus ring is keyboard-only and soft: a solid blue one (the
          plugin adds its own on every `:focus`) merges with the checked fill,
          so a box just clicked looked a size bigger than its neighbours. */}
      <span className="relative inline-flex shrink-0">
        <input
          ref={inputRef}
          type="checkbox"
          name={name}
          id={id}
          aria-label={label ? undefined : title}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className={`w-4 h-4 bg-gray-100 bg-none border-gray-300 ${shape === 'square' ? 'rounded-xs' : 'rounded'} text-blue-600 focus:ring-0 focus-visible:ring-2 focus-visible:ring-brand-soft dark:bg-gray-600 dark:border-gray-500 cursor-pointer disabled:cursor-not-allowed`}
        />
        {(checked || indeterminate) && (
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 w-4 h-4 text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 16 16"
            stroke="currentColor"
            // The plugin's own tick, scaled to the box, was ~1.4px: 2px read
            // as noticeably bolder
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* Partly selected wins over checked — it's the more specific
                thing to say about a box that stands for a whole list. */}
            <path d={indeterminate ? 'M4.5 8h7' : 'm4 8.5 2.75 2.5L12 5.5'} />
          </svg>
        )}
      </span>
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
