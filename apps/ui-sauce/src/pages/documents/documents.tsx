import React from 'react';

import { Tabs } from '../../components';
import { fetchRequest } from '../../utils';

const DocumentsPage = () => {
  const postConvertDocToText = React.useCallback(() => {
    fetchRequest('/api-local/convert/doc-to-text', {
      method: 'POST',
    }).then((resAsJson) => {
      console.log({ resAsJson });
    });
  }, []);

  const postConvertTextToIndex = React.useCallback(() => {
    fetchRequest('/api-local/convert/text-to-index', {
      method: 'POST',
    }).then((resAsJson) => {
      console.log({ resAsJson });
    });
  }, []);

  const postProcessDocuments = React.useCallback(() => {
    fetchRequest('/api-local/process/documents', {
      method: 'POST',
    }).then((resAsJson) => {
      console.log({ resAsJson });
    });
  }, []);

  const handleSubmit = React.useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);

      const data = {
        sourceFolder: formData.get('sourceFolder')!,
        destinationFolder: formData.get('destinationFolder')!,
      };

      const submitterValue = (
        (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement
      ).value;

      console.log({ data });

      // return (
      //   submitterValue === SUBMIT_EVENT_ID.LOGIN
      //     ? dispatch(postAuthLogin({ data })).catch(() => {
      //         setIsUnregistered(true);
      //       })
      //     : dispatch(postUserRegister({ data }))
      // ).then(() => {
      //   navigate('/portal');
      // });
    },
    [],
  );

  return (
    <Tabs aria-label="Tabs with icons" variant="underline">
      <Tabs.Item title="Пошук збігів в документах">
        <form className="max-w-sm mx-auto" onSubmit={handleSubmit}>
          <div className="mb-5">
            <label
              className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
              htmlFor="processDocumentsInputFile"
            >
              Файл з вхідними данними
            </label>
            <input
              className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 dark:text-gray-400 focus:outline-none dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400"
              id="processDocumentsInputFile"
              name="inputFile"
              type="file"
              webkitdirectory=""
              directory=""
            />
            {/*
            <div
              className="mt-1 text-sm text-gray-500 dark:text-gray-300"
              id="user_avatar_help"
            >
              Опис
            </div>
            */}
          </div>
          <button
            type="submit"
            className="cursor-pointer text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
            onClick={postProcessDocuments}
          >
            Почати пошук збігів
          </button>
        </form>
      </Tabs.Item>
      <Tabs.Item title="Конвертувати Документи в Текст">
        <form className="max-w-sm mx-auto" onSubmit={handleSubmit}>
          <div className="mb-5">
            <label
              className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
              htmlFor="docToTextSourceFolder"
            >
              Початкова папка з документами
            </label>
            <input
              className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 dark:text-gray-400 focus:outline-none dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400"
              id="docToTextSourceFolder"
              name="sourceFolder"
              type="file"
              webkitdirectory=""
              directory=""
            />
            {/*
            <div
              className="mt-1 text-sm text-gray-500 dark:text-gray-300"
              id="user_avatar_help"
            >
              Опис
            </div>
            */}
          </div>
          <div className="mb-5">
            <label
              className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
              htmlFor="docToTextDestinationFolder"
            >
              Кінцева папка для збереження текстових файлів
            </label>
            <input
              className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 dark:text-gray-400 focus:outline-none dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400"
              id="docToTextDestinationFolder"
              name="destinationFolder"
              type="file"
              webkitdirectory=""
              directory=""
            />
            {/*
            <div
              className="mt-1 text-sm text-gray-500 dark:text-gray-300"
              id="user_avatar_help"
            >
              Опис
            </div>
            */}
          </div>
          <button
            type="submit"
            className="cursor-pointer text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
            onClick={postConvertDocToText}
          >
            Конвертувати Документи в Текст
          </button>
        </form>
      </Tabs.Item>
      <Tabs.Item title="Проіндексувати текстові файли">
        <form className="max-w-sm mx-auto" onSubmit={handleSubmit}>
          <div className="mb-5">
            <label
              className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
              htmlFor="textToIndexSourceFolder"
            >
              Початкова папка з текстовими файлами
            </label>
            <input
              className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 dark:text-gray-400 focus:outline-none dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400"
              id="textToIndexSourceFolder"
              name="sourceFolder"
              type="file"
              webkitdirectory=""
              directory=""
            />
            {/*
            <div
              className="mt-1 text-sm text-gray-500 dark:text-gray-300"
              id="user_avatar_help"
            >
              Опис
            </div>
            */}
          </div>
          <div className="mb-5">
            <label
              className="block mb-2 text-sm font-medium text-gray-900 dark:text-white"
              htmlFor="textToIndexDestinationFolder"
            >
              Кінцева папка для збереження індексований документів
            </label>
            <input
              className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 dark:text-gray-400 focus:outline-none dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400"
              id="textToIndexDestinationFolder"
              name="destinationFolder"
              type="file"
              webkitdirectory=""
              directory=""
            />
            {/*
            <div
              className="mt-1 text-sm text-gray-500 dark:text-gray-300"
              id="user_avatar_help"
            >
              Опис
            </div>
            */}
          </div>
          <button
            type="submit"
            className="cursor-pointer text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
            onClick={postConvertTextToIndex}
          >
            Конвертувати Текст в Індекси
          </button>
        </form>
      </Tabs.Item>
    </Tabs>
  );
};

export { DocumentsPage };
