import React, { useEffect, useMemo, useRef, useState } from 'react';

interface FilterDropdownProps {
  label: string;
  items: string[];
  selectedItems: string[];
  onItemChange: (item: string) => void;
  dropdownTitle?: string;
  searchPlaceholder?: string;
  idPrefix?: string;
}

const FilterDropdown = ({
  label,
  items,
  selectedItems,
  onItemChange,
  dropdownTitle,
  searchPlaceholder = 'Фільтрувати...',
  idPrefix = 'filter',
}: FilterDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Reset filter text when closed
  useEffect(() => {
    if (!isOpen) {
      setFilterText('');
    }
  }, [isOpen]);

  const visibleItems = useMemo(() => {
    if (!filterText) return items;
    return items.filter((item) =>
      item.toLowerCase().includes(filterText.toLowerCase()),
    );
  }, [items, filterText]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative flex items-center justify-center w-full px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg md:w-auto focus:outline-none hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700 cursor-pointer"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="w-4 h-4 mr-2 text-gray-400"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z"
            clipRule="evenodd"
          />
        </svg>
        {label}
        <svg
          className={`-mr-1 ml-1.5 w-5 h-5 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
          fill="currentColor"
          viewBox="0 0 20 20"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            clipRule="evenodd"
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
          />
        </svg>
        {selectedItems.length > 0 && (
          <div className="absolute inline-flex items-center justify-center w-6 h-6 text-xs font-bold text-white bg-red-500 border-2 border-white rounded-full -top-2 -end-2 dark:border-gray-800">
            {selectedItems.length}
          </div>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 z-10 w-64 p-3 mt-2 bg-white rounded-lg shadow-lg dark:bg-gray-700 max-h-96 overflow-y-auto">
          <h6 className="mb-3 text-sm font-medium text-gray-900 dark:text-white">
            {dropdownTitle || label}
          </h6>
          <div className="mb-3">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder={searchPlaceholder}
              className="block w-full p-2 text-xs text-gray-900 border border-gray-300 rounded-lg bg-gray-50 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-600 dark:border-gray-500 dark:placeholder-gray-400 dark:text-white"
            />
          </div>
          <ul className="space-y-2 text-sm">
            {visibleItems.map((item) => (
              <li key={item} className="flex items-center">
                <input
                  id={`${idPrefix}-${item}`}
                  type="checkbox"
                  value={item}
                  checked={selectedItems.includes(item)}
                  onChange={() => onItemChange(item)}
                  className="w-4 h-4 bg-gray-100 border-gray-300 rounded text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-700 focus:ring-2 dark:bg-gray-600 dark:border-gray-500"
                />
                <label
                  htmlFor={`${idPrefix}-${item}`}
                  className="ml-2 text-sm font-medium text-gray-900 dark:text-gray-100 w-full cursor-pointer"
                >
                  {item}
                </label>
              </li>
            ))}
            {visibleItems.length === 0 && (
              <li className="text-xs text-gray-500 dark:text-gray-400 text-center py-2">
                Нічого не знайдено
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

export { FilterDropdown };
