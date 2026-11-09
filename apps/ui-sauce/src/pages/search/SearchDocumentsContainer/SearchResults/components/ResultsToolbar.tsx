import React from 'react';

import { ButtonSaveXlsx } from './ButtonSaveXlsx';
import type { DocmTemplatesPanelProps } from './DocmTemplatesPanel';
import { FPDDocmTemplatesDropdown } from './FPDDocmTemplatesDropdown';
import { MaxResultsCounter } from './MaxResultsCounter';
import { ResultsFilterBox } from './ResultsFilterBox';
import { SelectionBar } from './SelectionBar';

type ResultsToolbarProps = Pick<
  DocmTemplatesPanelProps,
  'templateTagFieldIds' | 'primaryFieldId' | 'onGenerate' | 'addToast'
> & {
  // What the results are narrowed down by now. Each control below holds what
  // it shows itself, starting from these, and hands changes back as
  // transitions — typing never waits for the tables.
  appliedSearchTerm: string;
  onAppliedSearchTermChange: (term: string) => void;
  maxResults: string;
  onMaxResultsChange: (value: string) => void;
  // Everything in the tables, and the ticked matches, in table order
  items: { extracted: any }[];
  selectedItems: { extracted: any }[];
  // Whether the selection bar is laid over the row
  isSelectionActive: boolean;
  onClearSelection: () => void;
  onExportXlsx: (items: { extracted: any }[]) => void;
};

/**
 * The results' first toolbar row: the text filter, the per-query cap and the
 * two exports of everything shown — with the selection bar laid over it
 * while any match is ticked.
 */
const ResultsToolbar = ({
  appliedSearchTerm,
  onAppliedSearchTermChange,
  maxResults,
  onMaxResultsChange,
  items,
  selectedItems,
  isSelectionActive,
  onClearSelection,
  onExportXlsx,
  templateTagFieldIds,
  primaryFieldId,
  onGenerate,
  addToast,
}: ResultsToolbarProps) => (
  <div className="relative">
    {/* Hidden rather than merely covered: the bar's tint is translucent in
        dark mode, and `invisible` also keeps Tab and screen readers off
        controls nobody can see — while still holding the row's height for
        the bar to fill. */}
    <div
      className={`flex flex-wrap items-center gap-2 p-4 ${
        isSelectionActive ? 'invisible' : ''
      }`}
    >
      <ResultsFilterBox
        initialAppliedTerm={appliedSearchTerm}
        onAppliedTermChange={onAppliedSearchTermChange}
      />

      <MaxResultsCounter
        initialValue={maxResults}
        onChange={onMaxResultsChange}
      />

      <div className="flex-grow" />

      <FPDDocmTemplatesDropdown
        items={items}
        templateTagFieldIds={templateTagFieldIds}
        primaryFieldId={primaryFieldId}
        onGenerate={onGenerate}
        addToast={addToast}
      />

      <ButtonSaveXlsx
        onClick={() => onExportXlsx(items)}
        disabled={items.length === 0}
      />
    </div>

    {isSelectionActive && (
      <SelectionBar
        selectedItems={selectedItems}
        onClearSelection={onClearSelection}
        onExportXlsx={onExportXlsx}
        templateTagFieldIds={templateTagFieldIds}
        primaryFieldId={primaryFieldId}
        onGenerate={onGenerate}
        addToast={addToast}
      />
    )}
  </div>
);

export { ResultsToolbar };
