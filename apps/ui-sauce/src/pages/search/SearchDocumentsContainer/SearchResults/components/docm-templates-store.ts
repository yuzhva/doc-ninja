import { useSyncExternalStore } from 'react';

import type { UseDirectoryPicker } from '../../../../../hooks/use-file-system';
import { FileSystemBridge } from '../../../../../utils/file-system-bridge';
import {
  listStoredTemplates,
  removeStoredTemplate,
  saveStoredTemplate,
} from '../../../../../utils/template-store';
import type { StoredTemplateRecord } from '../../../../../utils/template-store';

// Thrown instead of a plain Error so the UI layer (which owns translation
// and toast display) can recognize this specific case and render its own
// localized message from `templateName`, rather than the store baking in
// user-facing text — see FPDDocmTemplatesDropdown's catch of getFileContent.
class TemplatePermissionDeniedError extends Error {
  constructor(readonly templateName: string) {
    super(`Access denied to template file "${templateName}"`);
    this.name = 'TemplatePermissionDeniedError';
  }
}

interface TemplateContentResult {
  blob: Blob;
  // True when the live file was unreachable (deleted/moved) and this is the
  // last cached copy instead — callers use this to decide whether to warn
  // the user, keeping that (translated, UI-owned) decision out of the store.
  usedCachedFallback: boolean;
}

interface DocmTemplate {
  id: string;
  name: string;
  // Dedup key — see StoredTemplateRecord.path.
  path: string;
  getFileContent: () => Promise<TemplateContentResult>;
}

// FileSystemFileHandle.getFile() throws this DOMException when the
// underlying file has been moved/deleted — as opposed to e.g. a denied
// permission, which is recoverable without forgetting the template.
const isFileNotFoundError = (error: any): boolean =>
  error?.name === 'NotFoundError';

const readLiveTemplateContent = async (
  record: StoredTemplateRecord,
): Promise<Blob> => {
  try {
    return await FileSystemBridge.readStoredFile(record.browserFileHandle);
  } catch (error: any) {
    if (error?.name === 'NotAllowedError') {
      throw new TemplatePermissionDeniedError(record.name);
    }
    throw error;
  }
};

// Rehydrates a remembered template into the same shape a fresh pick produces
// — reads happen lazily (on generate), always preferring whatever is
// currently on disk (with a permission re-check for browser-handle-backed
// templates), refreshing the cached fallback copy on every success. Only
// falls back to that cached copy when the live source is genuinely gone —
// a denied permission still throws, since silently serving a cached copy
// there would mask a fixable problem instead of surfacing it.
const buildTemplateFromStoredRecord = (
  record: StoredTemplateRecord,
): DocmTemplate => {
  // Tracked separately from record.cachedContent: a successful read persists
  // the fresh copy to IndexedDB but never mutates `record` itself, so a
  // template that started with no cached copy (any freshly-added one, once
  // addTemplate warms it below) would otherwise never see a fallback become
  // available later in the *same* session — only after a future reload
  // re-hydrates it from storage. This local variable is what actually makes
  // "cache it on add, fall back to it if renamed later this session" work.
  let cachedContent = record.cachedContent;

  return {
    id: record.id,
    name: record.name,
    path: record.path,
    getFileContent: async () => {
      try {
        const liveBlob = await readLiveTemplateContent(record);
        // A File from FileSystemFileHandle.getFile() isn't necessarily fully
        // buffered yet — Chromium can resolve its bytes lazily on first
        // .arrayBuffer()/.slice() read, rather than at getFile() time. Left
        // as-is, "caching" it here would be pointless: the whole point of
        // cachedContent is to survive the source file later being renamed
        // or deleted, but a lazy File would only fail at that point anyway,
        // just deferred to whenever DocxTemplateEngine actually reads it
        // instead of failing here — same bug, a few frames later. Copying
        // the bytes into a plain Blob right now forces real, disk-
        // independent buffering while the file still definitely exists.
        const materializedBlob = new Blob([await liveBlob.arrayBuffer()], {
          type: liveBlob.type,
        });
        cachedContent = materializedBlob;
        saveStoredTemplate({
          ...record,
          cachedContent: materializedBlob,
        }).catch((error) => {
          console.warn('Failed to refresh cached docm template', error);
        });
        return { blob: materializedBlob, usedCachedFallback: false };
      } catch (error: any) {
        if (isFileNotFoundError(error) && cachedContent) {
          return { blob: cachedContent, usedCachedFallback: true };
        }
        throw error;
      }
    },
  };
};

