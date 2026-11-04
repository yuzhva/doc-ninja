import type { TFunction } from 'i18next';

import type { DocRegexConfigIssue } from './doc-regex-parser.types';

const I18N_NS = 'page.process.docRegexIssues';

// The engine reports codes, not sentences (it stays i18n-free), so the
// wording lives in the translation files next to the rest of the UI.
const formatDocRegexIssue = (t: TFunction, issue: DocRegexConfigIssue) =>
  t(`${I18N_NS}.${issue.code}`, {
    ...issue.params,
    // Regex sources and ids are shown verbatim — never HTML-escaped, and
    // never re-read as i18next placeholders.
    interpolation: { escapeValue: false, skipOnVariables: true },
  });

/**
 * Issues whose path is `path` itself or anything below it — e.g. every issue
 * of one field card ("fields[2]", "fields[2].pattern", ...).
 */
const filterDocRegexIssues = (
  issues: DocRegexConfigIssue[],
  path: string,
  { isExact = false }: { isExact?: boolean } = {},
) =>
  issues.filter((issue) =>
    isExact
      ? issue.path === path
      : issue.path === path ||
        issue.path.startsWith(`${path}.`) ||
        issue.path.startsWith(`${path}[`),
  );

export { filterDocRegexIssues, formatDocRegexIssue };
