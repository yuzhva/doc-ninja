import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ButtonCopyToClipboard, Tooltip } from '../../../../components';
import type { ProcessedResultGroup as ResultGroup } from '../../search-page.types';
import { ProcessedResultRow } from './ProcessedResultRow';
import type { DocmGeneratePayload } from './components/FPDDocmTemplatesDropdown';
import type { ExtractedTableField } from './result-helpers';

const I18N_NS = 'page.search.component.processedResultGroup';

const ProcessedResultGroup = ({
  searchQuery,
  items,
  onViewContent,
  filterConfigs, // Add prop
  tableFields,
  primaryFieldId,
  templateTagFieldIds,
  onBtnGenerateDocmClick,
  addToast,
}: {
  searchQuery: string;
  items: ResultGroup[];
  onViewContent: (item: ResultGroup) => void;
  filterConfigs: any[]; // Add prop type
  tableFields: ExtractedTableField[];
  primaryFieldId: string | null;
  templateTagFieldIds: string[];
  onBtnGenerateDocmClick: (payload: DocmGeneratePayload) => void;
  addToast: (type: 'success' | 'error' | 'warning', content: string) => void;
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(true);

  // State to track expanded rows (using index as key for simplicity in this context)
  // Initialize with all expanded (true)
  const [expandedRows, setExpandedRows] = React.useState<Set<number>>(
    () => new Set(items.map((_, i) => i)),
  );

  const areAllExpanded = expandedRows.size === items.length;

  const handleToggleAll = () => {
    if (areAllExpanded) {
      // Collapse all
      setExpandedRows(new Set());
    } else {
      // Expand all
      setExpandedRows(new Set(items.map((_, i) => i)));
    }
  };

  const handleToggleRow = (index: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleOpenFile = async (result: ResultGroup) => {
    // Attempt to resolve file path from result metadata (now nested in .search.doc)
    const filePath = result.search?.doc?.originalFilePath;

    if (!filePath) {
      console.warn('No file path found for result', result);
      return;
    }

    if (window.electronAPI?.openPath) {
      // Electron environment: Open file directly
      try {
        const error = await window.electronAPI.openPath(filePath);
        if (error) {
          console.error('Electron openPath failed:', error);
          alert(`Failed to open file: ${error}`);
        }
      } catch (e) {
        console.error('Failed to open file via Electron', e);
        alert('Error invoking openPath via Electron bridge.');
      }
    } else {
      // Browser fallback: Copy path to clipboard with explanatory message
      try {
        await navigator.clipboard.writeText(filePath);
        alert(
          `Opening local files is only supported in the Desktop application.\n\nPath copied to clipboard:\n${filePath}`,
        );
      } catch (err) {
        console.error('Failed to copy path', err);
      }
    }
  };

  return (
    <div className="relative overflow-hidden shadow-md sm:rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between bg-gray-50 px-6 py-3 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
        <h3 className="text-sm font-bold uppercase text-gray-700 dark:text-gray-200 flex items-center gap-2">
          <span>
            <Trans i18nKey={`${I18N_NS}.resultsForLabel`} />
          </span>
          <span className="text-blue-600 dark:text-blue-400">
            {searchQuery}
          </span>
          <Tooltip
            content={<Trans i18nKey={`${I18N_NS}.copyTooltip`} />}
            placement="bottom"
          >
            <ButtonCopyToClipboard textToCopy={searchQuery} placement="right" />
          </Tooltip>
        </h3>
        <button
          type="button"
          className="inline-flex items-center p-2 text-sm text-gray-500 rounded-lg hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600 cursor-pointer"
          onClick={() => setIsOpen(!isOpen)}
        >
          <svg
            className={`w-6 h-6 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            ></path>
          </svg>
        </button>
      </div>
      {isOpen && (
        <div className="overflow-x-auto @container">
          <table className="w-full text-left text-sm text-gray-500 dark:text-gray-400 min-w-full divide-y divide-gray-200 dark:divide-gray-600">
            <thead className="bg-gray-50 text-xs uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-400 bg-gray-100 dark:bg-gray-700">
              <tr>
                <th className="sticky left-0 z-20 bg-gray-100 dark:bg-gray-700 shadow-[inset_-1px_0_0_0_#e5e7eb] dark:shadow-[inset_-1px_0_0_0_#4b5563] px-6 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleToggleAll}
                      className="p-1 rounded-full text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-600 transition-colors focus:outline-none"
                      title={
                        areAllExpanded
                          ? t(`${I18N_NS}.collapseAllTitle`)
                          : t(`${I18N_NS}.expandAllTitle`)
                      }
                    >
                      <svg
                        className={`w-4 h-4 transition-transform duration-200 ${
                          areAllExpanded ? 'rotate-0' : '-rotate-90'
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </button>
                    <Trans i18nKey={`${I18N_NS}.fileNameHeader`} />
                  </div>
                </th>
                <th className="px-6 py-3 whitespace-nowrap">
                  <Trans i18nKey={`${I18N_NS}.pathHeader`} />
                </th>
                {/* Dynamic Headers based on Parser Schema TABLE fields */}
                {tableFields.map((field) => (
                  <th
                    key={field.id}
                    className="px-6 py-3 whitespace-nowrap w-px text-center"
                  >
                    {field.label}
                  </th>
                ))}
                {/* Dynamic Headers */}
                {filterConfigs.map((conf, idx) => (
                  <th
                    key={conf.id || idx}
                    className="px-6 py-3 whitespace-nowrap w-px text-center"
                  >
                    {conf.labelFilterTitle}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
              {items.map((result, index) => (
                <ProcessedResultRow
                  key={index}
                  result={result}
                  isExpanded={expandedRows.has(index)}
                  onToggleExpand={() => handleToggleRow(index)}
                  onOpenFile={handleOpenFile}
                  onViewContent={onViewContent}
                  filterConfigs={filterConfigs} // Pass config
                  tableFields={tableFields}
                  primaryFieldId={primaryFieldId}
                  templateTagFieldIds={templateTagFieldIds}
                  onBtnGenerateDocmClick={onBtnGenerateDocmClick}
                  addToast={addToast}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export { ProcessedResultGroup };
