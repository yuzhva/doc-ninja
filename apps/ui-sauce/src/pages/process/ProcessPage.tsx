import React from 'react';

import { LoadingSpinner, Tabs, Toast } from '../../components';
import type { ToastMessage } from '../../components';
import { useBatchProcessor } from '../../hooks/use-batch-processor';
import type { BatchFileProcessingSectionProps } from '../../hooks/use-batch-processor';
import { useDirectoryPicker, useFilePicker } from '../../hooks/use-file-system';
import { FormChunkSpreadsheetTabItem } from './FormChunkSpreadsheetTabItem';
import { FormConvertDocToTextTabItem } from './FormConvertDocToTextTabItem';
import { FormConvertSpreadsheetToStatic } from './FormConvertSpreadsheetToStatic';

const ProcessPage = () => {
  // --- Toast Management ---
  const [toasts, setToasts] = React.useState<ToastMessage[]>([]);
  const addToast = React.useCallback(
    (type: 'success' | 'error' | 'warning', content: string) => {
      const id = Date.now();
      setToasts((prev) => [...prev, { id, type, content }]);
    },
    [],
  );
  const removeToast = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // --- File System Hooks ---
  const sourceDir = useDirectoryPicker({ mode: 'read' });
  const outputDir = useDirectoryPicker({ mode: 'readwrite' });

  const filePicker = useFilePicker({
    types: [
      {
        description: 'Excel files',
        accept: {
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
            '.xlsx',
          ],
          'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm', '.xlsb'],
          'application/vnd.ms-excel': ['.xls'],
        },
      },
    ],
  });

  // --- Batch Processor Hook ---
  const { execute, isProcessing, progress } = useBatchProcessor(addToast);

  const initSubmitHandler = React.useCallback(
    (
      apiCallFunction: Parameters<
        BatchFileProcessingSectionProps['initSubmitHandler']
      >[0],
    ) => {
      return (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const formDataJSON = { ...Object.fromEntries(formData || {}) };
        return apiCallFunction(formDataJSON);
      };
    },
    [],
  );

  React.useEffect(() => {
    if (Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  }, []);

  return (
    <div>
      {/* Toast Container */}
      <div className="fixed bottom-12 right-5 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <Toast key={t.id} {...t} onClose={removeToast} />
        ))}
      </div>

      {!sourceDir.isSupported && (
        <div className="mb-4 p-3 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded">
          ⚠️ File System Access API не підтримується. Використовуйте Chrome 86+
          або Edge 86+.
        </div>
      )}

      <Tabs aria-label="Tabs with icons">
        <Tabs.Item title="Конвертувати .xlsx в cтатику">
          <FormConvertSpreadsheetToStatic
            onSelectFile={filePicker.selectFile}
            onSelectSourceDirectory={sourceDir.selectDirectory}
            onSelectOutputDirectory={outputDir.selectDirectory}
            executeBatch={execute}
            initSubmitHandler={initSubmitHandler}
            sourceDirectory={sourceDir.processedDir}
            outputDirectory={outputDir.processedDir}
            selectedFile={filePicker.processedDir}
            progress={progress}
            isFileSystemAccessSupported={sourceDir.isSupported}
            isProcessing={isProcessing}
          />
        </Tabs.Item>
        <Tabs.Item title="Нарізка таблиці">
          <FormChunkSpreadsheetTabItem
            onSelectFile={filePicker.selectFile}
            onSelectSourceDirectory={sourceDir.selectDirectory}
            onSelectOutputDirectory={outputDir.selectDirectory}
            executeBatch={execute}
            initSubmitHandler={initSubmitHandler}
            sourceDirectory={sourceDir.processedDir}
            outputDirectory={outputDir.processedDir}
            selectedFile={filePicker.processedDir}
            progress={progress}
            isFileSystemAccessSupported={sourceDir.isSupported}
            isProcessing={isProcessing}
          />
        </Tabs.Item>
        <Tabs.Item title="Конвертувати Документи в Текст" isBetaFeature>
          <FormConvertDocToTextTabItem
            onSelectFile={filePicker.selectFile}
            onSelectSourceDirectory={sourceDir.selectDirectory}
            onSelectOutputDirectory={outputDir.selectDirectory}
            executeBatch={execute}
            initSubmitHandler={initSubmitHandler}
            sourceDirectory={sourceDir.processedDir}
            outputDirectory={outputDir.processedDir}
            selectedFile={filePicker.processedDir}
            progress={progress}
            isFileSystemAccessSupported={sourceDir.isSupported}
            isProcessing={isProcessing}
          />
        </Tabs.Item>
      </Tabs>

      {/* Progress footer — always mounted so the slide transition can play;
          hidden below the viewport via translate-y-full when idle. */}
      <div
        className={`fixed inset-x-0 bottom-0 z-40 transform transition-transform duration-300 ease-in-out ${
          isProcessing ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="py-3 px-4 bg-yellow-300 border-t border-yellow-400 text-gray-900 shadow-[0_-2px_10px_rgba(0,0,0,0.1)] dark:bg-yellow-200 dark:border-yellow-300">
          <div className="flex items-center justify-start text-sm font-semibold">
            <LoadingSpinner className="text-gray-900" />
            📊 Processing batch {progress.batch}... ({progress.current}/
            {progress.total} files)
          </div>
        </div>
      </div>
    </div>
  );
};

export { ProcessPage };
