import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { buildClipboardText } from '../doc-regex-parser.clipboard';

const I18N_NS = 'page.process.component.docRegexResultsTable';

interface DocRegexResultsTableColumn {
  id: string;
  label: string;
  // Not in the config's `columns` — shown only on demand, so styled apart.
  isIntermediate?: boolean;
  // The source file column — its cells open the document viewer.
  isFile?: boolean;
}

interface DocRegexResultsTableRow {
  key: string;
  documentIndex: number;
  // Rows of one document share a background, and the first of them gets a
  // top border, so where one document's rows end is visible at a glance.
  isFirstOfDocument: boolean;
  documentParity: 0 | 1;
  cells: Array<string | null>;
}

interface CellPosition {
  row: number;
  column: number;
}

interface SelectionRange {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const toRange = (
  anchor: CellPosition | null,
  focus: CellPosition | null,
): SelectionRange | null =>
  anchor && focus
    ? {
        top: Math.min(anchor.row, focus.row),
        bottom: Math.max(anchor.row, focus.row),
        left: Math.min(anchor.column, focus.column),
        right: Math.max(anchor.column, focus.column),
      }
    : null;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

// navigator.clipboard is missing outside secure contexts; the legacy
// execCommand path keeps copying working there too.
const writeToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
};

interface ResultRowProps {
  row: DocRegexResultsTableRow;
  rowIndex: number;
  columns: DocRegexResultsTableColumn[];
  // -1/-1 when the row is outside the selection. Passed as two numbers (not
  // the range object) so only rows entering or leaving the selection
  // re-render while the mouse drags across thousands of them.
  selectedLeft: number;
  selectedRight: number;
  onCellMouseDown: (
    event: React.MouseEvent,
    row: number,
    column: number,
  ) => void;
  onCellMouseEnter: (row: number, column: number) => void;
  onRowHeaderMouseDown: (event: React.MouseEvent, row: number) => void;
  onRowHeaderMouseEnter: (row: number) => void;
  onOpenDocument: (documentIndex: number) => void;
  openDocumentTitle: string;
}

const ResultRow = React.memo(
  ({
    row,
    rowIndex,
    columns,
    selectedLeft,
    selectedRight,
    onCellMouseDown,
    onCellMouseEnter,
    onRowHeaderMouseDown,
    onRowHeaderMouseEnter,
    onOpenDocument,
    openDocumentTitle,
  }: ResultRowProps) => {
    const isRowSelected = selectedLeft !== -1;
    const rowBackground =
      row.documentParity === 0
        ? 'bg-white dark:bg-gray-800'
        : 'bg-gray-50 dark:bg-gray-800/60';

    return (
      <tr
        className={`${rowBackground} ${
          row.isFirstOfDocument && rowIndex > 0
            ? 'border-t-2 border-gray-300 dark:border-gray-600'
            : 'border-t border-gray-100 dark:border-gray-700'
        }`}
      >
        <th
          scope="row"
          onMouseDown={(event) => onRowHeaderMouseDown(event, rowIndex)}
          onMouseEnter={() => onRowHeaderMouseEnter(rowIndex)}
          className={`sticky left-0 z-10 px-2 py-1.5 align-top text-right text-xs font-normal tabular-nums cursor-pointer border-r border-gray-200 dark:border-gray-700 ${
            isRowSelected
              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
          }`}
        >
          {rowIndex + 1}
        </th>
        {columns.map((column, columnIndex) => {
          const value = row.cells[columnIndex];
          const isSelected =
            columnIndex >= selectedLeft && columnIndex <= selectedRight;
          const isEmpty = value === null || value === '';

          return (
            <td
              key={column.id}
              onMouseDown={(event) =>
                onCellMouseDown(event, rowIndex, columnIndex)
              }
              onMouseEnter={() => onCellMouseEnter(rowIndex, columnIndex)}
              // Long values (e.g. a whole paragraph that is split into
              // rows, shown among the intermediate columns) are clamped on screen only — the
              // tooltip and every copy still carry the full value.
              title={value && value.length > 80 ? value : undefined}
              className={`px-3 py-1.5 align-top whitespace-pre-line break-words max-w-md border-r border-gray-100 dark:border-gray-700 ${
                isSelected
                  ? 'bg-blue-100 text-gray-900 dark:bg-blue-900/70 dark:text-white'
                  : isEmpty && !column.isFile
                    ? 'bg-amber-100 dark:bg-amber-900/40'
                    : column.isIntermediate
                      ? 'text-gray-500 dark:text-gray-400'
                      : 'text-gray-900 dark:text-gray-100'
              }`}
            >
              {column.isFile ? (
                <span className="flex items-start gap-1.5">
                  <button
                    type="button"
                    // Opening the viewer must not also start a selection.
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => onOpenDocument(row.documentIndex)}
                    title={openDocumentTitle}
                    className="shrink-0 mt-0.5 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 cursor-pointer"
                  >
                    <svg
                      className="w-4 h-4"
                      aria-hidden="true"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z"
                      />
                    </svg>
                  </button>
                  <span className="text-xs text-gray-600 dark:text-gray-300 break-all">
                    {value}
                  </span>
                </span>
              ) : (
                <span className="line-clamp-3">{value}</span>
              )}
            </td>
          );
        })}
      </tr>
    );
  },
);

