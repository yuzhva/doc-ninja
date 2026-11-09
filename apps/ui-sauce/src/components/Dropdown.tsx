import React from 'react';

interface DropdownProps {
  trigger: (args: { isOpen: boolean; toggle: () => void }) => React.ReactNode;
  // A function when picking something in the panel should close it — a menu,
  // as opposed to a panel of settings that stays open while they're changed.
  children:
    React.ReactNode | ((args: { close: () => void }) => React.ReactNode);
  panelClassName?: string;
  panelPadding?: string;
  // 'auto' opens down, unless the panel would be cut off there and there's
  // more room above — for a trigger that can sit anywhere in a scrolling list.
  openDirection?: 'down' | 'up' | 'auto';
  onOpenChange?: (isOpen: boolean) => void;
}

/**
 * The part of the window the element can be seen in, top to bottom: inside
 * the window and every ancestor that cuts off what overflows it. All of them,
 * not just the nearest: a table's horizontal scroller clips too, yet its box
 * can reach far past the scrolling list that holds it.
 */
const visibleBoundsOf = (element: HTMLElement) => {
  let top = 0;
  let bottom = innerHeight;
  for (
    let ancestor = element.parentElement;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    if (getComputedStyle(ancestor).overflowY !== 'visible') {
      const box = ancestor.getBoundingClientRect();
      top = Math.max(top, box.top);
      bottom = Math.min(bottom, box.bottom);
    }
  }
  return { top, bottom };
};

const Dropdown = ({
  trigger,
  children,
  panelClassName = 'w-64 right-0 bg-white dark:bg-gray-700',
  panelPadding = 'p-3',
  openDirection = 'down',
  onOpenChange,
}: DropdownProps) => {
  const [isOpen, setIsOpen] = React.useState(false);
  // Where an 'auto' panel opens, as measured when it last did
  const [isOpenUpward, setIsOpenUpward] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Measured once the panel is there, before it's painted: its height doesn't
  // depend on the side it opens on
  React.useLayoutEffect(() => {
    if (!isOpen || openDirection !== 'auto') return;

    const container = containerRef.current;
    const panel = panelRef.current;
    if (!container || !panel) return;

    const bounds = visibleBoundsOf(container);
    const triggerBox = container.getBoundingClientRect();
    // The panel's own height plus the gap it keeps from the trigger
    const panelHeight = panel.getBoundingClientRect().height + 8;
    const roomBelow = bounds.bottom - triggerBox.bottom;
    const roomAbove = triggerBox.top - bounds.top;

    setIsOpenUpward(panelHeight > roomBelow && roomAbove > roomBelow);
  }, [isOpen, openDirection]);

  const setOpen = (next: boolean) => {
    setIsOpen(next);
    onOpenChange?.(next);
  };

  const toggle = () => setOpen(!isOpen);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      {trigger({ isOpen, toggle })}

      {isOpen && (
        <div
          ref={panelRef}
          className={`absolute z-30 ${panelPadding} rounded-lg border border-gray-200 shadow-lg max-h-96 overflow-y-auto overflow-x-hidden dark:border-gray-600 ${(openDirection === 'auto' ? isOpenUpward : openDirection === 'up') ? 'bottom-full mb-2' : 'mt-2'} ${panelClassName}`}
        >
          {typeof children === 'function'
            ? children({ close: () => setOpen(false) })
            : children}
        </div>
      )}
    </div>
  );
};

export { Dropdown, visibleBoundsOf };
