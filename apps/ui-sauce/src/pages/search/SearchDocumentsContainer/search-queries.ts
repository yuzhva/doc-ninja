// The search input takes one of two shapes, and the toggle above it picks
// which:
//
//   - the textarea holds a *single* query that may span several lines, so a
//     quote copied out of a book stays one search;
//   - the per-line editor holds one query per row, which is what a column
//     pasted out of Excel needs.
//
// Cutting the text up and putting it back together happens here and nowhere
// else — the backend no longer splits anything, so what gets searched is
// exactly what the form shows.
const QUERY_SEPARATOR = '\n';

const joinSearchQueries = (queries: string[]): string =>
  queries.join(QUERY_SEPARATOR);

// Trims and drops the blanks a paste leaves behind, so the request carries only
// what's searchable. Newlines *inside* an entry are left alone: those belong to
// the phrase the user is looking for.
const normalizeSearchQueries = (queries: string[]): string[] =>
  queries.map((query) => query.trim()).filter((query) => query.length > 0);

const asSingleSearchQuery = (queries: string[]): string[] => [
  joinSearchQueries(queries),
];

// Always yields at least one (empty) entry, so the per-line editor still has a
// row to render and the user is never left with nothing to type into.
const asPerLineSearchQueries = (queries: string[]): string[] => {
  const normalized = normalizeSearchQueries(
    joinSearchQueries(queries).split(QUERY_SEPARATOR),
  );

  return normalized.length > 0 ? normalized : [''];
};

export {
  asPerLineSearchQueries,
  asSingleSearchQuery,
  joinSearchQueries,
  normalizeSearchQueries,
};
