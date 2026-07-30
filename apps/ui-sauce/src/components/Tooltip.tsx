import React from 'react';

type Placement = 'top' | 'bottom' | 'left' | 'right';
type Align = 'start' | 'center' | 'end';

const PLACEMENT_CLASSES: Record<Placement, string> = {
  top: 'bottom-full mb-2',
  bottom: 'top-full mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

// Only meaningful for top/bottom placements — left/right tooltips stay
// vertically centered on the trigger regardless of align.
const ALIGN_CLASSES: Record<Align, string> = {
  start: 'left-0',
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-0',
};

// Arrow position follows `align` too: with align="end" the trigger sits
// under the tooltip's right portion (not its center), so the arrow is
// offset to point back at it instead of sitting mid-box.
const ARROW_ALIGN_CLASSES: Record<Align, string> = {
  start: 'left-3',
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-3',
};

const ARROW_PLACEMENT_CLASSES: Record<Placement, string> = {
  top: 'top-full -mt-1',
  bottom: 'bottom-full -mb-1',
  left: 'left-full top-1/2 -translate-y-1/2 -ml-1',
  right: 'right-full top-1/2 -translate-y-1/2 -mr-1',
};

const Tooltip = ({
  content,
  children,
  placement = 'bottom',
  align = 'center',
  className = '',
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  placement?: Placement;
  align?: Align;
  className?: string;
}) => {
  const isVertical = placement === 'top' || placement === 'bottom';
  const isHorizontalArrow = placement === 'left' || placement === 'right';

  return (
    <div className={`relative inline-flex group/tooltip ${className}`}>
      {children}
      <div
        role="tooltip"
        className={`absolute z-20 invisible opacity-0 group-hover/tooltip:visible group-hover/tooltip:opacity-100 transition-opacity duration-300 px-3 py-2 text-xs font-medium text-white whitespace-nowrap bg-gray-900 rounded-lg shadow-sm dark:bg-gray-700 pointer-events-none ${PLACEMENT_CLASSES[placement]} ${isVertical ? ALIGN_CLASSES[align] : ''}`}
      >
        {content}
        <div
          className={`absolute w-2 h-2 rotate-45 bg-gray-900 dark:bg-gray-700 ${
            isHorizontalArrow
              ? ARROW_PLACEMENT_CLASSES[placement]
              : `${ARROW_PLACEMENT_CLASSES[placement]} ${ARROW_ALIGN_CLASSES[align]}`
          }`}
        />
      </div>
    </div>
  );
};

export { Tooltip };
