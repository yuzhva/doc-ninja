import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { FileSystemItem } from 'toolkit--local/browser';

import {
  ButtonProcessing,
  Checkbox,
  Dropdown,
  FormConfigSelect,
  FormInputFileSelect,
  Select,
} from '../../../../components';
import { fetchRequest } from '../../../../utils';
import {
  asPerLineSearchQueries,
  asSingleSearchQuery,
  joinSearchQueries,
} from '../search-queries';
import type { SearchFormProps } from './SearchForm.types';
import { FPDDirectoryTreeItem } from './components/FPDDirectoryTreeItem';
import { FPDModalParserConfigSettings } from './components/FPDModalParserConfigSettings';
import { FPDModalSearchHistory } from './components/FPDModalSearchHistory';

const I18N_NS = 'page.search.container.searchForm';

const SearchForm = ({
  onSelectSourceDirectory,
  initSubmitHandler,
  sourceDirectory,
  isFileSystemAccessSupported,
  isProcessing,
  directoryData,
  selectedPaths,
  onTogglePath,
  searchQueries,
  onSearchQueriesChange,
  allowFuzzyMatch,
  onAllowFuzzyMatchChange,
  maxTypoDistance,
  onMaxTypoDistanceChange,
  parserConfigs,
  selectedParserConfigName,
  onSelectedParserConfigNameChange,
  onParserConfigsSaved,
  addToast,
  onSubmit,
}: SearchFormProps) => {
  const { t } = useTranslation();

  // Whether a source folder is configured at all — checked in one place so
  // every gate below (submit button, index actions, parser/tree sections, the
  // card's own height) reads the same signal instead of re-deriving it.
  const isSourceDirectorySelected = !!directoryData?.structure;

  const subfolders: FileSystemItem[] =
    directoryData?.structure?.fsNestedItems ?? [];

  // How many files the next search reads. `fsFileCount` already includes
  // everything below a folder, and the backend searches a selected folder by
  // path prefix (subfolders included), so only the top-most selected folders
  // count — adding their selected descendants too would count files twice.
  // No selection means the whole source folder.
  const searchedFileCount = React.useMemo(() => {
    const root: FileSystemItem | undefined = directoryData?.structure;
    if (!root) return 0;
    if (selectedPaths.size === 0) return root.fsFileCount ?? 0;

    const countSelected = (node: FileSystemItem): number =>
      selectedPaths.has(node.path)
        ? (node.fsFileCount ?? 0)
        : (node.fsNestedItems ?? []).reduce(
            (sum, child) => sum + countSelected(child),
            0,
          );

    return countSelected(root);
  }, [directoryData, selectedPaths]);

  const [isPageSizeAll, setIsPageSizeAll] = React.useState(false);
  const [pageSizeValue, setPageSizeValue] = React.useState('10');
  const [sortOrder, setSortOrder] = React.useState('desc');
  // A paste out of Excel turns into several separate searches, which the plain
  // textarea gives no sign of — this splits it into one visible row per query.
  // Deliberately not persisted: it's a way to look at the current input, not a
  // preference about how the form should open.
  const [isPerLineMode, setIsPerLineMode] = React.useState(false);
  const [isSearchHistoryOpen, setIsSearchHistoryOpen] = React.useState(false);
  const [isParserConfigSettingsOpen, setIsParserConfigSettingsOpen] =
    React.useState(false);

  const [isSettingsExpanded, setIsSettingsExpanded] = React.useState(
    isSourceDirectorySelected,
  );

  // Auto-expand whenever a new directory arrives from the container (i.e.
  // the user just picked/re-picked a source folder) — mirrors the previous
  // tree-loading effect's `setIsSettingsExpanded(true)`.
  React.useEffect(() => {
    if (directoryData) {
      setIsSettingsExpanded(true);
    }
  }, [directoryData]);

  // Reindex / delete-cache act on the currently selected source folder, so
  // both share the same sourcePath resolution and request plumbing — only
  // the action string (and resulting toast copy) differs.
  const [pendingDocumentsIndexAction, setPendingDocumentsIndexAction] =
    React.useState<'reindex' | 'delete-cache' | null>(null);

  const handleDocumentsIndexAction = React.useCallback(
    async (action: 'reindex' | 'delete-cache') => {
      const sourcePath =
        sourceDirectory?.structure?.path ||
        directoryData?.structure?.path ||
        '';

      if (!sourcePath) {
        addToast('warning', t(`${I18N_NS}.selectSourceFolderFirstWarning`));
        return;
      }

      setPendingDocumentsIndexAction(action);
      try {
        await fetchRequest('/api-local/process/documents-index', {
          method: 'POST',
          body: JSON.stringify({ action, sourcePath }),
        });

        addToast(
          'success',
          action === 'reindex'
            ? t(`${I18N_NS}.reindexSuccessToast`)
            : t(`${I18N_NS}.deleteCacheSuccessToast`),
        );
      } catch (error: any) {
        console.error('Documents index action failed:', error);
        addToast(
          'error',
          t(`${I18N_NS}.actionFailedToast`, {
            message: error.message || error,
          }),
        );
      } finally {
        setPendingDocumentsIndexAction(null);
      }
    },
    [sourceDirectory, directoryData, addToast, t],
  );

  const handleParserConfigSettingsSave = () => {
    setIsParserConfigSettingsOpen(false);
    onParserConfigsSaved();
  };

  const handlePerLineModeChange = (isEnabled: boolean) => {
    // The toggle decides what counts as one query, not just how the input is
    // drawn: the textarea searches its whole content as a single phrase (a
    // quote spanning several lines stays one search), while the per-line editor
    // searches each row on its own. Converting here rather than at submit keeps
    // what gets sent identical to what's on screen.
    onSearchQueriesChange(
      isEnabled
        ? asPerLineSearchQueries(searchQueries)
        : asSingleSearchQuery(searchQueries),
    );

    setIsPerLineMode(isEnabled);
  };

  const handleSearchQueryChange = (index: number, value: string) => {
    onSearchQueriesChange(
      searchQueries.map((query, i) => (i === index ? value : query)),
    );
  };

  const handleSearchQueryRemove = (index: number) => {
    const remaining = searchQueries.filter((_, i) => i !== index);

    // Clearing the last row rather than dropping it — an empty editor would
    // leave nothing on screen to type into.
    onSearchQueriesChange(remaining.length > 0 ? remaining : ['']);
  };

  const handleSearchQueryAdd = () => {
    onSearchQueriesChange([...searchQueries, '']);
  };

  return (
    <div className="lg:col-span-1 lg:h-full lg:min-h-0">
      <div
        className={`flex rounded-lg border border-gray-200 bg-white shadow-md dark:border-gray-700 dark:bg-gray-800 flex-col ${
          isSourceDirectorySelected ? 'lg:h-full lg:min-h-0' : ''
        }`}
        data-testid="flowbite-card"
      >
        {/* Own scroll container from `lg` up — `justify-start` because a
            centered flex child gets clipped at the top once it overflows.
            `relative` keeps absolutely positioned descendants inside it, so
            they scroll and clip with the form instead of growing the page. */}
        <div className="relative flex h-full flex-col justify-center gap-4 p-6 lg:min-h-0 lg:flex-1 lg:justify-start lg:overflow-y-auto">
          {/*
          <h3 className="mb-4 text-xl font-bold dark:text-white">
            Пошук в документах
          </h3>
          */}
          <form onSubmit={initSubmitHandler(onSubmit)}>
            <div
              className={`transition-all duration-500 ease-in-out ${
                isSettingsExpanded
                  ? 'max-h-full opacity-100 pb-4'
                  : 'max-h-0 opacity-0 overflow-hidden'
              }`}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <label
                      htmlFor={
                        isPerLineMode
                          ? 'searchQueryInput-0'
                          : 'bulkNamesTextArea'
                      }
                      className="text-sm font-medium text-gray-900 dark:text-white"
                    >
                      <Trans i18nKey={`${I18N_NS}.searchTextLabel`} />
                    </label>
                    <Checkbox
                      theme="toggle"
                      labelPlacement="start"
                      checked={isPerLineMode}
                      onChange={handlePerLineModeChange}
                      label={<Trans i18nKey={`${I18N_NS}.perLineModeLabel`} />}
                      labelClassName="whitespace-nowrap"
                    />
                  </div>

                  {isPerLineMode ? (
                    <div className="flex flex-col gap-2">
                      {/* Keyed by position on purpose: the rows are plain
                          strings with no identity of their own, and they carry
                          no state beyond the value shown. */}
                      {searchQueries.map((query, index) => (
                        <div key={index} className="flex items-center gap-2">
                          {/*
                          <span className="w-5 shrink-0 text-right text-xs text-gray-400 dark:text-gray-500">
                            {index + 1}
                          </span>
                          */}
                          <input
                            id={`searchQueryInput-${index}`}
                            type="text"
                            value={query}
                            onChange={(e) =>
                              handleSearchQueryChange(index, e.target.value)
                            }
                            className="block flex-1 min-w-0 p-2.5 text-sm text-gray-900 bg-gray-50 rounded-lg border border-gray-300 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                            placeholder={t(`${I18N_NS}.searchTextPlaceholder`)}
                          />
                          <button
                            type="button"
                            onClick={() => handleSearchQueryRemove(index)}
                            title={t(`${I18N_NS}.removeSearchQueryTitle`)}
                            className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600 focus:outline-none dark:hover:bg-gray-700 dark:hover:text-red-400 transition-colors cursor-pointer"
                          >
                            <svg
                              className="w-4 h-4"
                              aria-hidden="true"
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M6 18 17.94 6M18 18 6.06 6"
                              />
                            </svg>
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={handleSearchQueryAdd}
                        className="self-start flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline dark:text-blue-500 cursor-pointer"
                      >
                        <svg
                          className="w-4 h-4"
                          aria-hidden="true"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth="2"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 12h14m-7 7V5"
                          />
                        </svg>
                        <Trans i18nKey={`${I18N_NS}.addSearchQueryButton`} />
                      </button>
                    </div>
                  ) : (
                    <textarea
                      id="bulkNamesTextArea"
                      rows={4}
                      value={joinSearchQueries(searchQueries)}
                      // Whatever is typed here is one query, newlines and all.
                      onChange={(e) => onSearchQueriesChange([e.target.value])}
                      className="block p-2.5 w-full text-sm text-gray-900 bg-gray-50 rounded-lg border border-gray-300 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                      placeholder={t(`${I18N_NS}.searchTextPlaceholder`)}
                    />
                  )}
                </div>

                {/* Max Typo Distance & Fuzzy Toggle */}
                <div className="sm:col-span-2">
                  <label
                    htmlFor="maxTypoDistanceNumber"
                    className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
                  >
                    <Trans i18nKey={`${I18N_NS}.maxTypoDistanceLabel`} />
                  </label>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <input
                        id="maxTypoDistanceNumber"
                        type="number"
                        min="0"
                        value={maxTypoDistance}
                        onChange={(e) =>
                          onMaxTypoDistanceChange(e.target.value)
                        }
                        className="block w-full border bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                        placeholder="1"
                      />
                    </div>

                    <div className="flex-1 flex items-center">
                      <Checkbox
                        theme="toggle"
                        checked={allowFuzzyMatch}
                        onChange={onAllowFuzzyMatchChange}
                        label={
                          <>
                            <span>
                              <Trans
                                i18nKey={`${I18N_NS}.allowFuzzyMatchLabelLine1`}
                              />
                            </span>
                            <span>
                              <Trans
                                i18nKey={`${I18N_NS}.allowFuzzyMatchLabelLine2`}
                              />
                            </span>
                          </>
                        }
                        labelClassName="flex flex-col justify-center leading-tight whitespace-nowrap"
                      />
                    </div>
                  </div>
                </div>

                {/* Page Size & Toggle */}
                <div className="sm:col-span-2">
                  <label
                    htmlFor="pageSizeNumber"
                    className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
                  >
                    <Trans i18nKey={`${I18N_NS}.pageSizeLabel`} />
                  </label>
                  <div className="flex items-center gap-4">
                    {/* Input - Swapped place with toggle */}
                    <div className="flex-1">
                      <input
                        id="pageSizeNumber"
                        type="number"
                        min="1"
                        value={pageSizeValue}
                        onChange={(e) => setPageSizeValue(e.target.value)}
                        disabled={isPageSizeAll}
                        className="block w-full border disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                        placeholder="10"
                      />
                      {/* Hidden input to send correct value to API */}
                      <input
                        type="hidden"
                        name="pageSize"
                        value={isPageSizeAll ? 'ALL' : pageSizeValue}
                      />
                    </div>

                    {/* Toggle - Swapped place with input */}
                    <div className="flex-1 flex items-center">
                      <Checkbox
                        theme="toggle"
                        checked={isPageSizeAll}
                        onChange={setIsPageSizeAll}
                        label={<Trans i18nKey={`${I18N_NS}.findAllLabel`} />}
                        labelClassName="whitespace-nowrap"
                      />
                    </div>
                  </div>
                </div>

                {/* Sort Order - Moved to new line */}
                <div className="sm:col-span-2">
                  <Select
                    id="sortOrder"
                    name="sortOrder"
                    label={<Trans i18nKey={`${I18N_NS}.sortOrderLabel`} />}
                    value={sortOrder}
                    onChange={setSortOrder}
                    options={[
                      {
                        value: 'desc',
                        label: t(`${I18N_NS}.sortOrderOptions.desc`),
                      },
                      {
                        value: 'asc',
                        label: t(`${I18N_NS}.sortOrderOptions.asc`),
                      },
                    ]}
                  />
                </div>

                <div className="sm:col-span-2 grid grid-cols-2 gap-4 pb-2">
                  <button
                    type="button"
                    onClick={() => setIsSearchHistoryOpen(true)}
                    className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-500 flex items-center justify-center cursor-pointer"
                  >
                    <Trans i18nKey={`${I18N_NS}.searchHistoryButton`} />
                  </button>

                  <ButtonProcessing
                    type="submit"
                    isLoading={isProcessing}
                    disabled={!isSourceDirectorySelected}
                  >
                    <Trans i18nKey={`${I18N_NS}.searchButton`} />
                  </ButtonProcessing>
                </div>
              </div>
            </div>

            <div className="relative flex items-center justify-center w-full mb-6 group">
              <hr className="w-full h-px bg-gray-200 border-0 dark:bg-gray-700 group-hover:bg-blue-200 dark:group-hover:bg-blue-900 transition-colors" />
              <button
                type="button"
                onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
                className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center w-8 h-8 rounded-full bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-blue-500 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:border-blue-400 transition-all cursor-pointer z-10"
                title={t(
                  isSettingsExpanded
                    ? `${I18N_NS}.collapseSettingsTitle`
                    : `${I18N_NS}.expandSettingsTitle`,
                )}
              >
                <svg
                  className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform duration-300 ${
                    isSettingsExpanded ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
            </div>

            <div className="grid gap-4 mb-4 sm:grid-cols-2">
              <div className="sm:col-span-2 flex items-end gap-2">
                <div className="flex-1">
                  <FormInputFileSelect
                    id="processDocumentsSourceFolder"
                    name="sourceDirectory"
                    label={<Trans i18nKey={`${I18N_NS}.sourceFolderLabel`} />}
                    onClick={onSelectSourceDirectory}
                    selectedItem={sourceDirectory || directoryData}
                    isFileSystemAccessSupported={isFileSystemAccessSupported}
                    icon="folder"
                  />
                </div>

                <Dropdown
                  openDirection="up"
                  panelClassName="right-0 bg-white dark:bg-gray-800"
                  panelPadding=""
                  trigger={({ toggle }) => (
                    <button
                      type="button"
                      onClick={toggle}
                      title={t(`${I18N_NS}.documentsIndexActionsTitle`)}
                      className={`${
                        !isSourceDirectorySelected
                          ? 'opacity-50 cursor-not-allowed '
                          : 'cursor-pointer '
                      }shrink-0 rounded-lg p-2.5 text-sm text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-700`}
                      disabled={!isSourceDirectorySelected}
                    >
                      <svg
                        className="w-5 h-5"
                        aria-hidden="true"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth="2"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"
                        />
                      </svg>
                    </button>
                  )}
                >
                  <ul className="text-xs text-gray-700 dark:text-gray-200">
                    <li>
                      <button
                        type="button"
                        onClick={() => handleDocumentsIndexAction('reindex')}
                        disabled={pendingDocumentsIndexAction !== null}
                        className="w-full whitespace-nowrap flex items-center gap-2 text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <svg
                          className="w-4 h-4 shrink-0"
                          aria-hidden="true"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth="2"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M17.651 7.65a7.131 7.131 0 0 0-12.68 3.15M18.001 4v4h-4m-7.652 8.35a7.13 7.13 0 0 0 12.68-3.15M6 20v-4h4"
                          />
                        </svg>
                        <Trans i18nKey={`${I18N_NS}.reindexAction`} />
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        onClick={() =>
                          handleDocumentsIndexAction('delete-cache')
                        }
                        disabled={pendingDocumentsIndexAction !== null}
                        className="w-full whitespace-nowrap flex items-center gap-2 text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-red-600 dark:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <svg
                          className="w-4 h-4 shrink-0"
                          aria-hidden="true"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth="2"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                          />
                        </svg>
                        <Trans i18nKey={`${I18N_NS}.deleteCacheAction`} />
                      </button>
                    </li>
                  </ul>
                </Dropdown>
              </div>

              {/* Parser Config Selection */}
              {isSourceDirectorySelected && (
                <div className="sm:col-span-2">
                  <FormConfigSelect
                    id="parserConfigName"
                    name="parserConfigName"
                    label={<Trans i18nKey={`${I18N_NS}.parserConfigLabel`} />}
                    value={selectedParserConfigName}
                    onChange={onSelectedParserConfigNameChange}
                    options={parserConfigs.map((c: any) => ({
                      value: c.name,
                      label: c.name,
                    }))}
                    noneOption={{
                      value: '',
                      label: t(`${I18N_NS}.noParsingOption`),
                    }}
                    settingsTitle={t(`${I18N_NS}.parserSettingsTitle`)}
                    onSettingsClick={() => setIsParserConfigSettingsOpen(true)}
                  />
                </div>
              )}

              {/* Directory Tree View — shown for any picked folder: one with
                  files but no subfolders still needs its file count, and an
                  empty one needs saying so before a search finds nothing. */}
              {isSourceDirectorySelected && (
                <div className="sm:col-span-2 border border-gray-200 dark:border-gray-700 rounded-lg p-2 max-h-96 overflow-y-auto bg-gray-50 dark:bg-gray-900">
                  <div className="flex items-baseline justify-between gap-2 mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                    <span className="uppercase">
                      <Trans
                        i18nKey={`${I18N_NS}.${
                          selectedPaths.size === 0
                            ? 'searchFoldersLabelAll'
                            : 'searchFoldersLabelScoped'
                        }`}
                      />
                    </span>
                    <span className="shrink-0 whitespace-nowrap font-normal">
                      {t(`${I18N_NS}.searchFilesCount`, {
                        count: searchedFileCount,
                      })}
                    </span>
                  </div>

                  {subfolders.length === 0 && (
                    <p
                      className={`px-1 py-1 text-sm ${
                        (directoryData.structure.fsFileCount ?? 0) > 0
                          ? 'text-gray-500 dark:text-gray-400'
                          : 'text-yellow-700 dark:text-yellow-400'
                      }`}
                    >
                      {t(
                        `${I18N_NS}.${
                          (directoryData.structure.fsFileCount ?? 0) > 0
                            ? 'searchFoldersNoSubfolders'
                            : 'searchFoldersEmpty'
                        }`,
                      )}
                    </p>
                  )}
                  {/* An empty selection searches everything — without saying
                        so, the unchecked boxes read as "nothing is included"
                        and users tick every folder by hand. */}
                  {/*
                    <div className={`text-xs text-gray-400 dark:text-gray-500 mb-2 ${selectedPaths.size === 0 ? '' : 'opacity-0'}`}>
                        <Trans
                          i18nKey={`${I18N_NS}.searchFoldersHintAll`}
                        />
                    </div>
                    */}
                  {subfolders.map((fsNestedItem) => (
                    <FPDDirectoryTreeItem
                      key={fsNestedItem.path}
                      fsNestedItem={fsNestedItem}
                      selectedPaths={selectedPaths}
                      onTogglePath={onTogglePath}
                    />
                  ))}
                </div>
              )}
            </div>
          </form>
        </div>
      </div>

      <FPDModalParserConfigSettings
        isOpen={isParserConfigSettingsOpen}
        onClose={() => setIsParserConfigSettingsOpen(false)}
        onSave={handleParserConfigSettingsSave}
      />

      <FPDModalSearchHistory
        isOpen={isSearchHistoryOpen}
        onClose={() => setIsSearchHistoryOpen(false)}
        onSelectQuery={(query) => {
          // History keeps the multi-line string the textarea showed, so it has
          // to be re-read through whichever editor is currently open.
          onSearchQueriesChange(
            isPerLineMode
              ? asPerLineSearchQueries([query])
              : asSingleSearchQuery([query]),
          );
          setIsSearchHistoryOpen(false);
        }}
      />
    </div>
  );
};

export { SearchForm };
