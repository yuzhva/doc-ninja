import type { ProcessedResultGroup } from '../../search-page.types';
import { calculateDynamicValues } from './result-helpers';

type SortDirection = 'asc' | 'desc';

interface ResultsSortState {
  columnId: string;
  direction: SortDirection;
}

// The two columns every results table has, whatever parser config is selected.
// Prefixed so they can never collide with a schema field id or a filter id,
// which is what the remaining columns are keyed by.
const DOC_NAME_SORT_COLUMN_ID = '__docName';
const FILE_PATH_SORT_COLUMN_ID = '__filePath';

// File name ascending — the one ordering that stays meaningful no matter which
// parser config (and therefore which set of dynamic columns) is in play.
const DEFAULT_RESULTS_SORT: ResultsSortState = {
  columnId: DOC_NAME_SORT_COLUMN_ID,
  direction: 'asc',
};

const RESULTS_SORT_STORAGE_KEY = 'docNinja_resultsSortOrder';

const readStoredResultsSort = (): ResultsSortState => {
  if (typeof window === 'undefined') return DEFAULT_RESULTS_SORT;

  try {
    const saved = window.localStorage.getItem(RESULTS_SORT_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (
        typeof parsed?.columnId === 'string' &&
        (parsed.direction === 'asc' || parsed.direction === 'desc')
      ) {
        return { columnId: parsed.columnId, direction: parsed.direction };
      }
    }
  } catch (e) {
    console.warn('Failed to load results sort order from storage', e);
  }

  return DEFAULT_RESULTS_SORT;
};

const writeStoredResultsSort = (sort: ResultsSortState) => {
  try {
    window.localStorage.setItem(RESULTS_SORT_STORAGE_KEY, JSON.stringify(sort));
  } catch (e) {
    console.warn('Failed to persist results sort order', e);
  }
};

// What the collapsed row actually prints in that column — sorting on anything
// else would put the rows in an order the user can't read off the screen.
// Mirrors ProcessedResultRow cell by cell.
const getGroupSortValue = (
  group: ProcessedResultGroup,
  columnId: string,
  filterConfigs: any[],
  primaryFieldId: string | null,
): string => {
  if (columnId === DOC_NAME_SORT_COLUMN_ID) {
    return group.docName || group.items[0]?.extracted?.foundInDocument || '';
  }

  if (columnId === FILE_PATH_SORT_COLUMN_ID) {
    return group.search?.doc?.originalFilePath || '';
  }

  const filterConfig = filterConfigs.find((conf) => conf?.id === columnId);
  if (filterConfig) {
    // The filter cell shows every distinct badge value in the group, so sort on
    // that same joined list. Only the one config is handed to
    // calculateDynamicValues — re-running every filter's regex here would cost
    // as much as the whole filtering pass, for values nothing reads.
    const uniqueValues = new Set<string>();
    group.items.forEach((item) => {
      const value = calculateDynamicValues(
        item,
        [filterConfig],
        primaryFieldId,
      )[columnId];
      if (value) uniqueValues.add(value);
    });

    return Array.from(uniqueValues).join(', ');
  }

  // Schema TABLE field — the collapsed row shows the first item's value.
  return group.items[0]?.extracted?.extractedFieldById[columnId] || '';
};

// Dates have to be ordered on a normalised key rather than on the text the cell
// shows. Locale collation with `numeric: true` is a *natural* sort — built so
// that "file2" precedes "file10" — and it reads strictly left to right, so on a
// dd.mm.yyyy column the leftmost number it compares is the day of the month.
// That's why "27.02.2026" lands above "23.04.2026".
const DAY_FIRST_DATE_PATTERN = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;
const ISO_DATE_PATTERN = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/;

const toTimestamp = (year: number, month: number, day: number) => {
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  // Rejects what's shaped like a date but isn't one on the calendar
  // ("31.02.2026"), which Date.UTC would otherwise roll forward into March.
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? timestamp
    : null;
};

