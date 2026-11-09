import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Badge } from '../../../../../components';
import type { ProcessedResultGroup as ResultGroup } from '../../../search-page.types';
import { FormProcessDocumentSideOver } from '../FormProcessDocumentSideOver';
import type { FilterConfig } from '../frontend-information-extractor';
import type { MatchFiltersReader } from '../match-filters';

const I18N_NS = 'page.search.component.resultsPreviewSideOver';

/**
 * A document's text, opened from its row, with each of its matches' filter
 * labels — closed while `previewItem` is null.
 */
const ResultsPreviewSideOver = ({
  previewItem,
  onClose,
  filterConfigs,
  readMatchFilters,
}: {
  previewItem: ResultGroup | null;
  onClose: () => void;
  filterConfigs: FilterConfig[];
  readMatchFilters: MatchFiltersReader;
}) => {
  const { t } = useTranslation();

  return (
    <FormProcessDocumentSideOver
      isOpen={!!previewItem}
      onClose={onClose}
      title={previewItem?.docName || t(`${I18N_NS}.documentDetailsTitle`)}
      textFilePath={
        previewItem?.search?.doc?.textFilePath ||
        previewItem?.items[0]?.search?.doc?.textFilePath
      }
      highlightPhrases={
        previewItem?.items.map((item) => item.extracted.matchedText) ?? []
      }
    >
      {/* NOTE: the children has been comments and not used temporarily */}
      {previewItem && (
        <div className="space-y-4">
          {/* Header / Metadata only - context removed to avoid duplication */}
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              <Trans i18nKey={`${I18N_NS}.queryLabel`} />{' '}
              {previewItem.items[0]?.extracted?.searchQuery}
            </div>

            {/* Each match's filter labels */}
            <div className="mt-2 space-y-2">
              {previewItem.items.map((item, index) => {
                const { valueByFilterId } = readMatchFilters(item);

                return (
                  <div
                    key={index}
                    className="p-2 bg-gray-50 dark:bg-gray-700/50 rounded border border-gray-100 dark:border-gray-700"
                  >
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      <Trans
                        i18nKey={`${I18N_NS}.matchLabel`}
                        values={{ number: index + 1 }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {filterConfigs.map((config) => {
                        const value = valueByFilterId[config.id];

                        return (
                          value && (
                            <Badge
                              key={config.id}
                              label={config.labelFilterTitle}
                              value={value}
                              variant="blue"
                            />
                          )
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </FormProcessDocumentSideOver>
  );
};

export { ResultsPreviewSideOver };
