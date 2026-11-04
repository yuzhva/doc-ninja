import type { TFunction } from 'i18next';
import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Checkbox, Select, SortableList } from '../../../../components';
import { DocRegexParser } from '../doc-regex-parser.engine';
import { getFormKey, withFormKey } from '../doc-regex-parser.form-keys';
import {
  filterDocRegexIssues,
  formatDocRegexIssue,
} from '../doc-regex-parser.issues';
import type {
  DocRegexCompound,
  DocRegexConfig,
  DocRegexConfigIssue,
  DocRegexField,
  DocRegexQualifierRule,
  DocRegexTransform,
  DocRegexValueRule,
} from '../doc-regex-parser.types';

const I18N_NS = 'page.process.component.docRegexConfigForm';

type FormPath = Array<string | number>;
type UpdateAt = (path: FormPath, value: unknown) => void;

/**
 * Immutable set by path. Spreading (rather than structuredClone) matters:
 * it carries each object's form key along — see doc-regex-parser.form-keys.
 */
const setIn = (target: any, path: FormPath, value: unknown): any => {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const copy = Array.isArray(target) ? [...target] : { ...(target ?? {}) };
  copy[head as any] = setIn(target?.[head as any], rest, value);
  return copy;
};

// An emptied optional input drops its key from the JSON rather than
// leaving "flags": "" behind.
const optional = (value: string) => (value === '' ? undefined : value);

const asArray = <T,>(value: T[] | undefined | unknown): T[] =>
  Array.isArray(value) ? value : [];

const inputClassName =
  'block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2 text-sm';
const monoInputClassName = `${inputClassName} font-mono`;

const addButtonClassName =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-600 rounded-lg hover:bg-blue-600 hover:text-white focus:ring-4 focus:outline-none focus:ring-blue-200 dark:bg-gray-800 dark:text-blue-400 dark:border-blue-500 dark:hover:bg-blue-600 dark:hover:text-white dark:focus:ring-blue-900 cursor-pointer transition-colors';

// --- Module-level building blocks ---------------------------------------
// They must not be defined inside the form's render: a component created
// during render gets a new identity every time, so React would remount it
// (and drop the input focus) on every keystroke.

const IssueList = ({ messages }: { messages: string[] }) =>
  messages.length === 0 ? null : (
    <ul className="mt-1 space-y-0.5">
      {messages.map((message, index) => (
        <li key={index} className="text-xs text-red-600 dark:text-red-400">
          {message}
        </li>
      ))}
    </ul>
  );

const FormField = ({
  label,
  hint,
  issues = [],
  required = false,
  className = '',
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  issues?: string[];
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) => (
  <div className={`min-w-0 ${className}`}>
    <label className="block mb-1.5 text-sm font-medium text-gray-900 dark:text-white">
      {label}
      {required && <span className="text-red-500"> *</span>}
    </label>
    {children}
    {hint && (
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
    )}
    <IssueList messages={issues} />
  </div>
);

const RemoveButton = ({
  onClick,
  title,
  className = '',
}: {
  onClick: () => void;
  title: string;
  className?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={`flex items-center justify-center w-8 h-8 shrink-0 text-red-600 bg-white border border-red-600 hover:bg-red-600 hover:text-white focus:ring-4 focus:ring-red-200 font-medium rounded-lg text-sm dark:bg-gray-800 dark:text-red-500 dark:border-red-500 dark:hover:text-white dark:hover:bg-red-600 dark:focus:ring-red-900 cursor-pointer ${className}`}
  >
    −
  </button>
);

const SectionTitle = ({
  title,
  hint,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
}) => (
  <div>
    <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
      {title}
    </h4>
    {hint && (
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
    )}
  </div>
);

/**
 * Text that only means something once typed out completely: an id (renaming
 * rewrites every reference to it) or a separated list (splitting on every
 * keystroke would swallow the separator being typed). Edits stay local
 * until blur/Enter.
 */
const DraftInput = ({
  value,
  onCommit,
  isMultiline = false,
  className,
  placeholder,
  rows = 3,
}: {
  value: string;
  onCommit: (value: string) => void;
  isMultiline?: boolean;
  className: string;
  placeholder?: string;
  rows?: number;
}) => {
  const [draft, setDraft] = React.useState(value);
  const isEditingRef = React.useRef(false);

  React.useEffect(() => {
    if (!isEditingRef.current) setDraft(value);
  }, [value]);

  const commit = () => {
    isEditingRef.current = false;
    if (draft !== value) onCommit(draft);
  };

  const sharedProps = {
    value: draft,
    placeholder,
    className,
    onFocus: () => {
      isEditingRef.current = true;
    },
    onBlur: commit,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setDraft(event.target.value),
  };

  return isMultiline ? (
    <textarea {...sharedProps} rows={rows} />
  ) : (
    <input
      {...sharedProps}
      type="text"
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          isEditingRef.current = true;
        }
      }}
    />
  );
};

