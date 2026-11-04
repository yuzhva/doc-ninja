import React from 'react';

import type { DocRegexConfig } from './doc-regex-parser.types';

const DOC_REGEX_CONFIGS_STORAGE_KEY = 'docNinja_docRegexParserConfigs';
const DOC_REGEX_SELECTED_CONFIG_STORAGE_KEY =
  'docNinja_docRegexParserSelectedConfig';

// --- Configs (localStorage) ---

/**
 * No bundled default: every document type is different, so the user creates
 * (or imports) a config before the first run.
 * Shape problems inside an entry aren't fixed here; the tab validates the
 * selected config before running it and the editor shows every issue.
 */
const readStoredDocRegexConfigs = (): DocRegexConfig[] => {
  try {
    const saved = localStorage.getItem(DOC_REGEX_CONFIGS_STORAGE_KEY);
    if (saved === null) return [];

    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    console.warn('Failed to load document parser configs from storage', e);
  }

  return [];
};

const writeStoredDocRegexConfigs = (configs: DocRegexConfig[]) => {
  localStorage.setItem(DOC_REGEX_CONFIGS_STORAGE_KEY, JSON.stringify(configs));
};

const readSelectedDocRegexConfigName = (): string | null => {
  try {
    return localStorage.getItem(DOC_REGEX_SELECTED_CONFIG_STORAGE_KEY);
  } catch {
    return null;
  }
};

const writeSelectedDocRegexConfigName = (name: string) => {
  try {
    localStorage.setItem(DOC_REGEX_SELECTED_CONFIG_STORAGE_KEY, name);
  } catch (e) {
    console.warn('Failed to remember the selected document parser config', e);
  }
};

/**
 * A per-browser view preference (e.g. "show the source file column"),
 * remembered across visits. Not part of a config: it's about how this
 * person likes to look at results, not about how documents are parsed.
 */
const usePersistedFlag = (storageKey: string, defaultValue: boolean) => {
  const [value, setValue] = React.useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved === null ? defaultValue : saved === 'true';
    } catch {
      return defaultValue;
    }
  });

  const update = React.useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {
        // A view preference that isn't remembered is no reason to fail.
      }
    },
    [storageKey],
  );

  return [value, update] as const;
};

// --- Extracted texts (memory only) ---

// One file of the picked folder, as read by the backend. Kept only in
// memory — writing .txt files next to the user's documents is exactly what
// this tool is meant to avoid.
interface DocRegexSourceDocument {
  // Relative to the picked folder, e.g. "/2026/contract.docx".
  path: string;
  name: string;
  text: string | null;
  error: string | null;
}

interface DocRegexSessionState {
  // The folder pick (useDirectoryPicker's result object) these texts were
  // read for. Compared by identity, not by path: a browser-mode pick only
  // knows the folder's name, so two different folders can share a path —
  // and even re-picking the very same folder means "read it as it is now",
  // never "show what it was the last time".
  source: object | null;
  documents: DocRegexSourceDocument[];
}

// Module level rather than component state: Tabs unmounts the tabs that
// aren't shown, and a folder can take minutes to read — switching to another
// tool and back must not throw that away. It only ever holds the latest
// run; nothing from it is reused by the next one.
let sessionState: DocRegexSessionState = { source: null, documents: [] };
const sessionListeners = new Set<() => void>();

const docRegexSessionStore = {
  getState: () => sessionState,
  setState: (next: DocRegexSessionState) => {
    sessionState = next;
    sessionListeners.forEach((listener) => listener());
  },
  subscribe: (listener: () => void) => {
    sessionListeners.add(listener);
    return () => {
      sessionListeners.delete(listener);
    };
  },
};

const useDocRegexSession = () =>
  React.useSyncExternalStore(
    docRegexSessionStore.subscribe,
    docRegexSessionStore.getState,
    docRegexSessionStore.getState,
  );

export {
  docRegexSessionStore,
  readSelectedDocRegexConfigName,
  readStoredDocRegexConfigs,
  useDocRegexSession,
  usePersistedFlag,
  writeSelectedDocRegexConfigName,
  writeStoredDocRegexConfigs,
};
export type { DocRegexSessionState, DocRegexSourceDocument };
