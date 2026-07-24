import React from 'react';

import { Modal, Tabs } from '../../../../components';
import { FileSystemBridge } from '../../../../utils/file-system-bridge';

interface FilterRule {
  id: number;
  labelOption: string;
  containsText: string[];
}

interface FilterCategory {
  id: number;
  labelFilterTitle: string;
  labelFilterDescription: string;
  filterRules: FilterRule[];
}

const FPDModalFilterSettings = ({
  isOpen,
  onClose,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}) => {
  const [configJson, setConfigJson] = React.useState('');
  const [filterCategories, setFilterCategories] = React.useState<
    FilterCategory[]
  >([]);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = React.useState<
    Set<number>
  >(new Set());

  // Monotonic counter for client-side category/rule ids (not persisted).
  const nextEntityId = React.useRef(0);
  const createEntityId = () => nextEntityId.current++;

  const buildFilterCategories = (parsed: unknown): FilterCategory[] => {
    if (!Array.isArray(parsed)) return [];
    return parsed.map((category) => ({
      id: createEntityId(),
      labelFilterTitle: category?.labelFilterTitle ?? '',
      labelFilterDescription: category?.labelFilterDescription ?? '',
      filterRules: Array.isArray(category?.filterRules)
        ? category.filterRules.map((rule: any) => ({
            id: createEntityId(),
            labelOption: rule?.labelOption ?? '',
            containsText: Array.isArray(rule?.containsText)
              ? rule.containsText
              : [],
          }))
        : [],
    }));
  };

  // Strip client-side ids and restore the persisted JSON shape.
  const serializeFilterCategories = (categories: FilterCategory[]) =>
    categories.map(
      ({ labelFilterTitle, labelFilterDescription, filterRules }) => ({
        labelFilterTitle,
        labelFilterDescription,
        filterRules: filterRules.map(({ containsText, labelOption }) => ({
          containsText,
          labelOption,
        })),
      }),
    );

  // Keep the Form tab state and the JSON tab textarea in sync on every edit.
  const commitFilterCategories = (next: FilterCategory[]) => {
    setFilterCategories(next);
    setConfigJson(JSON.stringify(serializeFilterCategories(next), null, 2));
  };

  // Sync JSON -> Form once the user is done editing (not on every keystroke,
  // since rebuilding categories mints new ids and would reset the
  // collapsed/expanded state on every change). Silently skip invalid JSON;
  // the user will get a proper error on Save.
  const handleConfigJsonBlur = () => {
    try {
      const parsed = JSON.parse(configJson);
      setFilterCategories(buildFilterCategories(parsed));
    } catch (e) {
      // Leave the Form tab as-is until the JSON becomes valid again.
    }
  };

  React.useEffect(() => {
    if (isOpen) {
      try {
        const saved = localStorage.getItem('docNinja_filterConfig');
        const parsed = saved ? JSON.parse(saved) : [];
        setConfigJson(JSON.stringify(parsed, null, 2));
        setFilterCategories(buildFilterCategories(parsed));
      } catch (e) {
        // Fallback if local storage is corrupted
        setConfigJson('[]');
        setFilterCategories([]);
      }
    }
  }, [isOpen]);

  const handleSaveClick = () => {
    try {
      // Validate JSON before saving
      const parsed = JSON.parse(configJson);
      // Minify or keep formatted? Keep formatted for editability usually, but storage size matters less here.
      localStorage.setItem('docNinja_filterConfig', JSON.stringify(parsed));
      onSave();
    } catch (e) {
      alert('Помилка: Невалідний JSON формат');
    }
  };

  const handleImportJson = async () => {
    try {
      const result = await FileSystemBridge.pickFile({
        types: [
          {
            description: 'JSON Config',
            accept: { 'application/json': ['.json'] },
          },
        ],
        excludeAcceptAllOption: true,
        multiple: false,
      });

      if (!result) return;

      // Resolve content: could be File object (Browser) or Buffer/Uint8Array (Electron Bridge)
      const rawContent = await Promise.resolve(
        result.files[0].getFileContent(),
      );
      let contentStr = '';

      if (rawContent instanceof Blob) {
        contentStr = await rawContent.text();
      } else {
        // Assume Buffer/Uint8Array from Electron
        contentStr = new TextDecoder('utf-8').decode(rawContent as any);
      }

      // Validate JSON
      const parsed = JSON.parse(contentStr);
      setConfigJson(JSON.stringify(parsed, null, 2));
      setFilterCategories(buildFilterCategories(parsed));
    } catch (e) {
      console.error('Import failed', e);
      alert('Помилка імпорту: Невалідний файл або формат JSON');
    }
  };

  const handleExportJson = async () => {
    try {
      // Check for valid JSON before export
      JSON.parse(configJson);

      const blob = new Blob([configJson], { type: 'application/json' });
      const fileName = 'doc-ninja-filters.json';

      if ('showSaveFilePicker' in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: fileName,
            types: [
              {
                description: 'JSON File',
                accept: { 'application/json': ['.json'] },
              },
            ],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
        } catch (err: any) {
          // Ignore abort
          if (err.name !== 'AbortError') throw err;
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      alert('Помилка експорту: Невалідний JSON у редакторі');
    }
  };

  const updateCategoryField = (
    categoryId: number,
    field: 'labelFilterTitle' | 'labelFilterDescription',
    value: string,
  ) => {
    commitFilterCategories(
      filterCategories.map((category) =>
        category.id === categoryId ? { ...category, [field]: value } : category,
      ),
    );
  };

  const updateFilterRuleLabel = (
    categoryId: number,
    ruleId: number,
    value: string,
  ) => {
    commitFilterCategories(
      filterCategories.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              filterRules: category.filterRules.map((rule) =>
                rule.id === ruleId ? { ...rule, labelOption: value } : rule,
              ),
            }
          : category,
      ),
    );
  };

  const updateFilterRuleContainsText = (
    categoryId: number,
    ruleId: number,
    rawValue: string,
  ) => {
    const containsText = rawValue
      .split(',')
      .map((text) => text.trim())
      .filter(Boolean);

    commitFilterCategories(
      filterCategories.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              filterRules: category.filterRules.map((rule) =>
                rule.id === ruleId ? { ...rule, containsText } : rule,
              ),
            }
          : category,
      ),
    );
  };

  const addFilterRule = (categoryId: number) => {
    commitFilterCategories(
      filterCategories.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              filterRules: [
                ...category.filterRules,
                { id: createEntityId(), labelOption: '', containsText: [] },
              ],
            }
          : category,
      ),
    );
  };

  const removeFilterRule = (categoryId: number, ruleId: number) => {
    commitFilterCategories(
      filterCategories.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              filterRules: category.filterRules.filter(
                (rule) => rule.id !== ruleId,
              ),
            }
          : category,
      ),
    );
  };

  const addFilterCategory = () => {
    commitFilterCategories([
      ...filterCategories,
      {
        id: createEntityId(),
        labelFilterTitle: '',
        labelFilterDescription: '',
        // Prefilled with one empty rule so the category isn't blank on
        // creation — user doesn't need an extra click to add the first rule.
        filterRules: [
          { id: createEntityId(), labelOption: '', containsText: [] },
        ],
      },
    ]);
  };

  const removeFilterCategory = (categoryId: number) => {
    commitFilterCategories(
      filterCategories.filter((category) => category.id !== categoryId),
    );
  };

  const toggleCategoryCollapsed = (categoryId: number) => {
    setCollapsedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  return (
    <Modal
      title="Налаштування фільтрів"
      isOpen={isOpen}
      onBtnCloseClick={onClose}
      bodyClassName=""
      footer={
        <>
          <div className="flex space-x-2">
            <button
              type="button"
              onClick={handleImportJson}
              className="px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:outline-none focus:ring-gray-200 focus:text-blue-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700"
            >
              Імпортувати з JSON
            </button>
            <button
              type="button"
              onClick={handleExportJson}
              className="px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:outline-none focus:ring-gray-200 focus:text-blue-700 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700"
            >
              Зберегти в JSON
            </button>
          </div>
          <div>
            <button
              onClick={handleSaveClick}
              type="button"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
            >
              Зберегти
            </button>
          </div>
        </>
      }
    >
      <Tabs>
        <Tabs.Item title="Форма">
          {filterCategories.length === 0 ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Немає жодної категорії фільтрів.
              </p>
              <button
                type="button"
                onClick={addFilterCategory}
                className="flex items-center gap-2 px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
              >
                + Додати категорію
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {filterCategories.map((category) => {
                const isCollapsed = collapsedCategoryIds.has(category.id);

                return (
                  <div
                    key={category.id}
                    className="rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden"
                  >
                    <div className="flex items-end gap-3 bg-gray-50 px-4 py-3 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                      <button
                        type="button"
                        onClick={() => removeFilterCategory(category.id)}
                        className="flex items-center justify-center w-9 h-9 text-red-600 bg-white border border-red-600 hover:bg-red-600 hover:text-white focus:ring-4 focus:ring-red-200 font-medium rounded-lg text-sm dark:bg-gray-800 dark:text-red-500 dark:border-red-500 dark:hover:text-white dark:hover:bg-red-600 dark:focus:ring-red-900 shrink-0 cursor-pointer"
                        title="Видалити категорію"
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
                            d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                          />
                        </svg>
                        <span className="sr-only">Видалити категорію</span>
                      </button>
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label
                            htmlFor={`category-title-${category.id}`}
                            className="block mb-1 text-xs font-medium text-gray-500 dark:text-gray-400"
                          >
                            Назва фільтра
                          </label>
                          <input
                            id={`category-title-${category.id}`}
                            type="text"
                            value={category.labelFilterTitle}
                            onChange={(e) =>
                              updateCategoryField(
                                category.id,
                                'labelFilterTitle',
                                e.target.value,
                              )
                            }
                            placeholder="напр. Тип документа"
                            className="block w-full border bg-white border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-600 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2 text-sm font-semibold"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`category-desc-${category.id}`}
                            className="block mb-1 text-xs font-medium text-gray-500 dark:text-gray-400"
                          >
                            Опис фільтра
                          </label>
                          <input
                            id={`category-desc-${category.id}`}
                            type="text"
                            value={category.labelFilterDescription}
                            onChange={(e) =>
                              updateCategoryField(
                                category.id,
                                'labelFilterDescription',
                                e.target.value,
                              )
                            }
                            placeholder="Короткий опис для користувача"
                            className="block w-full border bg-white border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-600 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2 text-sm"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleCategoryCollapsed(category.id)}
                        className="shrink-0 p-2 rounded-lg text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-600 focus:outline-none cursor-pointer"
                        title={isCollapsed ? 'Розгорнути' : 'Згорнути'}
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
                          ></path>
                        </svg>
                      </button>
                    </div>

                    {!isCollapsed && (
                      <div className="p-4 space-y-3">
                        {category.filterRules.map((rule) => (
                          <div
                            key={rule.id}
                            className="relative rounded-lg border border-gray-200 dark:border-gray-600 p-3"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                removeFilterRule(category.id, rule.id)
                              }
                              className="absolute top-2 right-2 flex items-center justify-center w-8 h-8 text-red-600 bg-white border border-red-600 hover:bg-red-600 hover:text-white focus:ring-4 focus:ring-red-200 font-medium rounded-lg text-sm dark:bg-gray-800 dark:text-red-500 dark:border-red-500 dark:hover:text-white dark:hover:bg-red-600 dark:focus:ring-red-900 cursor-pointer"
                              title="Видалити фільтр"
                            >
                              −
                            </button>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pr-10">
                              <div>
                                <label
                                  htmlFor={`rule-label-${rule.id}`}
                                  className="block mb-1 text-xs font-medium text-gray-500 dark:text-gray-400"
                                >
                                  Назва опції
                                </label>
                                <input
                                  id={`rule-label-${rule.id}`}
                                  type="text"
                                  value={rule.labelOption}
                                  onChange={(e) =>
                                    updateFilterRuleLabel(
                                      category.id,
                                      rule.id,
                                      e.target.value,
                                    )
                                  }
                                  placeholder="напр. Наказ"
                                  className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                                />
                              </div>
                              <div>
                                <label
                                  htmlFor={`rule-contains-${rule.id}`}
                                  className="block mb-1 text-xs font-medium text-gray-500 dark:text-gray-400"
                                >
                                  Ключові слова (через кому)
                                </label>
                                <input
                                  id={`rule-contains-${rule.id}`}
                                  key={`${rule.id}:${rule.containsText.join('|')}`}
                                  type="text"
                                  defaultValue={rule.containsText.join(', ')}
                                  onBlur={(e) =>
                                    updateFilterRuleContainsText(
                                      category.id,
                                      rule.id,
                                      e.target.value,
                                    )
                                  }
                                  placeholder="слово1, слово2"
                                  className="block w-full border disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500 rounded-lg p-2.5 text-sm"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                        <div className="flex justify-end pr-2">
                          <button
                            type="button"
                            onClick={() => addFilterRule(category.id)}
                            className="flex items-center justify-center w-8 h-8 text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800 cursor-pointer"
                            title="Додати фільтр"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={addFilterCategory}
                className="flex items-center gap-2 px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
              >
                + Додати категорію
              </button>
            </div>
          )}
        </Tabs.Item>
        <Tabs.Item title="JSON">
          <label
            htmlFor="filterConfigJson"
            className="block text-sm font-medium text-gray-900 dark:text-white"
          >
            Конфігурація JSON
          </label>
          <textarea
            id="filterConfigJson"
            value={configJson}
            onChange={(e) => setConfigJson(e.target.value)}
            onBlur={handleConfigJsonBlur}
            className="block p-2.5 w-full h-96 text-xs font-mono text-gray-900 bg-gray-50 rounded-lg border border-gray-300 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 resize-y"
            placeholder="[]"
          ></textarea>
        </Tabs.Item>
      </Tabs>
    </Modal>
  );
};

export { FPDModalFilterSettings };