const LAST_SELECTED_TEMPLATE_ID_STORAGE_KEY =
  'docNinja_lastSelectedDocmTemplateId';

// A single in-memory list shared by every FPDDocmTemplatesDropdown instance
// on the page (one per results row, plus the toolbar one) — adding or
// removing a template in one place must show up in all the others
// immediately, not just after that instance happens to remount. Backed by
// IndexedDB (see template-store.ts) for persistence across sessions; this
// module is just the live, subscribable view of it — via useSyncExternalStore
// (see the useDocmTemplates hook) so every subscriber re-renders on change.
let templates: DocmTemplate[] = [];
// Which template is "the" selected one, and which ones failed to read on a
// previous generate attempt — also shared, not per-dropdown-instance: there
// is exactly one set of templates to choose from (same schema/fields
// everywhere they're rendered), so two dropdowns disagreeing about which is
// selected, or one showing a template as broken while another doesn't, would
// just be confusing rather than meaningfully different UI states.
let selectedTemplateId: string | null = null;
let unavailableTemplateIds: Set<string> = new Set();
// The output folder generated files get written into — shared for the same
// reason: "pick the folder once, reuse it for the rest of this session"
// (see FPDDocmTemplatesDropdown's handleGenerateClick) only actually holds
// if every dropdown instance shares the same picked folder, not just
// whichever one happened to prompt for it first. Deliberately NOT persisted
// to IndexedDB/localStorage — a FileSystemDirectoryHandle here is only ever
// meant to last "this session", unlike a template, which is meant to survive
// a reload.
type SharedOutputDirectory = NonNullable<UseDirectoryPicker['processedDir']>;
let outputDirectory: SharedOutputDirectory | null = null;
let hasStartedLoad = false;
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const listener of listeners) listener();
};

const persistSelectedTemplateId = (id: string | null): void => {
  try {
    if (id) {
      localStorage.setItem(LAST_SELECTED_TEMPLATE_ID_STORAGE_KEY, id);
    } else {
      localStorage.removeItem(LAST_SELECTED_TEMPLATE_ID_STORAGE_KEY);
    }
  } catch (error) {
    console.warn('Failed to persist selected docm template', error);
  }
};

const ensureLoaded = (): void => {
  if (hasStartedLoad) return;
  hasStartedLoad = true;

  listStoredTemplates()
    .then((records) => {
      if (records.length === 0) return;
      templates = records.map(buildTemplateFromStoredRecord);

      let lastSelectedId: string | null = null;
      try {
        lastSelectedId = localStorage.getItem(
          LAST_SELECTED_TEMPLATE_ID_STORAGE_KEY,
        );
      } catch (error) {
        console.warn('Failed to read persisted selected docm template', error);
      }
      if (lastSelectedId && templates.some((t) => t.id === lastSelectedId)) {
        selectedTemplateId = lastSelectedId;
      }

      notify();
    })
    .catch((error) => {
      console.warn('Failed to load persisted docm templates', error);
    });
};

const subscribe = (listener: () => void): (() => void) => {
  ensureLoaded();
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): DocmTemplate[] => templates;
const getSelectedTemplateId = (): string | null => selectedTemplateId;
const getUnavailableTemplateIds = (): Set<string> => unavailableTemplateIds;
const getOutputDirectory = (): SharedOutputDirectory | null => outputDirectory;

// The server never has IndexedDB/localStorage/filesystem access, so it
// always renders with no templates, no selection, nothing flagged
// unavailable, and no output folder picked — each getServerX below always
// returns the exact same reference (never a fresh [] / new Set() / value
// computed at call time), which useSyncExternalStore requires for the
// server snapshot to compare equal across renders.
// Same <T, _> trick as template-store.ts's withStore — a lone trailing
// comma (<T,>) stops Babel's JSX-aware parser from reading <T> as a JSX tag
// opening, but Prettier strips a bare trailing comma back out on every save
// since .ts files "can't have JSX" as far as it's concerned. A second,
// unused type param doesn't get stripped the same way, so it actually
// survives formatting. Defaulted so callers below can still explicitly
// supply just T, the same way they would if this were the single-param
// <T,> form.
const constant =
  <T, _ = unknown>(value: T) =>
  (): T =>
    value;

