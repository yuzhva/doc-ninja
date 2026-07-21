import React from 'react';

import { Modal } from '../../../../components';
import { FileSystemBridge } from '../../../../utils/file-system-bridge';

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

  React.useEffect(() => {
    if (isOpen) {
      try {
        const saved = localStorage.getItem('docNinja_filterConfig');
        if (saved) {
          // Format it nicely just in case
          setConfigJson(JSON.stringify(JSON.parse(saved), null, 2));
        } else {
          setConfigJson('[]');
        }
      } catch (e) {
        // Fallback if local storage is corrupted
        setConfigJson('[]');
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

  return (
    <Modal
      title="Налаштування фільтрів"
      isOpen={isOpen}
      onBtnCloseClick={onClose}
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
        className="block p-2.5 w-full h-96 text-xs font-mono text-gray-900 bg-gray-50 rounded-lg border border-gray-300 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 resize-y"
        placeholder="[]"
      ></textarea>
    </Modal>
  );
};

export { FPDModalFilterSettings };
