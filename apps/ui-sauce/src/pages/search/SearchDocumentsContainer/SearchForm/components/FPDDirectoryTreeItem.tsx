import React from 'react';
import { useTranslation } from 'react-i18next';
import { FileSystemItem } from 'toolkit--local/browser';

import { Checkbox } from '../../../../../components';

const I18N_NS = 'page.search.component.fpdDirectoryTreeItem';

const FPDDirectoryTreeItem = ({
  fsNestedItem,
  selectedPaths,
  onTogglePath,
}: {
  fsNestedItem: FileSystemItem;
  selectedPaths: Set<string>;
  onTogglePath: (path: string, checked: boolean) => void;
}) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = React.useState(false);
  const isSelected = selectedPaths.has(fsNestedItem.path);
  const hasChildren =
    fsNestedItem.fsNestedItems && fsNestedItem.fsNestedItems.length > 0;
  const isDirectory = fsNestedItem.fsItemType === 'directory';

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  const handleContentClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onTogglePath(fsNestedItem.path, !isSelected);
  };

  return (
    <div className="w-full">
      <div className="flex items-center gap-x-0.5 w-full py-0.5">
        {/* Toggle Button */}
        <button
          type="button"
          className={`shrink-0 w-6 h-6 flex justify-center items-center hover:bg-gray-100 rounded-md focus:outline-none focus:bg-gray-100 disabled:opacity-50 disabled:pointer-events-none dark:hover:bg-gray-700 dark:focus:bg-gray-700 ${!hasChildren ? 'invisible' : ''}`}
          onClick={handleToggleExpand}
          aria-label={t(
            isExpanded ? `${I18N_NS}.collapseLabel` : `${I18N_NS}.expandLabel`,
          )}
        >
          <svg
            className={`w-4 h-4 text-gray-800 dark:text-gray-200 transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>

        {/* Content */}
        <div className="grow flex items-center gap-x-2 px-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">
          {/* The app's own box, as in the folder's header and the results */}
          <Checkbox
            checked={isSelected}
            onChange={(checked) => onTogglePath(fsNestedItem.path, checked)}
            title={fsNestedItem.name}
            className="shrink-0"
          />

          {/* Icon & Name */}
          <div
            className="flex items-center gap-x-2 cursor-pointer grow py-1"
            onClick={handleContentClick}
          >
            <svg
              className="shrink-0 w-4 h-4 text-gray-500 dark:text-gray-400"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {isDirectory ? (
                <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path>
              ) : (
                <>
                  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path>
                  <path d="M14 2v4a2 2 0 0 0 2 2h4"></path>
                </>
              )}
            </svg>
            <span className="text-sm text-gray-800 dark:text-gray-200 select-none">
              {fsNestedItem.name}{' '}
              {(fsNestedItem.fsFileCount || 0) > 0 && (
                <span className="text-xs text-gray-400">
                  ({fsNestedItem.fsFileCount})
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="pl-7 relative before:absolute before:top-0 before:left-3 before:w-0.5 before:-ml-px before:h-full before:bg-gray-100 dark:before:bg-gray-700">
          {fsNestedItem.fsNestedItems?.map((child: FileSystemItem) => (
            <FPDDirectoryTreeItem
              key={child.path}
              fsNestedItem={child}
              selectedPaths={selectedPaths}
              onTogglePath={onTogglePath}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export { FPDDirectoryTreeItem };
