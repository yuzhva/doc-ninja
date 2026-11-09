import React from 'react';
import { Trans } from 'react-i18next';

import { ButtonSaveXlsx } from './ButtonSaveXlsx';
import type { DocmTemplatesPanelProps } from './DocmTemplatesPanel';
import { FPDDocmTemplatesDropdown } from './FPDDocmTemplatesDropdown';

const I18N_NS = 'page.search.component.selectionBar';

type SelectionBarProps = Pick<
  DocmTemplatesPanelProps,
  'templateTagFieldIds' | 'primaryFieldId' | 'onGenerate' | 'addToast'
> & {
  // The ticked matches, in table order
  selectedItems: { extracted: any }[];
  onClearSelection: () => void;
  onExportXlsx: (items: { extracted: any }[]) => void;
};

// Laid over the toolbar's first row while any match is ticked: how many are,
// and the two exports — of just those. Same padding and control height as
// the row beneath, so the export buttons land exactly on top of their
// counterparts. `min-h-full` rather than `inset-0` so it can still grow if
// its own content ever wraps taller than the row. The very same tint as a
// selected match, so the two read as one thing without the bar pulling the
// eye.
const SelectionBar = ({
  selectedItems,
  onClearSelection,
  onExportXlsx,
  templateTagFieldIds,
  primaryFieldId,
  onGenerate,
  addToast,
}: SelectionBarProps) => (
  <div className="absolute inset-x-0 top-0 z-20 min-h-full flex flex-wrap items-center gap-2 p-4 bg-yellow-100 text-gray-900 dark:bg-yellow-300/10 dark:text-gray-100 sm:rounded-t-lg">
    <div className="flex items-center gap-3 text-sm">
      <span>
        <Trans
          i18nKey={`${I18N_NS}.selectedMatchesCount`}
          count={selectedItems.length}
          components={{ bold: <span className="font-semibold" /> }}
        />
      </span>
      <button
        type="button"
        onClick={onClearSelection}
        className="text-blue-600 underline dark:text-blue-400 cursor-pointer"
      >
        <Trans i18nKey={`${I18N_NS}.clearSelectionButton`} />
      </button>
    </div>

    <div className="flex-grow" />

    <FPDDocmTemplatesDropdown
      items={selectedItems}
      templateTagFieldIds={templateTagFieldIds}
      primaryFieldId={primaryFieldId}
      onGenerate={onGenerate}
      addToast={addToast}
    />

    <ButtonSaveXlsx onClick={() => onExportXlsx(selectedItems)} />
  </div>
);

export { SelectionBar };
