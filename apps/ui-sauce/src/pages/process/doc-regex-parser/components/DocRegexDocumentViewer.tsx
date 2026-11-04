import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Modal, Select } from '../../../../components';
import { DocRegexParser } from '../doc-regex-parser.engine';
import type {
  DocRegexDocumentOutcome,
  DocRegexDocumentStatus,
} from '../doc-regex-parser.results';
import type {
  DocRegexConfig,
  DocRegexMatchSpan,
} from '../doc-regex-parser.types';

const I18N_NS = 'page.process.component.docRegexDocumentViewer';

// Spelled out in full (not built from parts) so Tailwind's scanner picks
// every class up.
const FIELD_HIGHLIGHT_CLASSES = [
  'bg-yellow-200 dark:bg-yellow-600/60',
  'bg-green-200 dark:bg-green-700/60',
  'bg-sky-200 dark:bg-sky-700/60',
  'bg-pink-200 dark:bg-pink-700/60',
  'bg-violet-200 dark:bg-violet-700/60',
  'bg-orange-200 dark:bg-orange-700/60',
  'bg-teal-200 dark:bg-teal-700/60',
  'bg-lime-200 dark:bg-lime-700/60',
];
const QUALIFIER_HIGHLIGHT_CLASS =
  'bg-gray-200 dark:bg-gray-600 underline decoration-dotted decoration-gray-500';

const STATUS_BADGE_CLASSES: Record<DocRegexDocumentStatus, string> = {
  MATCHED: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  SKIPPED: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  NO_TEXT: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

type StatusFilter = 'ALL' | DocRegexDocumentStatus;

interface TextSegment {
  text: string;
  span: DocRegexMatchSpan | null;
}

/**
 * Overlapping spans can't all be drawn, so fields win over qualifier rules
 * (a field match is what the user is debugging) and, within a kind, the
 * earlier rule wins.
 */
const buildTextSegments = (
  text: string,
  spans: DocRegexMatchSpan[],
): TextSegment[] => {
  const byPriority = [
    ...spans.filter((span) => !DocRegexParser.isQualifierRuleId(span.ruleId)),
    ...spans.filter((span) => DocRegexParser.isQualifierRuleId(span.ruleId)),
  ];
  const accepted: DocRegexMatchSpan[] = [];
  for (const span of byPriority) {
    const overlaps = accepted.some(
      (other) => span.start < other.end && other.start < span.end,
    );
    if (span.end > span.start && !overlaps) accepted.push(span);
  }
  accepted.sort((a, b) => a.start - b.start);

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const span of accepted) {
    if (span.start > cursor) {
      segments.push({ text: text.slice(cursor, span.start), span: null });
    }
    segments.push({ text: text.slice(span.start, span.end), span });
    cursor = span.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), span: null });
  }

  return segments;
};

