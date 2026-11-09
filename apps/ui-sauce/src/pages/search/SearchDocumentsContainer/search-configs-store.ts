import React from 'react';

import type { FilterConfig } from './SearchResults/frontend-information-extractor';

/**
 * The parser configs and the results filters, as saved in their settings
 * modals. Several parts of the page read them — each folder's parser picker,
 * the search request, the results' columns, filters and export — and each
 * reads them live from here: a save shows everywhere at once, with nothing
 * to re-read by hand.
 *
 * Only the settings modals write them, and only through `save`.
 */

const PARSER_CONFIGS_STORAGE_KEY = 'docNinja_parserConfigs';
const FILTER_CONFIGS_STORAGE_KEY = 'docNinja_filterConfig';

/** The JSON saved under `storageKey`; null when there is none or it's broken. */
const readStoredJson = (storageKey: string): unknown => {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    console.warn(`Failed to load ${storageKey} from storage`, e);
    return null;
  }
};

// What a server render shows — nothing is saved there. One array, always the
// same, as useSyncExternalStore needs of a snapshot that hasn't changed.
const NOTHING_SAVED: never[] = [];
const getNothingSaved = () => NOTHING_SAVED;

/**
 * A list saved in localStorage, read once on first use and replaced as a
 * whole on each save. `toList` turns what was saved into what is read.
 */
function createStoredList<T>(
  storageKey: string,
  toList: (saved: unknown[]) => T[],
) {
  let list: T[] | null = null;
  const listeners = new Set<() => void>();

  const toListFrom = (saved: unknown) =>
    toList(Array.isArray(saved) ? saved : []);

  const get = (): T[] => {
    if (list === null) list = toListFrom(readStoredJson(storageKey));
    return list;
  };

  /** Saves what a settings modal holds; throws when storage refuses it. */
  const save = (saved: unknown) => {
    localStorage.setItem(storageKey, JSON.stringify(saved));
    list = toListFrom(saved);
    listeners.forEach((listener) => listener());
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  /** The list, re-rendering the component whenever it's saved anew. */
  const useList = (): T[] =>
    React.useSyncExternalStore(subscribe, get, getNothingSaved);

  return { get, save, subscribe, useList };
}

// Entries are passed through as saved: the parser config modal validates
// them, and the backend parses with them.
const parserConfigsStore = createStoredList<any>(
  PARSER_CONFIGS_STORAGE_KEY,
  (saved) => saved,
);

// Every filter needs an id — it keys the filter's state, column and sort —
// but the modal saves none: one is made up from the title and position.
const filterConfigsStore = createStoredList<FilterConfig>(
  FILTER_CONFIGS_STORAGE_KEY,
  (saved) =>
    saved.map((config: any, index) => ({
      ...config,
      id: config?.id || `${config?.labelFilterTitle}-${index}`,
    })),
);

const useParserConfigs = parserConfigsStore.useList;
const useFilterConfigs = filterConfigsStore.useList;

/**
 * The filters exactly as saved — without the ids made up for them — for the
 * filter settings modal to edit.
 */
const readSavedFilterConfigs = (): unknown =>
  readStoredJson(FILTER_CONFIGS_STORAGE_KEY) ?? [];

export {
  filterConfigsStore,
  parserConfigsStore,
  readSavedFilterConfigs,
  useFilterConfigs,
  useParserConfigs,
};
