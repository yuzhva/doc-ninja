import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { DocxTemplateEngine } from '../../../../utils/docx-template-engine';
import type { DocmGeneratePayload } from './components/DocmTemplatesPanel';

const I18N_NS = 'page.search.container.searchResults';

type AddToast = (
  type: 'success' | 'error' | 'warning',
  content: React.ReactNode,
) => void;

/**
 * Makes the documents a .docm menu asks for, writes them into the folder
 * picked for them, and says how that went — with a link to the folder in
 * the desktop app.
 */
const useDocmGeneration = (addToast: AddToast) => {
  const { t } = useTranslation();

  const openOutputFolder = async (folderPath: string) => {
    try {
      // Resolves to an error message, or '' once the folder is open.
      const errorMessage = await window.electronAPI?.openPath(folderPath);
      if (errorMessage) {
        addToast(
          'error',
          t(`${I18N_NS}.openFolderFailedToast`, { message: errorMessage }),
        );
      }
    } catch (error: any) {
      console.error('Failed to open output folder', error);
      addToast(
        'error',
        t(`${I18N_NS}.openFolderFailedToast`, {
          message: error.message || error,
        }),
      );
    }
  };

  const generateDocm = async (payload: DocmGeneratePayload) => {
    try {
      const result = await DocxTemplateEngine.generateBatch({
        template: {
          file: payload.templateFile,
          fileName: payload.templateName,
        },
        jobs: payload.jobs,
        layout: payload.layout,
      });

      for (const file of result.files) {
        const fileHandle = await payload.outputDirectoryHandle.getFileHandle(
          file.fileName,
          { create: true },
        );
        const writable = await fileHandle.createWritable();
        await writable.write(file.blob);
        await writable.close();
      }

      // Desktop app only: a browser can't open a folder on the computer, and
      // even Electron only knows where this one is because its main process
      // noted the path when write access was granted — the handle itself
      // carries none. A lookup that fails just leaves the link out.
      const outputFolderName = payload.outputDirectoryHandle.name;
      const outputFolderPath = await window.electronAPI
        ?.getWritableDirectoryPath(outputFolderName)
        .catch(() => null);

      addToast(
        'success',
        <>
          {t(`${I18N_NS}.generateSuccessToast`, {
            count: result.files.length,
          })}
          {outputFolderPath && (
            <p className="mt-2">
              <Trans
                i18nKey={`${I18N_NS}.openOutputFolderMessage`}
                values={{ name: outputFolderName }}
                // Not `link`: Trans parses the translation as HTML, where
                // <link> is a void element — it would come out as an empty
                // button with "open folder" as plain text beside it.
                components={{
                  action: (
                    <button
                      type="button"
                      onClick={() => openOutputFolder(outputFolderPath)}
                      className="text-blue-600 underline dark:text-blue-400 cursor-pointer"
                    />
                  ),
                  bold: <span className="font-semibold" />,
                }}
              />
            </p>
          )}
        </>,
      );
    } catch (error: any) {
      console.error('Failed to generate .doc* files', error);
      addToast(
        'error',
        t(`${I18N_NS}.generateFailedToast`, {
          message: error.message || error,
        }),
      );
    }
  };

  return generateDocm;
};

export { useDocmGeneration };
