import React from 'react';

interface DropdownProps {
  trigger: (args: { isOpen: boolean; toggle: () => void }) => React.ReactNode;
  children: React.ReactNode;
  panelClassName?: string;
  openDirection?: 'down' | 'up';
  onOpenChange?: (isOpen: boolean) => void;
}

const Dropdown = ({
  trigger,
  children,
  panelClassName = 'w-64 right-0 bg-white dark:bg-gray-700',
  openDirection = 'down',
  onOpenChange,
}: DropdownProps) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

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
          className={`absolute z-30 p-3 rounded-lg border border-gray-200 shadow-lg max-h-96 overflow-y-auto dark:border-gray-600 ${openDirection === 'up' ? 'bottom-full mb-2' : 'mt-2'} ${panelClassName}`}
        >
          {children}
        </div>
      )}
    </div>
  );
};

export { Dropdown };
