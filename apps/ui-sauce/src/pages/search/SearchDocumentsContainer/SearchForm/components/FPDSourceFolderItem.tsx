import React from 'react';
import { useTranslation } from 'react-i18next';

import { Checkbox, Dropdown } from '../../../../../components';
import type { SearchSource } from '../../search-sources';
import { isPathWithin } from '../../search-sources';
import { FPDDirectoryTreeItem } from './FPDDirectoryTreeItem';

const I18N_NS = 'page.search.component.fpdSourceFolderItem';

type DocumentsIndexAction = 'reindex' | 'delete-cache';

// Entries may wrap: a panel in the narrow form column has no room to spare
const menuItemClassName =
  'w-full flex items-center gap-2 text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

// The two buttons at the right of a folder's header
const headerButtonClassName =
  'shrink-0 flex items-center justify-center w-6 h-6 rounded-md text-gray-500 hover:bg-gray-200 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:text-gray-400 dark:hover:bg-gray-600 dark:hover:text-white dark:focus:ring-gray-600 cursor-pointer';

const GEAR_ICON_PATH =
  'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z';

const MenuIcon = ({ d }: { d: string }) => (
  <svg
    className="w-4 h-4 shrink-0"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth="2"
    stroke="currentColor"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

const CheckIcon = ({ isVisible }: { isVisible: boolean }) => (
  <svg
    className={`w-4 h-4 shrink-0 text-blue-600 dark:text-blue-500 ${isVisible ? '' : 'invisible'}`}
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth="2"
    stroke="currentColor"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4.5 4.5L19 7" />
  </svg>
);

/**
 * One source folder in the search form, as a section that folds: a header
 * with its tick, its actions and the fold button, and below it what belongs
 * to the folder — the parser config its finds are extracted with, and its
 * subfolders.
 */
const FPDSourceFolderItem = ({
  source,
  selectedPaths,
  onTogglePath,
  onCollapsedChange,
  parserConfigs,
  onParserConfigChange,
  onOpenParserSettings,
  pendingIndexAction,
  onIndexAction,
  onRemove,
}: {
  source: SearchSource;
  selectedPaths: Set<string>;
  onTogglePath: (path: string, checked: boolean) => void;
  onCollapsedChange: (isCollapsed: boolean) => void;
  parserConfigs: any[];
  onParserConfigChange: (parserConfigName: string) => void;
  onOpenParserSettings: () => void;
  // The index action running on this folder, if any.
  pendingIndexAction: DocumentsIndexAction | null;
  onIndexAction: (action: DocumentsIndexAction) => void;
  // Asks whether to, rather than removes it
  onRemove: () => void;
}) => {
  const { t } = useTranslation();
  const bodyId = React.useId();

  const { structure, parserConfigName } = source;
  const isExpanded = !source.isCollapsed;
  const subfolders = structure.fsNestedItems ?? [];
  const fileCount = structure.fsFileCount ?? 0;
  const isSelected = selectedPaths.has(structure.path);

  // Some of its subfolders ticked: only those are searched, which an
  // unticked box would hide
  const isPartlySelected =
    !isSelected &&
    [...selectedPaths].some((path) => isPathWithin(path, structure.path));

  // A config renamed or deleted is no config: the backend parses with none
  const parserConfig = parserConfigs.find(
    (config: any) => config.name === parserConfigName,
  );
  const parserConfigLabel = parserConfig?.name ?? t(`${I18N_NS}.noParsing`);

  return (
    <div className="w-full py-1">
      {/* The header ticks the folder wherever it's clicked, but on its two
          buttons: folding is the chevron's job alone */}
      <div className="flex items-center gap-x-2 px-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700/60">
        <Checkbox
          checked={isSelected}
          indeterminate={isPartlySelected}
          onChange={(checked) => onTogglePath(structure.path, checked)}
          title={structure.name}
          className="shrink-0"
        />

        <div
          className="flex items-center gap-x-2 cursor-pointer grow min-w-0 py-1"
          onClick={() => onTogglePath(structure.path, !isSelected)}
          // Two folders can share a name: the path tells them apart
          title={structure.path}
        >
          <svg
            className="shrink-0 w-4 h-4 text-gray-500 dark:text-gray-400"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
          </svg>
          <span className="min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-white select-none">
            {structure.name}
          </span>
          <span className="shrink-0 text-xs text-gray-400 select-none">
            ({fileCount})
          </span>
        </div>

        <div className="shrink-0 flex items-center gap-0.5">
          <Dropdown
            // The folders are the last thing in the form: one low in the
            // list has more room above it
            openDirection="auto"
            // As wide as its entries: hung off a button this small, the panel
            // would otherwise shrink to its longest word
            panelClassName="right-0 w-max max-w-64 bg-white dark:bg-gray-800"
            panelPadding=""
            trigger={({ toggle, isOpen }) => (
              <button
                type="button"
                onClick={toggle}
                disabled={pendingIndexAction !== null}
                title={t(`${I18N_NS}.actionsTitle`)}
                aria-label={t(`${I18N_NS}.actionsTitle`)}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                className={`${headerButtonClassName} disabled:cursor-wait`}
              >
                {pendingIndexAction !== null ? (
                  // The index action can take a while on a large folder
                  <svg
                    className="w-4 h-4 animate-spin"
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                ) : (
                  <MenuIcon d={GEAR_ICON_PATH} />
                )}
              </button>
            )}
          >
            {({ close }) => (
              <ul
                role="menu"
                className="text-xs text-gray-700 dark:text-gray-200"
              >
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      onIndexAction('reindex');
                    }}
                    className={menuItemClassName}
                  >
                    <MenuIcon d="M17.651 7.65a7.131 7.131 0 0 0-12.68 3.15M18.001 4v4h-4m-7.652 8.35a7.13 7.13 0 0 0 12.68-3.15M6 20v-4h4" />
                    {t(`${I18N_NS}.reindexAction`)}
                  </button>
                </li>
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      onIndexAction('delete-cache');
                    }}
                    className={menuItemClassName}
                  >
                    <MenuIcon d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    {t(`${I18N_NS}.deleteCacheAction`)}
                  </button>
                </li>
                <li
                  role="none"
                  className="border-t border-gray-100 dark:border-gray-700"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      onRemove();
                    }}
                    className={`${menuItemClassName} text-red-600 dark:text-red-400`}
                  >
                    <MenuIcon d="M6 18 17.94 6M18 18 6.06 6" />
                    {t(`${I18N_NS}.removeAction`)}
                  </button>
                </li>
              </ul>
            )}
          </Dropdown>

          <button
            type="button"
            onClick={() => onCollapsedChange(isExpanded)}
            title={t(
              isExpanded
                ? `${I18N_NS}.collapseLabel`
                : `${I18N_NS}.expandLabel`,
            )}
            aria-label={t(
              isExpanded
                ? `${I18N_NS}.collapseLabel`
                : `${I18N_NS}.expandLabel`,
            )}
            aria-expanded={isExpanded}
            aria-controls={bodyId}
            className={headerButtonClassName}
          >
            <svg
              className={`w-4 h-4 transition-transform duration-200 ease-out ${isExpanded ? 'rotate-180' : ''}`}
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
                d="m19 9-7 7-7-7"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Fades in as it opens. Its height isn't animated: that takes a
          clipped box, which would cut off the parser menu inside it. */}
      {isExpanded && (
        <div
          id={bodyId}
          className="transition duration-200 ease-out starting:opacity-0 starting:-translate-y-1"
        >
          {/* The chip lines up with the subfolders' ticks below it; its
              panel takes the section's full width */}
          <div className="py-0.5">
            <Dropdown
              openDirection="auto"
              // As wide as the section: the chip sits at its left, with too
              // little room after it for the panel in a narrow column
              panelClassName="inset-x-0 bg-white dark:bg-gray-800"
              panelPadding="py-1"
              trigger={({ toggle, isOpen }) => (
                <button
                  type="button"
                  onClick={toggle}
                  title={t(`${I18N_NS}.parserConfigTitle`)}
                  aria-haspopup="listbox"
                  aria-expanded={isOpen}
                  className="ml-8 inline-flex max-w-[calc(100%-2rem)] items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700 hover:border-blue-400 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:text-blue-400 dark:focus:ring-blue-800 cursor-pointer"
                >
                  <svg
                    className="w-3.5 h-3.5 shrink-0"
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
                      d="M10 3v4a1 1 0 0 1-1 1H5m4 6 2 2 4-4m4-8v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1Z"
                    />
                  </svg>
                  <span className="truncate">{parserConfigLabel}</span>
                  <svg
                    className={`w-3 h-3 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
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
                      d="m19 9-7 7-7-7"
                    />
                  </svg>
                </button>
              )}
            >
              {({ close }) => (
                <ul
                  role="listbox"
                  aria-label={t(`${I18N_NS}.parserConfigTitle`)}
                  className="text-sm text-gray-700 dark:text-gray-200"
                >
                  {[
                    { value: '', label: t(`${I18N_NS}.noParsing`) },
                    ...parserConfigs.map((config: any) => ({
                      value: config.name,
                      label: config.name,
                    })),
                  ].map((option) => {
                    const isChosen =
                      option.value === (parserConfig ? parserConfig.name : '');
                    return (
                      <li
                        key={option.value}
                        role="option"
                        aria-selected={isChosen}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            close();
                            onParserConfigChange(option.value);
                          }}
                          className={`${menuItemClassName} ${isChosen ? 'font-medium text-gray-900 dark:text-white' : ''}`}
                        >
                          <CheckIcon isVisible={isChosen} />
                          <span className="truncate">{option.label}</span>
                        </button>
                      </li>
                    );
                  })}
                  <li
                    role="none"
                    className="border-t border-gray-100 dark:border-gray-700"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        onOpenParserSettings();
                      }}
                      className={`${menuItemClassName} text-blue-700 dark:text-blue-400`}
                    >
                      <MenuIcon
                        d={
                          parserConfigs.length > 0
                            ? GEAR_ICON_PATH
                            : 'M5 12h14m-7 7V5'
                        }
                      />
                      {/* With no config yet, the settings are where one is
                          made — say so, rather than offering to "set up"
                          an empty list */}
                      {t(
                        parserConfigs.length > 0
                          ? `${I18N_NS}.parserSettingsAction`
                          : `${I18N_NS}.createParserConfigAction`,
                      )}
                    </button>
                  </li>
                </ul>
              )}
            </Dropdown>
          </div>

          {fileCount === 0 && (
            <p className="ml-8 py-0.5 text-xs text-yellow-700 dark:text-yellow-400">
              {t(`${I18N_NS}.emptyFolderMessage`)}
            </p>
          )}

          {subfolders.map((subfolder) => (
            <FPDDirectoryTreeItem
              key={subfolder.path}
              fsNestedItem={subfolder}
              selectedPaths={selectedPaths}
              onTogglePath={onTogglePath}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export { FPDSourceFolderItem };
export type { DocumentsIndexAction };