// Deliberately parsed by pattern rather than handed to `new Date(string)`,
// which is implementation-defined for everything but ISO and would read
// "01.05.2026" as a US month-first date in some engines.
const parseDateValue = (value: string): number | null => {
  const dayFirst = DAY_FIRST_DATE_PATTERN.exec(value.trim());
  if (dayFirst) {
    return toTimestamp(+dayFirst[3], +dayFirst[2], +dayFirst[1]);
  }

  const iso = ISO_DATE_PATTERN.exec(value.trim());
  if (iso) {
    return toTimestamp(+iso[1], +iso[2], +iso[3]);
  }

  return null;
};

interface DecoratedRow {
  group: ProcessedResultGroup;
  text: string;
  timestamp: number | null;
}

// Enough of a column has to read as dates before the whole column is ordered
// chronologically: one stray "27.02.2026" shouldn't drag its row to the top of
// a free-text column, and one stray "—" shouldn't drop a real date column back
// to text ordering.
const DATE_COLUMN_THRESHOLD = 0.7;

const isDateColumn = (rows: DecoratedRow[]) => {
  const populated = rows.filter((row) => row.text);
  if (populated.length === 0) return false;

  const dated = populated.filter((row) => row.timestamp !== null).length;

  return dated / populated.length >= DATE_COLUMN_THRESHOLD;
};

const compareRows = (
  a: DecoratedRow,
  b: DecoratedRow,
  useTimestamps: boolean,
  direction: SortDirection,
) => {
  const aIsMissing = useTimestamps ? a.timestamp === null : !a.text;
  const bIsMissing = useTimestamps ? b.timestamp === null : !b.text;

  // An empty cell — or a non-date sitting in a date column — is a missing
  // value, not one that belongs at either end of the range, so those rows sink
  // to the bottom whichever way the arrow points.
  if (aIsMissing || bIsMissing) {
    if (aIsMissing && bIsMissing) return 0;
    return aIsMissing ? 1 : -1;
  }

  const comparison = useTimestamps
    ? (a.timestamp as number) - (b.timestamp as number)
    : a.text.localeCompare(b.text, undefined, {
        numeric: true,
        sensitivity: 'base',
      });

  return direction === 'asc' ? comparison : -comparison;
};

const sortGroupedResults = (
  filteredResults: Record<string, ProcessedResultGroup[]>,
  sort: ResultsSortState,
  filterConfigs: any[],
  primaryFieldId: string | null,
): Record<string, ProcessedResultGroup[]> =>
  Object.fromEntries(
    Object.entries(filteredResults).map(([searchQuery, groups]) => {
      // Decorate/sort/undecorate: a filter column's value comes out of the
      // regex extractor, and its date parse costs a regex of its own — far too
      // much to re-derive inside a comparator that revisits each row O(log n)
      // times.
      const decorated: DecoratedRow[] = groups.map((group) => {
        const text = getGroupSortValue(
          group,
          sort.columnId,
          filterConfigs,
          primaryFieldId,
        );

        return { group, text, timestamp: parseDateValue(text) };
      });

      // How the column is ordered is settled once, from the column as a whole,
      // rather than per comparison — otherwise two rows could disagree about
      // it and the result wouldn't be a consistent ordering at all.
      const useTimestamps = isDateColumn(decorated);

      // Array#sort is stable, so rows that tie keep the relevance order the
      // engine returned them in.
      decorated.sort((a, b) =>
        compareRows(a, b, useTimestamps, sort.direction),
      );

      return [searchQuery, decorated.map(({ group }) => group)];
    }),
  );

export {
  DEFAULT_RESULTS_SORT,
  DOC_NAME_SORT_COLUMN_ID,
  FILE_PATH_SORT_COLUMN_ID,
  readStoredResultsSort,
  sortGroupedResults,
  writeStoredResultsSort,
};
export type { ResultsSortState, SortDirection };