// --- Transforms ------------------------------------------------------------

const TransformsEditor = ({
  transforms,
  path,
  update,
  issuesAt,
  t,
}: {
  transforms: DocRegexTransform[];
  path: FormPath;
  update: UpdateAt;
  issuesAt: (path: FormPath) => string[];
  t: TFunction;
}) => {
  const setTransforms = (next: DocRegexTransform[]) =>
    update(path, next.length > 0 ? next : undefined);

  return (
    <div className="space-y-2">
      <SectionTitle
        title={<Trans i18nKey={`${I18N_NS}.transformsTitle`} />}
        hint={<Trans i18nKey={`${I18N_NS}.transformsHint`} />}
      />
      {transforms.map((transform, index) => (
        <div
          key={getFormKey(transform) ?? index}
          className="flex items-start gap-2 rounded-lg bg-gray-50 dark:bg-gray-700/40 p-2"
        >
          <div className="w-40 shrink-0">
            <Select
              value={transform.type}
              onChange={(type) =>
                update(
                  [...path, index],
                  withFormKey(
                    type === 'DATE'
                      ? { type: 'DATE' }
                      : { type: 'REPLACE', find: '', replace: '' },
                  ),
                )
              }
              options={[
                {
                  value: 'REPLACE',
                  label: t(`${I18N_NS}.transformType.REPLACE`),
                },
                { value: 'DATE', label: t(`${I18N_NS}.transformType.DATE`) },
              ]}
            />
          </div>
          {transform.type === 'REPLACE' ? (
            <div className="grid flex-1 grid-cols-1 sm:grid-cols-[1fr_1fr_5rem] gap-2">
              <div>
                <input
                  type="text"
                  value={transform.find ?? ''}
                  onChange={(e) =>
                    update([...path, index, 'find'], e.target.value)
                  }
                  placeholder={t(`${I18N_NS}.transformFindPlaceholder`)}
                  className={monoInputClassName}
                />
                <IssueList messages={issuesAt([...path, index, 'find'])} />
              </div>
              <input
                type="text"
                value={transform.replace ?? ''}
                onChange={(e) =>
                  update([...path, index, 'replace'], e.target.value)
                }
                placeholder={t(`${I18N_NS}.transformReplacePlaceholder`)}
                className={monoInputClassName}
              />
              <input
                type="text"
                value={transform.flags ?? ''}
                onChange={(e) =>
                  update([...path, index, 'flags'], optional(e.target.value))
                }
                placeholder="gi"
                title={t(`${I18N_NS}.flagsTitle`)}
                className={monoInputClassName}
              />
            </div>
          ) : (
            <p className="flex-1 self-center text-xs text-gray-500 dark:text-gray-400">
              <Trans i18nKey={`${I18N_NS}.transformDateHint`} />
            </p>
          )}
          <RemoveButton
            onClick={() =>
              setTransforms(transforms.filter((_, i) => i !== index))
            }
            title={t(`${I18N_NS}.removeTransformTitle`)}
          />
          <IssueList messages={issuesAt([...path, index, 'type'])} />
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setTransforms([
            ...transforms,
            withFormKey({ type: 'REPLACE', find: '', replace: '' }),
          ])
        }
        className={addButtonClassName}
      >
        + <Trans i18nKey={`${I18N_NS}.addTransformButton`} />
      </button>
    </div>
  );
};

// --- Value rule (field / split column) -------------------------------------

const ValueRuleInputs = ({
  rule,
  path,
  update,
  onRenameId,
  issuesAt,
  isPatternRequired,
  t,
}: {
  rule: DocRegexValueRule;
  path: FormPath;
  update: UpdateAt;
  onRenameId: (oldId: string, newId: string) => void;
  issuesAt: (path: FormPath) => string[];
  isPatternRequired: boolean;
  t: TFunction;
}) => (
  <>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <FormField
        label={<Trans i18nKey={`${I18N_NS}.idLabel`} />}
        hint={
          rule.id ? (
            <>
              <Trans i18nKey={`${I18N_NS}.idHint`} />{' '}
              <code className="text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded px-1 py-0.5">
                {`{{${rule.id}}}`}
              </code>
            </>
          ) : undefined
        }
        issues={issuesAt([...path, 'id'])}
        required
      >
        <DraftInput
          value={rule.id ?? ''}
          onCommit={(id) => onRenameId(rule.id ?? '', id.trim())}
          placeholder={t(`${I18N_NS}.idPlaceholder`)}
          className={monoInputClassName}
        />
      </FormField>
      <FormField label={<Trans i18nKey={`${I18N_NS}.labelLabel`} />}>
        <input
          type="text"
          value={rule.label ?? ''}
          onChange={(e) => update([...path, 'label'], optional(e.target.value))}
          placeholder={t(`${I18N_NS}.labelPlaceholder`)}
          className={inputClassName}
        />
      </FormField>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_6rem] gap-3">
      <FormField
        label={<Trans i18nKey={`${I18N_NS}.patternLabel`} />}
        hint={
          <Trans
            i18nKey={
              isPatternRequired
                ? `${I18N_NS}.patternHint`
                : `${I18N_NS}.patternOptionalHint`
            }
          />
        }
        issues={issuesAt([...path, 'pattern'])}
        required={isPatternRequired}
      >
        <input
          type="text"
          value={rule.pattern ?? ''}
          onChange={(e) =>
            update([...path, 'pattern'], optional(e.target.value))
          }
          placeholder={t(`${I18N_NS}.patternPlaceholder`)}
          className={monoInputClassName}
        />
      </FormField>
      <FormField
        label={<Trans i18nKey={`${I18N_NS}.flagsLabel`} />}
        issues={issuesAt([...path, 'flags'])}
      >
        <input
          type="text"
          value={rule.flags ?? ''}
          onChange={(e) => update([...path, 'flags'], optional(e.target.value))}
          placeholder="im"
          title={t(`${I18N_NS}.flagsTitle`)}
          className={monoInputClassName}
        />
      </FormField>
    </div>
    <FormField
      label={<Trans i18nKey={`${I18N_NS}.templateLabel`} />}
      hint={<Trans i18nKey={`${I18N_NS}.templateHint`} />}
    >
      <input
        type="text"
        value={rule.template ?? ''}
        onChange={(e) =>
          update([...path, 'template'], optional(e.target.value))
        }
        placeholder="$1.$2.$3"
        className={monoInputClassName}
      />
    </FormField>
    <TransformsEditor
      transforms={asArray<DocRegexTransform>(rule.transforms)}
      path={[...path, 'transforms']}
      update={update}
      issuesAt={issuesAt}
      t={t}
    />
  </>
);

// --- Config card -------------------------------------------------------------

const newValueRule = (): DocRegexValueRule =>
  withFormKey({ id: '', label: '', pattern: '' });

const ConfigCard = ({
  config,
  configIndex,
  issues,
  update,
  onRemove,
  isCollapsed,
  onToggleCollapsed,
  dragHandle,
}: {
  config: DocRegexConfig;
  configIndex: number;
  issues: DocRegexConfigIssue[];
  update: UpdateAt;
  onRemove: () => void;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  dragHandle: React.ReactNode;
}) => {
  const { t } = useTranslation();
  const configPath: FormPath = [configIndex];
  const configIssues = filterDocRegexIssues(issues, `[${configIndex}]`);

  // Paths in issues read like "[0].fields[2].pattern"; FormPath is
  // [0, 'fields', 2, 'pattern'].
  const issuesAt = (path: FormPath) => {
    const issuePath = path
      .map((part, index) =>
        typeof part === 'number'
          ? `[${part}]`
          : index === 0
            ? part
            : `.${part}`,
      )
      .join('');
    return filterDocRegexIssues(configIssues, issuePath, {
      isExact: true,
    }).map((issue) => formatDocRegexIssue(t, issue));
  };

  const fields = asArray<DocRegexField>(config.fields);
  const compounds = asArray<DocRegexCompound>(config.compounds);
  const columns = asArray<string>(config.columns);
  const qualifierRules = asArray<DocRegexQualifierRule>(
    config.qualifier?.rules,
  );
  const allValues = DocRegexParser.listValues({
    ...config,
    fields,
    compounds,
  }).filter((value) => value.id);
  const unusedValues = allValues.filter((value) => !columns.includes(value.id));

  /**
   * Renaming an id keeps every reference to it working — the columns list,
   * other fields' `source` and {{id}} placeholders in compounds — instead of
   * leaving them all pointing at a name that no longer exists.
   */
  const renameValueId = (rulePath: FormPath, oldId: string, newId: string) => {
    let next: DocRegexConfig = setIn(config, rulePath, newId);
    if (oldId && newId && oldId !== newId) {
      next = {
        ...next,
        fields: asArray<DocRegexField>(next.fields).map((field) =>
          field.source === oldId ? { ...field, source: newId } : field,
        ),
        compounds: asArray<DocRegexCompound>(next.compounds).map(
          (compound) => ({
            ...compound,
            value: (compound.value ?? '')
              .split(`{{${oldId}}}`)
              .join(`{{${newId}}}`),
          }),
        ),
        columns: asArray<string>(next.columns).map((column) =>
          column === oldId ? newId : column,
        ),
      };
    }
    update(configPath, next);
  };

  const fieldIssueCount = (fieldIndex: number) =>
    filterDocRegexIssues(configIssues, `[${configIndex}].fields[${fieldIndex}]`)
      .length;

  return (
    <>
      <div className="flex items-center justify-between gap-3 bg-gray-50 px-4 py-3 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
        {dragHandle}
        <RemoveButton
          onClick={onRemove}
          title={t(`${I18N_NS}.removeConfigTitle`)}
          className="w-9 h-9"
        />
        <input
          type="text"
          value={config.name ?? ''}
          onChange={(e) => update([...configPath, 'name'], e.target.value)}
          placeholder={t(`${I18N_NS}.configNamePlaceholder`)}
          className="flex-1 block w-full border bg-white border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-600 dark:text-white dark:placeholder-gray-400 rounded-lg p-2 text-sm font-semibold"
        />
        {configIssues.length > 0 && (
          <span className="shrink-0 bg-red-100 text-red-800 text-xs font-medium px-2 py-1 rounded dark:bg-red-900 dark:text-red-200">
            {t(`${I18N_NS}.issuesCount`, { count: configIssues.length })}
          </span>
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="p-2 rounded-lg text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-600 focus:outline-none cursor-pointer shrink-0"
          title={t(
            isCollapsed ? `${I18N_NS}.expandTitle` : `${I18N_NS}.collapseTitle`,
          )}
        >
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${
              isCollapsed ? '' : 'rotate-180'
            }`}
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
      {issuesAt([...configPath, 'name']).length > 0 && (
        <div className="px-4 pt-2">
          <IssueList messages={issuesAt([...configPath, 'name'])} />
        </div>
      )}

      {!isCollapsed && (
        <div className="p-4 space-y-8">
          {/* General */}
          <FormField
            label={<Trans i18nKey={`${I18N_NS}.fileExtensionsLabel`} />}
            hint={<Trans i18nKey={`${I18N_NS}.fileExtensionsHint`} />}
          >
            <DraftInput
              value={asArray<string>(config.fileExtensions).join(', ')}
              onCommit={(text) => {
                const extensions = text
                  .split(/[,\s]+/)
                  .map((extension) => extension.trim())
                  .filter(Boolean);
                update(
                  [...configPath, 'fileExtensions'],
                  extensions.length > 0 ? extensions : undefined,
                );
              }}
              placeholder=".doc, .docx, .pdf"
              className={monoInputClassName}
            />
          </FormField>

          {/* Qualifier */}
          <div className="space-y-3">
            <SectionTitle
              title={<Trans i18nKey={`${I18N_NS}.qualifierTitle`} />}
              hint={<Trans i18nKey={`${I18N_NS}.qualifierHint`} />}
            />
            <div className="max-w-sm">
              <Select
                label={<Trans i18nKey={`${I18N_NS}.qualifierModeLabel`} />}
                value={config.qualifier?.mode ?? 'ALL'}
                onChange={(mode) =>
                  update([...configPath, 'qualifier', 'mode'], mode)
                }
                options={[
                  { value: 'ALL', label: t(`${I18N_NS}.qualifierMode.ALL`) },
                  { value: 'ANY', label: t(`${I18N_NS}.qualifierMode.ANY`) },
                ]}
              />
            </div>
            {qualifierRules.map((rule, ruleIndex) => {
              const rulePath: FormPath = [
                ...configPath,
                'qualifier',
                'rules',
                ruleIndex,
              ];
              return (
                <div
                  key={getFormKey(rule) ?? ruleIndex}
                  className="flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-600 p-3"
                >
                  <span className="mt-2 shrink-0 text-xs font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
                    #{ruleIndex + 1}
                  </span>
                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="max-w-xs">
                      <Select
                        value={rule.type}
                        onChange={(type) =>
                          update(
                            rulePath,
                            withFormKey(
                              type === 'KEYWORDS'
                                ? { type: 'KEYWORDS', keywords: [] }
                                : { type: 'PATTERN', pattern: '' },
                            ),
                          )
                        }
                        options={[
                          {
                            value: 'PATTERN',
                            label: t(`${I18N_NS}.qualifierRuleType.PATTERN`),
                          },
                          {
                            value: 'KEYWORDS',
                            label: t(`${I18N_NS}.qualifierRuleType.KEYWORDS`),
                          },
                        ]}
                      />
                      <IssueList messages={issuesAt([...rulePath, 'type'])} />
                    </div>
                    {rule.type === 'KEYWORDS' ? (
                      <>
                        <FormField
                          label={<Trans i18nKey={`${I18N_NS}.keywordsLabel`} />}
                          hint={<Trans i18nKey={`${I18N_NS}.keywordsHint`} />}
                          issues={issuesAt([...rulePath, 'keywords'])}
                          required
                        >
                          <DraftInput
                            isMultiline
                            value={asArray<string>(rule.keywords).join('\n')}
                            onCommit={(text) =>
                              update(
                                [...rulePath, 'keywords'],
                                text
                                  .split('\n')
                                  .map((line) => line.trim())
                                  .filter(Boolean),
                              )
                            }
                            placeholder={t(`${I18N_NS}.keywordsPlaceholder`)}
                            className={`${inputClassName} resize-y`}
                          />
                        </FormField>
                        <Checkbox
                          theme="toggle"
                          checked={rule.isOrdered !== false}
                          onChange={(checked) =>
                            update(
                              [...rulePath, 'isOrdered'],
                              checked ? undefined : false,
                            )
                          }
                          label={
                            <Trans i18nKey={`${I18N_NS}.isOrderedLabel`} />
                          }
                        />
                      </>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_6rem] gap-3">
                        <FormField
                          label={<Trans i18nKey={`${I18N_NS}.patternLabel`} />}
                          issues={issuesAt([...rulePath, 'pattern'])}
                          required
                        >
                          <input
                            type="text"
                            value={rule.pattern ?? ''}
                            onChange={(e) =>
                              update([...rulePath, 'pattern'], e.target.value)
                            }
                            placeholder={t(
                              `${I18N_NS}.qualifierPatternPlaceholder`,
                            )}
                            className={monoInputClassName}
                          />
                        </FormField>
                        <FormField
                          label={<Trans i18nKey={`${I18N_NS}.flagsLabel`} />}
                          issues={issuesAt([...rulePath, 'flags'])}
                        >
                          <input
                            type="text"
                            value={rule.flags ?? ''}
                            onChange={(e) =>
                              update(
                                [...rulePath, 'flags'],
                                optional(e.target.value),
                              )
                            }
                            placeholder="im"
                            title={t(`${I18N_NS}.flagsTitle`)}
                            className={monoInputClassName}
                          />
                        </FormField>
                      </div>
                    )}
                  </div>
                  <RemoveButton
                    onClick={() =>
                      update(
                        [...configPath, 'qualifier', 'rules'],
                        qualifierRules.filter((_, i) => i !== ruleIndex),
                      )
                    }
                    title={t(`${I18N_NS}.removeRuleTitle`)}
                  />
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  update(
                    [...configPath, 'qualifier', 'rules'],
                    [
                      ...qualifierRules,
                      withFormKey({ type: 'PATTERN', pattern: '' }),
                    ],
                  )
                }
                className={addButtonClassName}
              >
                + <Trans i18nKey={`${I18N_NS}.addPatternRuleButton`} />
              </button>
              <button
                type="button"
                onClick={() =>
                  update(
                    [...configPath, 'qualifier', 'rules'],
                    [
                      ...qualifierRules,
                      withFormKey({ type: 'KEYWORDS', keywords: [] }),
                    ],
                  )
                }
                className={addButtonClassName}
              >
                + <Trans i18nKey={`${I18N_NS}.addKeywordsRuleButton`} />
              </button>
            </div>
          </div>

          {/* Fields */}
          <div className="space-y-3">
            <SectionTitle
              title={<Trans i18nKey={`${I18N_NS}.fieldsTitle`} />}
              hint={<Trans i18nKey={`${I18N_NS}.fieldsHint`} />}
            />
            <SortableList
              items={fields}
              getItemKey={(field, index) => getFormKey(field) ?? index}
              onReorder={(next) => update([...configPath, 'fields'], next)}
              className="space-y-3"
              itemClassName="rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden"
              renderItem={(field, { dragHandle }) => {
                const fieldIndex = fields.indexOf(field);
                const fieldPath: FormPath = [
                  ...configPath,
                  'fields',
                  fieldIndex,
                ];
                const earlierFieldIds = fields
                  .slice(0, fieldIndex)
                  .map((f) => f.id)
                  .filter(Boolean);
                const splitColumns = asArray<DocRegexValueRule>(
                  field.split?.columns,
                );
                const splitBy =
                  field.split?.match !== undefined &&
                  field.split?.delimiter === undefined
                    ? 'match'
                    : 'delimiter';
                const issueCount = fieldIssueCount(fieldIndex);

                return (
                  <>
                    <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
                      {dragHandle}
                      <span className="flex-1 min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-white">
                        {field.label || field.id || (
                          <span className="font-normal italic text-gray-500">
                            <Trans i18nKey={`${I18N_NS}.newFieldTitle`} />
                          </span>
                        )}
                        {field.label && field.id && (
                          <code className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                            {field.id}
                          </code>
                        )}
                      </span>
                      {issueCount > 0 && (
                        <span className="shrink-0 bg-red-100 text-red-800 text-xs font-medium px-2 py-0.5 rounded dark:bg-red-900 dark:text-red-200">
                          {t(`${I18N_NS}.issuesCount`, { count: issueCount })}
                        </span>
                      )}
                      <RemoveButton
                        onClick={() =>
                          update(
                            [...configPath, 'fields'],
                            fields.filter((_, i) => i !== fieldIndex),
                          )
                        }
                        title={t(`${I18N_NS}.removeFieldTitle`)}
                      />
                    </div>
                    <div className="p-4 space-y-4">
                      <FormField
                        label={<Trans i18nKey={`${I18N_NS}.sourceLabel`} />}
                        hint={<Trans i18nKey={`${I18N_NS}.sourceHint`} />}
                        issues={issuesAt([...fieldPath, 'source'])}
                        className="max-w-sm"
                      >
                        <Select
                          value={field.source ?? ''}
                          onChange={(source) =>
                            update([...fieldPath, 'source'], optional(source))
                          }
                          options={[
                            {
                              value: '',
                              label: t(`${I18N_NS}.sourceDocumentOption`),
                            },
                            ...earlierFieldIds.map((id) => ({
                              value: id,
                              label: id,
                            })),
                            // Keep an unknown source selectable, so the select
                            // shows what the JSON actually says (and the
                            // issue below explains it).
                            ...(field.source &&
                            !earlierFieldIds.includes(field.source)
                              ? [{ value: field.source, label: field.source }]
                              : []),
                          ]}
                        />
                      </FormField>
                      <ValueRuleInputs
                        rule={field}
                        path={fieldPath}
                        update={update}
                        onRenameId={(oldId, newId) =>
                          renameValueId(
                            [...fieldPath.slice(1), 'id'],
                            oldId,
                            newId,
                          )
                        }
                        issuesAt={issuesAt}
                        isPatternRequired={!field.source}
                        t={t}
                      />

                      <div className="pt-3 border-t border-gray-100 dark:border-gray-700 space-y-3">
                        <Checkbox
                          theme="toggle"
                          checked={field.split !== undefined}
                          onChange={(checked) =>
                            update(
                              [...fieldPath, 'split'],
                              checked
                                ? {
                                    delimiter: ',\\s*',
                                    columns: [newValueRule()],
                                  }
                                : undefined,
                            )
                          }
                          label={<Trans i18nKey={`${I18N_NS}.splitLabel`} />}
                        />
                        <IssueList
                          messages={issuesAt([...fieldPath, 'split'])}
                        />
                        {field.split && (
                          <div className="space-y-4 rounded-lg bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/50 p-3">
                            <p className="text-xs text-gray-600 dark:text-gray-400">
                              <Trans i18nKey={`${I18N_NS}.splitHint`} />
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-[14rem_1fr_6rem] gap-3">
                              <Select
                                label={
                                  <Trans i18nKey={`${I18N_NS}.splitByLabel`} />
                                }
                                value={splitBy}
                                onChange={(nextSplitBy) => {
                                  const pattern =
                                    field.split?.delimiter ??
                                    field.split?.match ??
                                    '';
                                  update([...fieldPath, 'split'], {
                                    ...field.split,
                                    delimiter:
                                      nextSplitBy === 'delimiter'
                                        ? pattern
                                        : undefined,
                                    match:
                                      nextSplitBy === 'match'
                                        ? pattern
                                        : undefined,
                                  });
                                }}
                                options={[
                                  {
                                    value: 'delimiter',
                                    label: t(`${I18N_NS}.splitBy.delimiter`),
                                  },
                                  {
                                    value: 'match',
                                    label: t(`${I18N_NS}.splitBy.match`),
                                  },
                                ]}
                              />
                              <FormField
                                label={
                                  <Trans
                                    i18nKey={`${I18N_NS}.splitPatternLabel`}
                                  />
                                }
                                issues={[
                                  ...issuesAt([
                                    ...fieldPath,
                                    'split',
                                    'delimiter',
                                  ]),
                                  ...issuesAt([...fieldPath, 'split', 'match']),
                                ]}
                                required
                              >
                                <input
                                  type="text"
                                  value={
                                    (splitBy === 'match'
                                      ? field.split.match
                                      : field.split.delimiter) ?? ''
                                  }
                                  onChange={(e) =>
                                    update(
                                      [...fieldPath, 'split', splitBy],
                                      e.target.value,
                                    )
                                  }
                                  placeholder={
                                    splitBy === 'match'
                                      ? 'з\\s+\\S+\\s+по\\s+\\S+'
                                      : ',\\s*'
                                  }
                                  className={monoInputClassName}
                                />
                              </FormField>
                              <FormField
                                label={
                                  <Trans i18nKey={`${I18N_NS}.flagsLabel`} />
                                }
                                issues={issuesAt([
                                  ...fieldPath,
                                  'split',
                                  'flags',
                                ])}
                              >
                                <input
                                  type="text"
                                  value={field.split.flags ?? ''}
                                  onChange={(e) =>
                                    update(
                                      [...fieldPath, 'split', 'flags'],
                                      optional(e.target.value),
                                    )
                                  }
                                  placeholder="im"
                                  title={t(`${I18N_NS}.flagsTitle`)}
                                  className={monoInputClassName}
                                />
                              </FormField>
                            </div>

                            <SectionTitle
                              title={
                                <Trans
                                  i18nKey={`${I18N_NS}.splitColumnsTitle`}
                                />
                              }
                              hint={
                                <Trans
                                  i18nKey={`${I18N_NS}.splitColumnsHint`}
                                />
                              }
                            />
                            <IssueList
                              messages={issuesAt([
                                ...fieldPath,
                                'split',
                                'columns',
                              ])}
                            />
                            {splitColumns.map((column, columnIndex) => {
                              const columnPath: FormPath = [
                                ...fieldPath,
                                'split',
                                'columns',
                                columnIndex,
                              ];
                              return (
                                <div
                                  key={getFormKey(column) ?? columnIndex}
                                  className="relative rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 p-3 pr-12 space-y-3"
                                >
                                  <RemoveButton
                                    onClick={() =>
                                      update(
                                        [...fieldPath, 'split', 'columns'],
                                        splitColumns.filter(
                                          (_, i) => i !== columnIndex,
                                        ),
                                      )
                                    }
                                    title={t(
                                      `${I18N_NS}.removeSplitColumnTitle`,
                                    )}
                                    className="absolute top-3 right-3"
                                  />
                                  <ValueRuleInputs
                                    rule={column}
                                    path={columnPath}
                                    update={update}
                                    onRenameId={(oldId, newId) =>
                                      renameValueId(
                                        [...columnPath.slice(1), 'id'],
                                        oldId,
                                        newId,
                                      )
                                    }
                                    issuesAt={issuesAt}
                                    isPatternRequired={false}
                                    t={t}
                                  />
                                </div>
                              );
                            })}
                            <button
                              type="button"
                              onClick={() =>
                                update(
                                  [...fieldPath, 'split', 'columns'],
                                  [...splitColumns, newValueRule()],
                                )
                              }
                              className={addButtonClassName}
                            >
                              +{' '}
                              <Trans
                                i18nKey={`${I18N_NS}.addSplitColumnButton`}
                              />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                );
              }}
            />
            <button
              type="button"
              onClick={() =>
                update([...configPath, 'fields'], [...fields, newValueRule()])
              }
              className={addButtonClassName}
            >
              + <Trans i18nKey={`${I18N_NS}.addFieldButton`} />
            </button>
          </div>

          {/* Compounds */}
          <div className="space-y-3">
            <SectionTitle
              title={<Trans i18nKey={`${I18N_NS}.compoundsTitle`} />}
              hint={<Trans i18nKey={`${I18N_NS}.compoundsHint`} />}
            />
            {compounds.map((compound, compoundIndex) => {
              const compoundPath: FormPath = [
                ...configPath,
                'compounds',
                compoundIndex,
              ];
              // Only what's resolved before this compound can be referenced.
              const referenceableValues = allValues.filter(
                (value) =>
                  value.kind !== 'COMPOUND' ||
                  compounds.findIndex((c) => c.id === value.id) < compoundIndex,
              );

              return (
                <div
                  key={getFormKey(compound) ?? compoundIndex}
                  className="relative rounded-lg border border-gray-200 dark:border-gray-600 p-3 pr-12 space-y-3"
                >
                  <RemoveButton
                    onClick={() =>
                      update(
                        [...configPath, 'compounds'],
                        compounds.filter((_, i) => i !== compoundIndex),
                      )
                    }
                    title={t(`${I18N_NS}.removeCompoundTitle`)}
                    className="absolute top-3 right-3"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField
                      label={<Trans i18nKey={`${I18N_NS}.idLabel`} />}
                      issues={issuesAt([...compoundPath, 'id'])}
                      required
                    >
                      <DraftInput
                        value={compound.id ?? ''}
                        onCommit={(id) =>
                          renameValueId(
                            [...compoundPath.slice(1), 'id'],
                            compound.id ?? '',
                            id.trim(),
                          )
                        }
                        placeholder={t(`${I18N_NS}.idPlaceholder`)}
                        className={monoInputClassName}
                      />
                    </FormField>
                    <FormField
                      label={<Trans i18nKey={`${I18N_NS}.labelLabel`} />}
                    >
                      <input
                        type="text"
                        value={compound.label ?? ''}
                        onChange={(e) =>
                          update(
                            [...compoundPath, 'label'],
                            optional(e.target.value),
                          )
                        }
                        placeholder={t(`${I18N_NS}.labelPlaceholder`)}
                        className={inputClassName}
                      />
                    </FormField>
                  </div>
                  <FormField
                    label={<Trans i18nKey={`${I18N_NS}.compoundValueLabel`} />}
                    issues={issuesAt([...compoundPath, 'value'])}
                    required
                  >
                    <input
                      type="text"
                      value={compound.value ?? ''}
                      onChange={(e) =>
                        update([...compoundPath, 'value'], e.target.value)
                      }
                      placeholder="№{{number}} від {{date}}"
                      className={monoInputClassName}
                    />
                  </FormField>
                  {referenceableValues.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        <Trans i18nKey={`${I18N_NS}.insertValueLabel`} />
                      </span>
                      {referenceableValues.map((value) => (
                        <button
                          key={value.id}
                          type="button"
                          onClick={() =>
                            update(
                              [...compoundPath, 'value'],
                              `${compound.value ?? ''}{{${value.id}}}`,
                            )
                          }
                          title={value.label}
                          className="px-1.5 py-0.5 text-xs font-mono rounded bg-gray-100 text-gray-700 hover:bg-blue-100 hover:text-blue-800 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-blue-900 dark:hover:text-blue-100 cursor-pointer"
                        >
                          {`{{${value.id}}}`}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() =>
                update(
                  [...configPath, 'compounds'],
                  [...compounds, withFormKey({ id: '', label: '', value: '' })],
                )
              }
              className={addButtonClassName}
            >
              + <Trans i18nKey={`${I18N_NS}.addCompoundButton`} />
            </button>
          </div>

          {/* Columns */}
          <div className="space-y-3">
            <SectionTitle
              title={<Trans i18nKey={`${I18N_NS}.columnsTitle`} />}
              hint={<Trans i18nKey={`${I18N_NS}.columnsHint`} />}
            />
            <IssueList messages={issuesAt([...configPath, 'columns'])} />
            <SortableList
              items={columns}
              getItemKey={(columnId, index) => `${columnId}#${index}`}
              onReorder={(next) => update([...configPath, 'columns'], next)}
              className="space-y-2"
              itemClassName="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2"
              renderItem={(columnId, { dragHandle }) => {
                const columnIndex = columns.indexOf(columnId);
                const value = allValues.find((v) => v.id === columnId);
                const columnIssues = issuesAt([
                  ...configPath,
                  'columns',
                  columnIndex,
                ]);

                return (
                  <>
                    {dragHandle}
                    <span className="w-6 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                      {columnIndex + 1}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {value?.label ?? columnId}
                      </span>{' '}
                      <code className="text-xs text-gray-500 dark:text-gray-400">
                        {columnId}
                      </code>
                      <IssueList messages={columnIssues} />
                    </span>
                    <RemoveButton
                      onClick={() =>
                        update(
                          [...configPath, 'columns'],
                          columns.filter((_, i) => i !== columnIndex),
                        )
                      }
                      title={t(`${I18N_NS}.removeColumnTitle`)}
                    />
                  </>
                );
              }}
            />
            {unusedValues.length > 0 && (
              <div className="max-w-sm">
                <Select
                  label={<Trans i18nKey={`${I18N_NS}.addColumnLabel`} />}
                  value=""
                  onChange={(id) =>
                    id && update([...configPath, 'columns'], [...columns, id])
                  }
                  options={[
                    { value: '', label: t(`${I18N_NS}.addColumnPlaceholder`) },
                    ...unusedValues.map((value) => ({
                      value: value.id,
                      label: `${value.label} (${value.id})`,
                    })),
                  ]}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

// --- Form ------------------------------------------------------------------

const createEmptyConfig = (): DocRegexConfig =>
  withFormKey({
    name: '',
    fileExtensions: ['.doc', '.docx', '.pdf'],
    qualifier: { mode: 'ALL', rules: [] },
    fields: [],
    compounds: [],
    columns: [],
  });

const DocRegexConfigForm = ({
  configs,
  issues,
  onChange,
}: {
  configs: DocRegexConfig[];
  issues: DocRegexConfigIssue[];
  onChange: (configs: DocRegexConfig[]) => void;
}) => {
  const [collapsedKeys, setCollapsedKeys] = React.useState<Set<number>>(
    new Set(),
  );

  const update: UpdateAt = (path, value) =>
    onChange(setIn(configs, path, value));

  const toggleCollapsed = (key: number) =>
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  const addButtons = (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onChange([...configs, createEmptyConfig()])}
        className="flex items-center gap-2 px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800 cursor-pointer"
      >
        + <Trans i18nKey={`${I18N_NS}.addConfigButton`} />
      </button>
    </div>
  );

  if (configs.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 p-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          <Trans i18nKey={`${I18N_NS}.noConfigsMessage`} />
        </p>
        {addButtons}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <SortableList
        items={configs}
        getItemKey={(config, index) => getFormKey(config) ?? index}
        onReorder={onChange}
        className="space-y-4"
        itemClassName="rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden"
        renderItem={(config, { dragHandle }) => {
          const configIndex = configs.indexOf(config);
          const key = getFormKey(config) ?? configIndex;

          return (
            <ConfigCard
              config={config}
              configIndex={configIndex}
              issues={issues}
              update={update}
              onRemove={() =>
                onChange(configs.filter((_, i) => i !== configIndex))
              }
              isCollapsed={collapsedKeys.has(key)}
              onToggleCollapsed={() => toggleCollapsed(key)}
              dragHandle={dragHandle}
            />
          );
        }}
      />
      {addButtons}
    </div>
  );
};

export { DocRegexConfigForm };