const DocRegexDocumentViewer = ({
  isOpen,
  onClose,
  outcomes,
  config,
  documentIndex,
  onDocumentIndexChange,
  initialStatusFilter = 'ALL',
}: {
  isOpen: boolean;
  onClose: () => void;
  outcomes: DocRegexDocumentOutcome[];
  config: DocRegexConfig;
  documentIndex: number;
  onDocumentIndexChange: (documentIndex: number) => void;
  initialStatusFilter?: StatusFilter;
}) => {
  const { t } = useTranslation();
  const textRef = React.useRef<HTMLPreElement>(null);
  const [statusFilter, setStatusFilter] =
    React.useState<StatusFilter>(initialStatusFilter);

  React.useEffect(() => {
    if (isOpen) setStatusFilter(initialStatusFilter);
  }, [isOpen, initialStatusFilter]);

  // Only top-level fields have a position in the document — split columns
  // and compounds are cut from (or glued out of) other values.
  const fieldColorById = React.useMemo(
    () =>
      new Map(
        (config.fields ?? []).map((field, index) => [
          field.id,
          FIELD_HIGHLIGHT_CLASSES[index % FIELD_HIGHLIGHT_CLASSES.length],
        ]),
      ),
    [config],
  );

  const filteredIndexes = React.useMemo(
    () =>
      outcomes
        .map((outcome, index) => ({ outcome, index }))
        .filter(
          ({ outcome }) =>
            statusFilter === 'ALL' || outcome.status === statusFilter,
        )
        .map(({ index }) => index),
    [outcomes, statusFilter],
  );

  const outcome = outcomes[documentIndex] as
    DocRegexDocumentOutcome | undefined;
  const text = outcome?.document.text ?? '';
  const spans = outcome?.result?.spans ?? [];
  const segments = React.useMemo(
    () => buildTextSegments(text, spans),
    [text, spans],
  );
  const firstRow = outcome?.result?.rows[0];

  const scrollToRule = (ruleId: string) => {
    const element = textRef.current?.querySelector(
      `[data-rule-id="${CSS.escape(ruleId)}"]`,
    );
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const getQualifierRuleTitle = (ruleIndex: number) => {
    const rule = config.qualifier?.rules[ruleIndex];
    return rule?.type === 'KEYWORDS'
      ? rule.keywords.join(' → ')
      : rule?.pattern;
  };

  const getSpanLabel = (ruleId: string) => {
    if (DocRegexParser.isQualifierRuleId(ruleId)) {
      const ruleIndex = Number(ruleId.split(':')[1]);
      return t(`${I18N_NS}.qualifierRuleLabel`, { number: ruleIndex + 1 });
    }
    const field = config.fields.find((f) => f.id === ruleId);
    return field?.label || ruleId;
  };

  const statusOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: 'ALL', label: t(`${I18N_NS}.statusFilter.ALL`) },
    { value: 'MATCHED', label: t(`${I18N_NS}.status.MATCHED`) },
    { value: 'SKIPPED', label: t(`${I18N_NS}.status.SKIPPED`) },
    { value: 'NO_TEXT', label: t(`${I18N_NS}.status.NO_TEXT`) },
    { value: 'FAILED', label: t(`${I18N_NS}.status.FAILED`) },
  ];

  return (
    <Modal
      title={<Trans i18nKey={`${I18N_NS}.title`} />}
      isOpen={isOpen}
      onBtnCloseClick={onClose}
      maxWidthClassName="max-w-7xl"
      bodyClassName="p-0"
    >
      <div className="flex flex-col md:flex-row h-[75vh]">
        {/* Documents list */}
        <div className="md:w-80 shrink-0 flex flex-col border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700 min-h-0">
          <div className="p-3 border-b border-gray-200 dark:border-gray-700">
            <Select
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as StatusFilter)}
              options={statusOptions}
            />
          </div>
          <ul className="overflow-y-auto min-h-0 flex-1 max-h-40 md:max-h-none">
            {filteredIndexes.length === 0 && (
              <li className="p-3 text-sm text-gray-500 dark:text-gray-400">
                <Trans i18nKey={`${I18N_NS}.noDocumentsMessage`} />
              </li>
            )}
            {filteredIndexes.map((index) => {
              const item = outcomes[index];
              const isActive = index === documentIndex;

              return (
                <li key={item.document.path}>
                  <button
                    type="button"
                    onClick={() => onDocumentIndexChange(index)}
                    className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 dark:border-gray-700 cursor-pointer ${
                      isActive
                        ? 'bg-blue-50 dark:bg-blue-900/40'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <span className="block truncate font-medium text-gray-900 dark:text-white">
                      {item.document.name}
                    </span>
                    <span className="flex items-center gap-2 mt-0.5">
                      <span
                        className={`text-xs font-medium px-1.5 py-0.5 rounded ${STATUS_BADGE_CLASSES[item.status]}`}
                      >
                        {t(`${I18N_NS}.status.${item.status}`)}
                      </span>
                      {item.status === 'MATCHED' && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {t(`${I18N_NS}.rowsCount`, {
                            count: item.result?.rows.length ?? 0,
                          })}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Selected document */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {!outcome ? (
            <p className="p-4 text-sm text-gray-500 dark:text-gray-400">
              <Trans i18nKey={`${I18N_NS}.noDocumentsMessage`} />
            </p>
          ) : (
            <>
              <div className="p-4 space-y-3 border-b border-gray-200 dark:border-gray-700">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_BADGE_CLASSES[outcome.status]}`}
                  >
                    {t(`${I18N_NS}.status.${outcome.status}`)}
                  </span>
                  <span className="text-sm text-gray-700 dark:text-gray-300 break-all">
                    {outcome.document.path}
                  </span>
                </div>

                {outcome.document.error && (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {outcome.document.error}
                  </p>
                )}
                {outcome.status === 'NO_TEXT' && (
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    <Trans i18nKey={`${I18N_NS}.noTextHint`} />
                  </p>
                )}

                {outcome.result &&
                  outcome.result.qualifierChecks.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-gray-500 dark:text-gray-400">
                        <Trans i18nKey={`${I18N_NS}.qualifierLabel`} />
                      </span>
                      {outcome.result.qualifierChecks.map((isPassed, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => scrollToRule(`qualifier:${index}`)}
                          title={getQualifierRuleTitle(index)}
                          className={`px-2 py-0.5 rounded font-medium cursor-pointer ${
                            isPassed
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                          }`}
                        >
                          {isPassed ? '✓' : '✗'}{' '}
                          {t(`${I18N_NS}.qualifierRuleLabel`, {
                            number: index + 1,
                          })}
                        </button>
                      ))}
                    </div>
                  )}

                {outcome.status === 'MATCHED' && (
                  <div className="flex flex-wrap gap-2">
                    {config.fields.map((field) => {
                      const value = firstRow?.[field.id];
                      const hasSpan = spans.some(
                        (span) => span.ruleId === field.id,
                      );

                      return (
                        <button
                          key={field.id}
                          type="button"
                          onClick={() => scrollToRule(field.id)}
                          disabled={!hasSpan}
                          title={value ?? undefined}
                          className={`max-w-xs text-left text-xs px-2 py-1 rounded border border-transparent enabled:cursor-pointer disabled:cursor-default ${
                            value
                              ? (fieldColorById.get(field.id) ?? '')
                              : 'bg-amber-50 border-amber-300 dark:bg-amber-900/30 dark:border-amber-700'
                          }`}
                        >
                          <span className="font-semibold text-gray-900 dark:text-white">
                            {field.label || field.id}:
                          </span>{' '}
                          <span className="text-gray-800 dark:text-gray-100 line-clamp-1 break-all">
                            {value ?? t(`${I18N_NS}.notFoundValue`)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <pre
                ref={textRef}
                className="flex-1 min-h-0 overflow-auto p-4 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200"
              >
                {text
                  ? segments.map((segment, index) =>
                      segment.span ? (
                        <mark
                          key={index}
                          data-rule-id={segment.span.ruleId}
                          title={getSpanLabel(segment.span.ruleId)}
                          className={`rounded-sm text-inherit ${
                            DocRegexParser.isQualifierRuleId(
                              segment.span.ruleId,
                            )
                              ? QUALIFIER_HIGHLIGHT_CLASS
                              : (fieldColorById.get(segment.span.ruleId) ?? '')
                          }`}
                        >
                          {segment.text}
                        </mark>
                      ) : (
                        <React.Fragment key={index}>
                          {segment.text}
                        </React.Fragment>
                      ),
                    )
                  : t(`${I18N_NS}.emptyTextPlaceholder`)}
              </pre>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};

export { DocRegexDocumentViewer };
export type { StatusFilter as DocRegexDocumentStatusFilter };
