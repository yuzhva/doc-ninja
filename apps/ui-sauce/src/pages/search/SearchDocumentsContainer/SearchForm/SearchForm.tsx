import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import {
  ButtonProcessing,
  Checkbox,
  ConfirmModal,
  Select,
} from '../../../../components';
import { fetchRequest } from '../../../../utils';
import { useParserConfigs } from '../search-configs-store';
import {
  asPerLineSearchQueries,
  asSingleSearchQuery,
  joinSearchQueries,
} from '../search-queries';
import { countSearchedFiles } from '../search-sources';
import type { SearchSource } from '../search-sources';
import {
  searchSourcesStore,
  useSearchSources,
  useSelectedPaths,
} from '../search-sources-store';
import type { SearchFormProps } from './SearchForm.types';
import { FPDModalParserConfigSettings } from './components/FPDModalParserConfigSettings';
import {
  FPDModalSearchHistory,
  addSearchHistoryEntry,
} from './components/FPDModalSearchHistory';
import { FPDSourceFolderItem } from './components/FPDSourceFolderItem';
import type { DocumentsIndexAction } from './components/FPDSourceFolderItem';

const I18N_NS = 'page.search.container.searchForm';

const SearchForm = ({
  onSelectSourceDirectory,
  isFileSystemAccessSupported,
  isProcessing,
  addToast,
  onSearch,
}: SearchFormProps) => {
  const { t } = useTranslation();
  const parserConfigs = useParserConfigs();

  // The folders searched, each a root of the tree with its own parser config,
  // and which of their folders are ticked
  const sources = useSearchSources();
  const selectedPaths = useSelectedPaths();

  // The trees kept are snapshots of the moment each folder was picked: read
  // them anew each time the page opens. Picking a folder reads it fresh anyway.
  React.useEffect(() => {
    searchSourcesStore.refresh();
  }, []);

  const handleAddSourceFolder = async () => {
    const picked = await onSelectSourceDirectory();
    if (!picked?.structure?.path) return;

    const overlapping = searchSourcesStore.addPickedFolder(picked.structure);
    if (overlapping) {
      addToast(
        'warning',
        t(`${I18N_NS}.sourceFolderOverlapsWarning`, {
          name: picked.structure.name,
          other: overlapping.structure.name,
        }),
      );
    }
  };

  // One query per entry: the per-line editor shows one row each, and the
  // request sends them as an array.
  const [searchQueries, setSearchQueries] = React.useState<string[]>(['']);
  const [allowFuzzyMatch, setAllowFuzzyMatch] = React.useState(true);
  const [maxTypoDistance, setMaxTypoDistance] = React.useState('1');

  // Whether there is a folder to search at all — checked in one place so
  // every gate below (submit button, the card's own height) reads the same
  // signal instead of re-deriving it.
  const isSourceDirectorySelected = sources.length > 0;

  // How many files the next search reads, across every folder searched
  const searchedFileCount = React.useMemo(
    () => countSearchedFiles(sources, selectedPaths),
    [sources, selectedPaths],
  );

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

  // Auto-expand whenever the folders change in number (i.e. the user just
  // added or removed a source folder) — mirrors the previous tree-loading
  // effect's `setIsSettingsExpanded(true)`.
  React.useEffect(() => {
    if (sources.length > 0) {
      setIsSettingsExpanded(true);
    }
  }, [sources.length]);

  // Reindex / delete-cache act on one source folder each, and share the same
  // request plumbing — only the action string (and resulting toast copy)
  // differs. One folder's action doesn't hold up another's.
  const [pendingIndexActionByPath, setPendingIndexActionByPath] =
    React.useState<Record<string, DocumentsIndexAction>>({});

  /** Runs the action, with a toast either way; resolves to whether it did. */
  const runDocumentsIndexAction = React.useCallback(
    async (
      source: SearchSource,
      action: DocumentsIndexAction,
      successToast: string,
    ) => {
      const { path: sourcePath, name } = source.structure;

      setPendingIndexActionByPath((prev) => ({
        ...prev,
        [sourcePath]: action,
      }));
      try {
        await fetchRequest('/api-local/process/documents-index', {
          method: 'POST',
          body: JSON.stringify({ action, sourcePath }),
        });

        addToast('success', successToast);
        return true;
      } catch (error: any) {
        console.error('Documents index action failed:', error);
        // Several folders' actions can run at once: each toast names its own
        addToast(
          'error',
          t(`${I18N_NS}.actionFailedToast`, {
            name,
            message: error.message || error,
          }),
        );
        return false;
      } finally {
        setPendingIndexActionByPath(
          ({ [sourcePath]: _done, ...stillPending }) => stillPending,
        );
      }
    },
    [addToast, t],
  );

  const handleDocumentsIndexAction = (
    source: SearchSource,
    action: DocumentsIndexAction,
  ) => {
    const { name } = source.structure;
    runDocumentsIndexAction(
      source,
      action,
      action === 'reindex'
        ? t(`${I18N_NS}.reindexSuccessToast`, { name })
        : t(`${I18N_NS}.deleteCacheSuccessToast`, { name }),
    );
  };

  // The folder whose removal is being confirmed
  const [sourceToRemove, setSourceToRemove] =
    React.useState<SearchSource | null>(null);
  const cancelSourceRemoval = React.useCallback(
    () => setSourceToRemove(null),
    [],
  );

  const handleRemoveSourceKeepingCache = () => {
    if (!sourceToRemove) return;
    setSourceToRemove(null);
    searchSourcesStore.removeFolder(sourceToRemove.structure.path);
  };

  // The folder stays in the list, its gear spinning, until its cache is gone:
  // were that to fail, it's still there to try again
  const handleRemoveSourceWithCache = async () => {
    if (!sourceToRemove) return;
    const source = sourceToRemove;
    setSourceToRemove(null);

    const isCacheDeleted = await runDocumentsIndexAction(
      source,
      'delete-cache',
      t(`${I18N_NS}.removeSourceWithCacheSuccessToast`, {
        name: source.structure.name,
      }),
    );
    if (isCacheDeleted) searchSourcesStore.removeFolder(source.structure.path);
  };

  // The saved configs reach every picker through their store
  const handleParserConfigSettingsSave = () => {
    setIsParserConfigSettingsOpen(false);
  };

  const handlePerLineModeChange = (isEnabled: boolean) => {
    // The toggle decides what counts as one query, not just how the input is
    // drawn: the textarea searches its whole content as a single phrase (a
    // quote spanning several lines stays one search), while the per-line editor
    // searches each row on its own. Converting here rather than at submit keeps
    // what gets sent identical to what's on screen.
    setSearchQueries(
      isEnabled
        ? asPerLineSearchQueries(searchQueries)
        : asSingleSearchQuery(searchQueries),
    );

    setIsPerLineMode(isEnabled);
  };

  const handleSearchQueryChange = (index: number, value: string) => {
    setSearchQueries(
      searchQueries.map((query, i) => (i === index ? value : query)),
    );
  };

  const handleSearchQueryRemove = (index: number) => {
    const remaining = searchQueries.filter((_, i) => i !== index);

    // Clearing the last row rather than dropping it — an empty editor would
    // leave nothing on screen to type into.
    setSearchQueries(remaining.length > 0 ? remaining : ['']);
  };

  const handleSearchQueryAdd = () => {
    setSearchQueries([...searchQueries, '']);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // History is stored as the one multi-line string the textarea shows, so
    // restoring an entry drops straight back into either editor.
    addSearchHistoryEntry(joinSearchQueries(searchQueries));

    onSearch({
      queries: searchQueries,
      isInflectedWordFormsAllowed: allowFuzzyMatch,
      maxTypoDistance: Number(maxTypoDistance),
      pageSize: isPageSizeAll ? 'ALL' : Number(pageSizeValue),
      sortOrder: sortOrder === 'asc' ? 'asc' : 'desc',
    });
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
          <form onSubmit={handleSubmit}>
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
                      onChange={(e) => setSearchQueries([e.target.value])}
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
                        onChange={(e) => setMaxTypoDistance(e.target.value)}
                        className="block w-full border bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                        placeholder="1"
                      />
                    </div>

                    <div className="flex-1 flex items-center">
                      <Checkbox
                        theme="toggle"
                        checked={allowFuzzyMatch}
                        onChange={setAllowFuzzyMatch}
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

            {/* Source folders — each a root of the tree, with its own parser
                config and index actions. No height cap on purpose: a cap
                makes the box a scroll container, which would clip the
                folders' menus; the form column scrolls instead. */}
            <div className="mb-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  <Trans i18nKey={`${I18N_NS}.sourceFoldersLabel`} />
                </span>
                {isSourceDirectorySelected && (
                  <button
                    type="button"
                    onClick={handleAddSourceFolder}
                    disabled={!isFileSystemAccessSupported}
                    className="shrink-0 flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline dark:text-blue-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
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
                    <Trans i18nKey={`${I18N_NS}.addSourceFolderButton`} />
                  </button>
                )}
              </div>

              {isSourceDirectorySelected ? (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-2 bg-gray-50 dark:bg-gray-900">
                  <div className="flex items-baseline justify-between gap-2 mb-1 px-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
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

                  <div className="divide-y divide-gray-200 dark:divide-gray-700">
                    {sources.map((source) => (
                      <FPDSourceFolderItem
                        key={source.structure.path}
                        source={source}
                        selectedPaths={selectedPaths}
                        onTogglePath={searchSourcesStore.togglePath}
                        onCollapsedChange={(isCollapsed) =>
                          searchSourcesStore.changeFolder(
                            source.structure.path,
                            { isCollapsed },
                          )
                        }
                        parserConfigs={parserConfigs}
                        onParserConfigChange={(parserConfigName) =>
                          searchSourcesStore.changeFolder(
                            source.structure.path,
                            { parserConfigName },
                          )
                        }
                        onOpenParserSettings={() =>
                          setIsParserConfigSettingsOpen(true)
                        }
                        pendingIndexAction={
                          pendingIndexActionByPath[source.structure.path] ??
                          null
                        }
                        onIndexAction={(action) =>
                          handleDocumentsIndexAction(source, action)
                        }
                        onRemove={() => setSourceToRemove(source)}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                // Nothing to search yet: the one thing to do here is add a
                // folder, so the whole box is the button for it
                <button
                  type="button"
                  onClick={handleAddSourceFolder}
                  disabled={!isFileSystemAccessSupported}
                  className="w-full flex items-center justify-center gap-2 p-4 text-sm font-medium text-blue-700 border border-dashed border-blue-300 rounded-lg hover:bg-blue-50 focus:outline-none focus:ring-4 focus:ring-blue-200 dark:text-blue-400 dark:border-blue-700 dark:hover:bg-blue-900/30 dark:focus:ring-blue-900 cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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
                      d="M14 13h-4m2-2v4m-9 4V6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"
                    />
                  </svg>
                  <Trans i18nKey={`${I18N_NS}.addFirstSourceFolderButton`} />
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      <ConfirmModal
        isOpen={sourceToRemove !== null}
        title={t(`${I18N_NS}.removeSourceConfirmTitle`)}
        message={
          <Trans
            i18nKey={`${I18N_NS}.removeSourceConfirmMessage`}
            values={{ name: sourceToRemove?.structure.name ?? '' }}
            components={{ strong: <strong />, code: <code />, br: <br /> }}
          />
        }
        alternativeLabel={t(`${I18N_NS}.removeSourceKeepCacheButton`)}
        onAlternative={handleRemoveSourceKeepingCache}
        confirmLabel={t(`${I18N_NS}.removeSourceWithCacheButton`)}
        onConfirm={handleRemoveSourceWithCache}
        onCancel={cancelSourceRemoval}
      />

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
          setSearchQueries(
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