const DocRegexResultsTable = ({
  columns,
  rows,
  isHeaderCopied,
  onOpenDocument,
  toolbarStart,
}: {
  columns: DocRegexResultsTableColumn[];
  rows: DocRegexResultsTableRow[];
  // Whether copying adds the column labels as the first line.
  isHeaderCopied: boolean;
  onOpenDocument: (documentIndex: number) => void;
  toolbarStart?: React.ReactNode;
}) => {
  const { t } = useTranslation();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = React.useState<CellPosition | null>(null);
  const [focus, setFocus] = React.useState<CellPosition | null>(null);
  const [copiedRowsCount, setCopiedRowsCount] = React.useState<number | null>(
    null,
  );
  // 'cells' — dragging from a cell; 'rows'/'columns' — from a row number or
  // a column header, which keep whole rows/columns selected while dragging.
  const dragModeRef = React.useRef<'cells' | 'rows' | 'columns' | null>(null);

  const range = toRange(anchor, focus);
  const lastRow = rows.length - 1;
  const lastColumn = columns.length - 1;

  // A selection is only meaningful for the grid it was made on.
  React.useEffect(() => {
    setAnchor(null);
    setFocus(null);
  }, [rows.length, columns.length]);

  React.useEffect(() => {
    const stopDragging = () => {
      dragModeRef.current = null;
    };
    window.addEventListener('mouseup', stopDragging);
    return () => window.removeEventListener('mouseup', stopDragging);
  }, []);

  React.useEffect(() => {
    if (copiedRowsCount === null) return;
    const timeoutId = setTimeout(() => setCopiedRowsCount(null), 2500);
    return () => clearTimeout(timeoutId);
  }, [copiedRowsCount]);

  const copyRange = React.useCallback(
    async (copiedRange: SelectionRange) => {
      const matrix = rows
        .slice(copiedRange.top, copiedRange.bottom + 1)
        .map((row) => row.cells.slice(copiedRange.left, copiedRange.right + 1));
      const header = columns
        .slice(copiedRange.left, copiedRange.right + 1)
        .map((column) => column.label);

      try {
        await writeToClipboard(
          buildClipboardText(isHeaderCopied ? [header, ...matrix] : matrix),
        );
        setCopiedRowsCount(matrix.length);
      } catch (error) {
        console.error('Failed to copy results', error);
      }
    },
    [rows, columns, isHeaderCopied],
  );

  const copyAll = () => {
    if (rows.length === 0 || columns.length === 0) return;
    copyRange({ top: 0, bottom: lastRow, left: 0, right: lastColumn });
  };

  const focusGrid = () => containerRef.current?.focus({ preventScroll: true });

  // Handlers are read through a ref so the memoised rows get the same
  // function identities on every render — otherwise each selection change
  // would re-render every row anyway.
  const handlersRef = React.useRef({
    onCellMouseDown: (_e: React.MouseEvent, _r: number, _c: number) => {},
    onCellMouseEnter: (_r: number, _c: number) => {},
    onRowHeaderMouseDown: (_e: React.MouseEvent, _r: number) => {},
    onRowHeaderMouseEnter: (_r: number) => {},
  });
  handlersRef.current = {
    onCellMouseDown: (event, row, column) => {
      if (event.button !== 0) return;
      // No native text selection fighting the cell selection.
      event.preventDefault();
      focusGrid();
      dragModeRef.current = 'cells';
      if (event.shiftKey && anchor) {
        setFocus({ row, column });
      } else {
        setAnchor({ row, column });
        setFocus({ row, column });
      }
    },
    onCellMouseEnter: (row, column) => {
      if (dragModeRef.current === 'cells') setFocus({ row, column });
      if (dragModeRef.current === 'rows') {
        setFocus({ row, column: lastColumn });
      }
      if (dragModeRef.current === 'columns') {
        setFocus({ row: lastRow, column });
      }
    },
    onRowHeaderMouseDown: (event, row) => {
      if (event.button !== 0) return;
      event.preventDefault();
      focusGrid();
      dragModeRef.current = 'rows';
      if (event.shiftKey && anchor) {
        setAnchor({ row: anchor.row, column: 0 });
      } else {
        setAnchor({ row, column: 0 });
      }
      setFocus({ row, column: lastColumn });
    },
    onRowHeaderMouseEnter: (row) => {
      if (dragModeRef.current === 'rows') {
        setFocus({ row, column: lastColumn });
      }
    },
  };

  const stableHandlers = React.useMemo(
    () => ({
      onCellMouseDown: (event: React.MouseEvent, row: number, column: number) =>
        handlersRef.current.onCellMouseDown(event, row, column),
      onCellMouseEnter: (row: number, column: number) =>
        handlersRef.current.onCellMouseEnter(row, column),
      onRowHeaderMouseDown: (event: React.MouseEvent, row: number) =>
        handlersRef.current.onRowHeaderMouseDown(event, row),
      onRowHeaderMouseEnter: (row: number) =>
        handlersRef.current.onRowHeaderMouseEnter(row),
    }),
    [],
  );

  const handleColumnHeaderMouseDown = (
    event: React.MouseEvent,
    column: number,
  ) => {
    if (event.button !== 0 || rows.length === 0) return;
    event.preventDefault();
    focusGrid();
    dragModeRef.current = 'columns';
    if (event.shiftKey && anchor) {
      setAnchor({ row: 0, column: anchor.column });
    } else {
      setAnchor({ row: 0, column });
    }
    setFocus({ row: lastRow, column });
  };

  const handleColumnHeaderMouseEnter = (column: number) => {
    if (dragModeRef.current === 'columns') {
      setFocus({ row: lastRow, column });
    }
  };

  const selectAll = () => {
    if (rows.length === 0 || columns.length === 0) return;
    setAnchor({ row: 0, column: 0 });
    setFocus({ row: lastRow, column: lastColumn });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const isModifierPressed = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    // event.code too: with the Ukrainian layout active, Ctrl+C reports
    // key "с" (Cyrillic), not "c".
    if (isModifierPressed && (key === 'c' || event.code === 'KeyC')) {
      if (range) {
        event.preventDefault();
        copyRange(range);
      }
      return;
    }
    if (isModifierPressed && (key === 'a' || event.code === 'KeyA')) {
      event.preventDefault();
      selectAll();
      return;
    }
    if (event.key === 'Escape') {
      setAnchor(null);
      setFocus(null);
      return;
    }

    const moveBy: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const move = moveBy[event.key];
    if (!move || !focus || rows.length === 0) return;

    event.preventDefault();
    const next = {
      row: clamp(focus.row + move[0], 0, lastRow),
      column: clamp(focus.column + move[1], 0, lastColumn),
    };
    setFocus(next);
    if (!event.shiftKey) setAnchor(next);
  };

  const isAllSelected =
    range !== null &&
    range.top === 0 &&
    range.left === 0 &&
    range.bottom === lastRow &&
    range.right === lastColumn;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {toolbarStart}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {copiedRowsCount !== null && (
            <span className="bg-green-100 text-green-800 text-xs font-medium px-2 py-1 rounded dark:bg-green-900 dark:text-green-100">
              {t(`${I18N_NS}.copiedMessage`, { count: copiedRowsCount })}
            </span>
          )}
          <button
            type="button"
            onClick={() => range && copyRange(range)}
            disabled={!range}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg enabled:hover:bg-gray-100 enabled:hover:text-blue-700 focus:ring-4 focus:outline-none focus:ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:enabled:hover:text-white dark:enabled:hover:bg-gray-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            <Trans i18nKey={`${I18N_NS}.copySelectedButton`} />
          </button>
          <button
            type="button"
            onClick={copyAll}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg enabled:hover:bg-blue-700 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-600 dark:enabled:hover:bg-blue-700 dark:focus:ring-blue-800 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            <svg
              className="w-4 h-4"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <Trans i18nKey={`${I18N_NS}.copyAllButton`} />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        role="grid"
        aria-multiselectable="true"
        aria-label={t(`${I18N_NS}.gridLabel`)}
        className="relative max-h-[65vh] overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 select-none"
      >
        <table className="min-w-full text-sm text-left border-collapse">
          <thead className="sticky top-0 z-20 text-xs text-gray-700 bg-gray-100 dark:bg-gray-700 dark:text-gray-300">
            <tr>
              <th
                scope="col"
                onMouseDown={(event) => {
                  event.preventDefault();
                  focusGrid();
                  selectAll();
                }}
                title={t(`${I18N_NS}.selectAllTitle`)}
                className={`sticky left-0 z-30 w-10 min-w-10 px-2 py-2 cursor-pointer border-r border-b border-gray-200 dark:border-gray-600 ${
                  isAllSelected
                    ? 'bg-blue-200 dark:bg-blue-800'
                    : 'bg-gray-200 dark:bg-gray-600'
                }`}
              />
              {columns.map((column, columnIndex) => {
                const isSelected =
                  range !== null &&
                  columnIndex >= range.left &&
                  columnIndex <= range.right;

                return (
                  <th
                    key={column.id}
                    scope="col"
                    onMouseDown={(event) =>
                      handleColumnHeaderMouseDown(event, columnIndex)
                    }
                    onMouseEnter={() =>
                      handleColumnHeaderMouseEnter(columnIndex)
                    }
                    title={
                      column.isIntermediate
                        ? t(`${I18N_NS}.intermediateColumnTitle`, {
                            id: column.id,
                          })
                        : column.id
                    }
                    className={`px-3 py-2 font-semibold whitespace-nowrap cursor-pointer border-r border-b border-gray-200 dark:border-gray-600 ${
                      isSelected
                        ? 'bg-blue-200 text-blue-900 dark:bg-blue-800 dark:text-white'
                        : ''
                    } ${column.isIntermediate ? 'italic font-normal text-gray-500 dark:text-gray-400' : ''}`}
                  >
                    {column.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const isInRange =
                range !== null &&
                rowIndex >= range.top &&
                rowIndex <= range.bottom;

              return (
                <ResultRow
                  key={row.key}
                  row={row}
                  rowIndex={rowIndex}
                  columns={columns}
                  selectedLeft={isInRange ? range.left : -1}
                  selectedRight={isInRange ? range.right : -1}
                  onCellMouseDown={stableHandlers.onCellMouseDown}
                  onCellMouseEnter={stableHandlers.onCellMouseEnter}
                  onRowHeaderMouseDown={stableHandlers.onRowHeaderMouseDown}
                  onRowHeaderMouseEnter={stableHandlers.onRowHeaderMouseEnter}
                  onOpenDocument={onOpenDocument}
                  openDocumentTitle={t(`${I18N_NS}.openDocumentTitle`)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        <Trans i18nKey={`${I18N_NS}.selectionHint`} />
      </p>
    </div>
  );
};

export { DocRegexResultsTable };
export type { DocRegexResultsTableColumn, DocRegexResultsTableRow };
