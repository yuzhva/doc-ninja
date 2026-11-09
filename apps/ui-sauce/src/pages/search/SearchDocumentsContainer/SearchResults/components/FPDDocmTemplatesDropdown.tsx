import React from 'react';
import { Trans } from 'react-i18next';

import { Dropdown } from '../../../../../components';
import {
  DocmTemplateRemovalConfirm,
  DocmTemplatesPanel,
} from './DocmTemplatesPanel';
import type { DocmTemplatesPanelProps } from './DocmTemplatesPanel';
import type { DocmTemplate } from './docm-templates-store';

const I18N_NS = 'page.search.component.fpdDocmTemplatesDropdown';

const TriggerButton = ({
  isOpen,
  toggle,
  hasResults,
}: {
  isOpen: boolean;
  toggle: () => void;
  hasResults: boolean;
}) => {
  const dynamicClassName = !hasResults
    ? 'opacity-50 cursor-not-allowed'
    : 'cursor-pointer hover:bg-gray-100 hover:text-blue-700';

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!hasResults}
      className={`flex items-center justify-center flex-shrink-0 px-3 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg focus:outline-none focus:z-10 focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700 ${dynamicClassName}`}
    >
      <svg
        className="w-4 h-4 mr-2"
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
      <Trans i18nKey={`${I18N_NS}.saveTriggerLabel`} />
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
    </button>
  );
};

/**
 * The toolbar's .docm button, for many matches at once: everything in the
 * tables, or just the ticked ones. A single match's own button opens the
 * page's one MatchDocmMenu instead.
 */
const FPDDocmTemplatesDropdown = ({
  items,
  templateTagFieldIds,
  primaryFieldId,
  onGenerate,
  addToast,
}: Pick<
  DocmTemplatesPanelProps,
  'items' | 'templateTagFieldIds' | 'primaryFieldId' | 'onGenerate' | 'addToast'
>) => {
  const [isGeneratingSeparateFiles, setIsGeneratingSeparateFiles] =
    React.useState(false);
  const [templatePendingRemoval, setTemplatePendingRemoval] =
    React.useState<DocmTemplate | null>(null);

  return (
    <>
      <Dropdown
        panelClassName="w-80 right-0 bg-white dark:bg-gray-800"
        trigger={({ isOpen, toggle }) => (
          <TriggerButton
            isOpen={isOpen}
            toggle={toggle}
            hasResults={items.length > 0}
          />
        )}
      >
        <DocmTemplatesPanel
          items={items}
          templateTagFieldIds={templateTagFieldIds}
          primaryFieldId={primaryFieldId}
          onGenerate={onGenerate}
          addToast={addToast}
          isGeneratingSeparateFiles={isGeneratingSeparateFiles}
          onGeneratingSeparateFilesChange={setIsGeneratingSeparateFiles}
          onTemplateRemovalRequest={setTemplatePendingRemoval}
        />
      </Dropdown>

      {/* Outside the menu: clicking the modal closes the menu, and that must
          not take the modal down with it. */}
      <DocmTemplateRemovalConfirm
        template={templatePendingRemoval}
        onClose={() => setTemplatePendingRemoval(null)}
      />
    </>
  );
};

export { FPDDocmTemplatesDropdown };