const getServerSnapshot = constant<DocmTemplate[]>([]);
const getServerSelectedTemplateId = constant<string | null>(null);
const getServerUnavailableTemplateIds = constant<Set<string>>(new Set());
const getServerOutputDirectory = constant<SharedOutputDirectory | null>(null);

// Adds a freshly-picked template to the shared list immediately (so every
// subscribed dropdown sees it right away). Built through
// buildTemplateFromStoredRecord — same as a rehydrated-from-storage
// template — so a freshly-added template gets the exact same
// falls-back-to-cachedContent behavior if the source file later disappears
// or gets renamed, instead of a raw read with no safety net. The first
// getFileContent() call (warming the cache here) also persists the initial
// cachedContent as a side effect of a successful read — see
// buildTemplateFromStoredRecord.
const addTemplate = (
  record: Omit<StoredTemplateRecord, 'cachedContent'>,
): DocmTemplate => {
  const template = buildTemplateFromStoredRecord(record);
  templates = [...templates, template];
  notify();

  template.getFileContent().catch((error) => {
    console.warn('Failed to persist docm template', error);
  });

  return template;
};

const removeTemplate = (id: string): void => {
  templates = templates.filter((t) => t.id !== id);

  // Drop a stale selection/unavailable-flag pointing at a template that no
  // longer exists — whichever dropdown instance the removal was clicked
  // from, every subscriber shares this same state, so there's nothing
  // instance-specific left to reconcile.
  if (selectedTemplateId === id) {
    selectedTemplateId = null;
    persistSelectedTemplateId(null);
  }
  if (unavailableTemplateIds.has(id)) {
    const next = new Set(unavailableTemplateIds);
    next.delete(id);
    unavailableTemplateIds = next;
  }

  notify();

  removeStoredTemplate(id).catch((error) => {
    console.warn('Failed to remove persisted docm template', error);
  });
};

const selectTemplate = (id: string | null): void => {
  selectedTemplateId = id;
  persistSelectedTemplateId(id);
  notify();
};

// Templates that failed to read on a previous generate attempt — kept in the
// list (not deleted) since the file might come back (reconnected drive,
// permission re-granted, etc.); just flagged so the user knows why. Always
// replaces the Set (never mutates in place) so useSyncExternalStore's
// reference-equality check actually sees the change.
const markTemplateUnavailable = (id: string, isUnavailable: boolean): void => {
  const isAlreadyFlagged = unavailableTemplateIds.has(id);
  if (isUnavailable === isAlreadyFlagged) return;

  const next = new Set(unavailableTemplateIds);
  if (isUnavailable) {
    next.add(id);
  } else {
    next.delete(id);
  }
  unavailableTemplateIds = next;
  notify();
};

// Called after a successful pick (or with null to forget a folder that
// turned out to be unwritable) — the actual picker call itself still goes
// through each dropdown instance's own useDirectoryPicker, which owns the
// pick/error mechanics; only the *result* is shared from here on.
const setOutputDirectory = (dir: SharedOutputDirectory | null): void => {
  outputDirectory = dir;
  notify();
};

const DocmTemplatesStore = {
  subscribe,
  getSnapshot,
  getServerSnapshot,
  addTemplate,
  removeTemplate,
  selectTemplate,
  markTemplateUnavailable,
  setOutputDirectory,
};

// The hooks every FPDDocmTemplatesDropdown instance reads through —
// subscribing here is what makes an add/remove/select/unavailable-flag in
// one instance show up in all the others immediately.
const useDocmTemplates = (): DocmTemplate[] =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

const useSelectedDocmTemplateId = (): string | null =>
  useSyncExternalStore(
    subscribe,
    getSelectedTemplateId,
    getServerSelectedTemplateId,
  );

const useUnavailableDocmTemplateIds = (): Set<string> =>
  useSyncExternalStore(
    subscribe,
    getUnavailableTemplateIds,
    getServerUnavailableTemplateIds,
  );

const useSharedOutputDirectory = (): SharedOutputDirectory | null =>
  useSyncExternalStore(subscribe, getOutputDirectory, getServerOutputDirectory);

export {
  DocmTemplatesStore,
  isFileNotFoundError,
  TemplatePermissionDeniedError,
  useDocmTemplates,
  useSelectedDocmTemplateId,
  useUnavailableDocmTemplateIds,
  useSharedOutputDirectory,
};
export type { DocmTemplate, SharedOutputDirectory, TemplateContentResult };
