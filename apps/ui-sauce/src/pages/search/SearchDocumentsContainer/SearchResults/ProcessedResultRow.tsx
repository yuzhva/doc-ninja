import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import {
  Badge,
  BadgeCounter,
  ButtonCopyToClipboard,
  Tooltip,
} from '../../../../components';
import type { ProcessedResultGroup as ResultGroup } from '../../search-page.types';
import { HighlightedText } from './FormProcessDocumentSideOver';
import type { DocmGeneratePayload } from './components/FPDDocmTemplatesDropdown';
import { FPDDocmTemplatesDropdown } from './components/FPDDocmTemplatesDropdown';
import { calculateDynamicValues } from './result-helpers';
import type { ExtractedTableField } from './result-helpers';

const I18N_NS = 'page.search.component.processedResultRow';

// Component for individual expandable row
const ProcessedResultRow = ({
  result,
  isExpanded,
  onToggleExpand,
  onOpenFile,
  onViewContent,
  filterConfigs, // Add prop
  tableFields,
  primaryFieldId,
  templateTagFieldIds,
  onBtnGenerateDocmClick,
  addToast,
}: {
  result: ResultGroup;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenFile: (result: ResultGroup) => void;
  onViewContent: (result: ResultGroup) => void;
  filterConfigs: any[]; // Add type
  tableFields: ExtractedTableField[];
  primaryFieldId: string | null;
  templateTagFieldIds: string[];
  onBtnGenerateDocmClick: (payload: DocmGeneratePayload) => void;
  addToast: (type: 'success' | 'error' | 'warning', content: string) => void;
}) => {
  const { t } = useTranslation();
  // Aggregate data from items in the group
  const items = result.items;
  const firstItem = items[0];
  const docName = result.docName || firstItem?.extracted?.foundInDocument;
  const filePath = result.search?.doc?.originalFilePath;

  // Pre-calculate dynamic values for each item in this group
  // Returns: [ { item: item, dynamicValues: { [filterId]: string | null } }, ... ]
  const enrichedItems = React.useMemo(() => {
    return items.map((item) => {
      const dynamicValues = calculateDynamicValues(
        item,
        filterConfigs,
        primaryFieldId,
      );
      return { item, dynamicValues };
    });
  }, [items, filterConfigs, primaryFieldId]);

  // Aggregate unique values for the closed row view (e.g. show all statuses found in group)
  const aggregatedValues = React.useMemo(() => {
    const agg: Record<string, Set<string>> = {};
    filterConfigs.forEach((conf) => {
      agg[conf.id] = new Set();
    });

    enrichedItems.forEach(({ dynamicValues }) => {
      Object.entries(dynamicValues).forEach(([id, val]) => {
        if (val) agg[id]?.add(val as string);
      });
    });

    return agg;
  }, [enrichedItems, filterConfigs]);

  return (
    <React.Fragment>
      <tr className="group bg-white border-b dark:bg-gray-800 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
        {/* z-10 */}
        <td className="sticky left-0 bg-white dark:bg-gray-800 group-hover:bg-gray-100 dark:group-hover:bg-gray-700 shadow-[inset_-1px_0_0_0_#e5e7eb] dark:shadow-[inset_-1px_0_0_0_#374151] transition-colors whitespace-nowrap align-middle">
          <div className="flex items-center gap-3 mx-6 my-4">
            {/* Collapse/Expand Toggle */}
            <button
              type="button"
              onClick={onToggleExpand}
              className="p-1 rounded-full text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-600 transition-colors focus:outline-none"
              title={
                isExpanded
                  ? t(`${I18N_NS}.collapseTitle`)
                  : t(`${I18N_NS}.expandTitle`)
              }
            >
              <svg
                className={`w-4 h-4 transition-transform duration-200 ${
                  isExpanded ? 'rotate-0' : '-rotate-90'
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

            <div className="flex flex-col">
              {/* Document Name - Toggle SideOver */}
              <div
                className="flex items-center text-blue-600 dark:text-blue-400 cursor-pointer hover:underline font-medium"
                onClick={() => onViewContent(result)}
                title={t(`${I18N_NS}.viewContextTitle`)}
              >
                <span>{docName}</span>
                {items.length > 1 && (
                  <BadgeCounter
                    count={items.length}
                    variant="yellow"
                    className="ml-2"
                  />
                )}
              </div>
            </div>
          </div>
        </td>

        {/* Path Column - Open File */}
        <td className="px-6 py-4 align-middle max-w-xs">
          <div
            className={`${
              window.electronAPI
                ? 'text-gray-600 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 cursor-pointer underline decoration-dotted'
                : 'text-gray-600 dark:text-gray-400 cursor-pointer'
            } text-xs truncate dir-rtl`}
            onClick={() => onOpenFile(result)}
            title={filePath || t(`${I18N_NS}.filePathFallback`)}
            style={{ direction: 'rtl', textAlign: 'left' }} // RTL trick for left truncation
          >
            {/* Force LTR inside so text reads correctly but truncates from the left */}
            <span style={{ direction: 'ltr', unicodeBidi: 'embed' }}>
              {filePath || '---'}
            </span>
          </div>
        </td>

        {/* Dynamic Columns based on Parser Schema TABLE fields */}
        {tableFields.map((field) => (
          <td
            key={field.id}
            className="px-6 py-4 whitespace-nowrap align-middle text-center text-sm text-gray-700 dark:text-gray-300 font-medium"
          >
            {firstItem?.extracted?.extractedFieldById[field.id] || '---'}
          </td>
        ))}

        {/* Dynamic Columns based on Filter Configs */}
        {filterConfigs.map((conf, index) => {
          const uniqueVals = Array.from(aggregatedValues[conf.id] || []);
          return (
            <td
              key={conf.id || index}
              className="px-6 py-4 whitespace-nowrap align-middle text-center"
            >
              {uniqueVals.length > 0 ? (
                <div className="flex flex-col gap-1 items-center">
                  {uniqueVals.map((val, idx) => (
                    <Badge
                      key={idx}
                      label={conf.labelFilterTitle}
                      value={val}
                      variant="blue"
                      hideLabel
                    />
                  ))}
                </div>
              ) : (
                '---'
              )}
            </td>
          );
        })}
      </tr>

      {/* Expanded Content Row */}
      {isExpanded && (
        <tr className="bg-gray-50 dark:bg-gray-900/40 border-b dark:border-gray-700">
          <td colSpan={2 + tableFields.length + filterConfigs.length}>
            {/* z-10 */}
            <div className="sticky left-0 w-[100cqw] bg-gray-50 dark:bg-gray-900/40 py-4 pl-10 pr-6 text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
              {enrichedItems.map(({ item, dynamicValues }, idx: number) => (
                <div
                  key={idx}
                  className={
                    idx > 0
                      ? 'mt-4 pt-4 border-t border-gray-200 dark:border-gray-700'
                      : ''
                  }
                >
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    {items.length > 1 && (
                      <>
                        {enrichedItems.length > 1 && (
                          <BadgeCounter count={idx + 1} variant="gray" />
                        )}

                        {/* Dynamic Badges for item */}
                        {filterConfigs.map((conf) => {
                          const val = dynamicValues[conf.id];
                          if (!val) return null;
                          return (
                            <Badge
                              key={conf.id}
                              label={conf.labelFilterTitle}
                              value={val}
                              // variant="purple"
                              variant="blue"
                            />
                          );
                        })}
                      </>
                    )}
                  </div>

                  <div className="relative group">
                    <HighlightedText
                      text={
                        (primaryFieldId &&
                          item.extracted.extractedFieldById[primaryFieldId]) ??
                        ''
                      }
                      highlights={[item.extracted.matchedText]}
                    />
                    <div className="flex items-center justify-end gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Tooltip
                        content={<Trans i18nKey={`${I18N_NS}.copyTooltip`} />}
                        placement="top"
                        align="end"
                      >
                        <ButtonCopyToClipboard
                          textToCopy={
                            (primaryFieldId &&
                              item.extracted.extractedFieldById[
                                primaryFieldId
                              ]) ??
                            ''
                          }
                          placement="left"
                        />
                      </Tooltip>
                      <FPDDocmTemplatesDropdown
                        items={[item]}
                        templateTagFieldIds={templateTagFieldIds}
                        onGenerate={onBtnGenerateDocmClick}
                        addToast={addToast}
                        openDirection="up"
                        renderTrigger={({ toggle }) => (
                          <div className="flex">
                            <Tooltip
                              content={
                                <Trans
                                  i18nKey={`${I18N_NS}.generateDocmTooltip`}
                                />
                              }
                              placement="top"
                              align="end"
                            >
                              <button
                                type="button"
                                onClick={toggle}
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none transition-colors p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                              >
                                <svg
                                  className="w-4 h-4"
                                  xmlns="http://www.w3.org/2000/svg"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  strokeWidth="2"
                                  stroke="currentColor"
                                  aria-hidden="true"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M10 3v4a1 1 0 0 1-1 1H5m4 8h6m-6-4h6m4-8v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1Z"
                                  />
                                </svg>
                              </button>
                            </Tooltip>
                          </div>
                        )}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
};

export { ProcessedResultRow };
