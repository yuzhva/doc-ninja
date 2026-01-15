import React from 'react';

import { fetchRequest } from '../../../utils';

// Helper to highlight text inside the large file content
// Optimized version that supports multiple phrases
export const HighlightedText = React.memo(
  ({ text, highlights = [] }: { text: string; highlights?: string[] }) => {
    if (!text) return null;

    const validHighlights = highlights?.filter(Boolean) || [];
    if (validHighlights.length === 0) return <>{text}</>;

    // Sort by length desc, Escape regex, Join
    const pattern = Array.from(new Set(validHighlights))
      .sort((a, b) => b.length - a.length)
      .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');

    if (!pattern) return <>{text}</>;

    const parts = text.split(new RegExp(`(${pattern})`, 'gi'));

    return (
      <>
        {parts.map((part, i) =>
          // Check if part matches pattern (case insensitive)
          // Using a simple regex test on the part to confirm it's a highlight
          new RegExp(`^(${pattern})$`, 'i').test(part) ? (
            <span
              key={i}
              className="bg-yellow-300 text-red-600 dark:bg-yellow-200 dark:text-red-500 font-semibold"
              data-highlight="true"
            >
              {part}
            </span>
          ) : (
            part
          ),
        )}
      </>
    );
  },
);

interface FormProcessDocumentSideOverProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  textFilePath?: string;
  highlightPhrases?: string[]; // Changed from highlightPhrase to highlightPhrases
  children: React.ReactNode;
}

const FormProcessDocumentSideOver = ({
  isOpen,
  onClose,
  title,
  textFilePath,
  highlightPhrases,
  children,
}: FormProcessDocumentSideOverProps) => {
  const contentRef = React.useRef<HTMLDivElement>(null);
  const highlightsRef = React.useRef<HTMLElement[]>([]);
  const [highlightCount, setHighlightCount] = React.useState(0);
  const [currentIndex, setCurrentIndex] = React.useState(0);

  // State for file fetching
  const [fileContent, setFileContent] = React.useState<string | null>(null);
  const [loadingFile, setLoadingFile] = React.useState(false);
  const [fileError, setFileError] = React.useState<string | null>(null);

  // Fetch file content when textFilePath changes
  React.useEffect(() => {
    // We rely on fetchRequest to handle transport check appropriately
    if (!isOpen || !textFilePath) {
      if (!isOpen) {
        setFileContent(null);
        setFileError(null);
      }
      return;
    }

    let isMounted = true;

    const fetchFile = async () => {
      setLoadingFile(true);
      setFileError(null);
      try {
        // fetchRequest usually returns the parsed response body directly (the JSON object)
        const response = await fetchRequest(
          '/api-local/process/read-file-content',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ filePath: textFilePath }),
          },
        );

        if (response && response.content) {
          // Decode Base64 to binary string
          const binaryString = atob(response.content);

          // Convert binary string to byte array
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          // Decode byte array properly as UTF-8
          const decodedContent = new TextDecoder('utf-8').decode(bytes);

          if (isMounted) setFileContent(decodedContent);
        } else {
          // Fallback if response structure isn't as expected, though fetchRequest usually throws on HTTP errors
          throw new Error('No content returned');
        }
      } catch (error) {
        if (isMounted) {
          console.error(error);
          setFileError('Не вдалося завантажити вміст файлу.');
        }
      } finally {
        if (isMounted) setLoadingFile(false);
      }
    };

    fetchFile();

    return () => {
      isMounted = false;
    };
  }, [isOpen, textFilePath]);

  // Auto-scan for highlights when opened (and after file content loads)
  React.useEffect(() => {
    if (isOpen && contentRef.current) {
      // Use setTimeout to ensure DOM is rendered (especially if children/fileContent are dynamic)
      const timer = setTimeout(() => {
        const elements = Array.from(
          contentRef.current!.querySelectorAll(
            '[data-highlight="true"]',
          ) as NodeListOf<HTMLElement>,
        );

        highlightsRef.current = elements;
        setHighlightCount(elements.length);
        setCurrentIndex(0);

        // Scroll to the first one immediately
        if (elements.length > 0) {
          elements[0].scrollIntoView({
            behavior: 'instant',
            block: 'center',
          });
        }
      }, 500); // Increased timeout to ensure highlighting pass completes

      return () => clearTimeout(timer);
    } else {
      // Reset state when closed
      setHighlightCount(0);
      setCurrentIndex(0);
      highlightsRef.current = [];
    }
  }, [isOpen, children, fileContent, highlightPhrases]); // Re-run if phrases change

  const scrollToHighlight = (index: number) => {
    const el = highlightsRef.current[index];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setCurrentIndex(index);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      scrollToHighlight(currentIndex - 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < highlightCount - 1) {
      scrollToHighlight(currentIndex + 1);
    }
  };

  return (
    <>
      {/* Backdrop (invisible but blocks interaction if desired, or can be removed to allow interaction) */}
      {/* Currently setup to allow interaction with background if removed, but standard sideover usually has a backdrop.
          Based on requirement: "behind content does not covered with background overlay, user need to have possibility to scroll over it"
          So we DO NOT render a blocking backdrop overlay.
      */}

      {/* Sidebar Panel */}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-full md:w-1/2 lg:w-1/3 bg-white shadow-xl transform transition-transform duration-300 ease-in-out dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sideover-title"
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <h2
              id="sideover-title"
              className="text-lg font-semibold text-gray-900 dark:text-white truncate pr-4"
              title={title}
            >
              {title}
            </h2>

            <div className="flex items-center flex-shrink-0">
              {/* Navigation Controls */}
              {/* Only show nav controls if there are highlights */}
              {highlightCount > 0 && (
                <>
                  <div className="flex items-center bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-0.5 mr-3">
                    <button
                      type="button"
                      onClick={handlePrev}
                      disabled={currentIndex === 0}
                      className="p-1.5 text-gray-500 rounded hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-600 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Previous match"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 15l7-7 7 7"
                        />
                      </svg>
                    </button>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 px-2 select-none">
                      {currentIndex + 1} / {highlightCount}
                    </span>
                    <button
                      type="button"
                      onClick={handleNext}
                      disabled={currentIndex === highlightCount - 1}
                      className="p-1.5 text-gray-500 rounded hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-600 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Next match"
                    >
                      <svg
                        className="w-4 h-4"
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

                  {/* Divider */}
                  <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mr-3"></div>
                </>
              )}

              {/* Close Button */}
              <button
                onClick={onClose}
                type="button"
                className="text-gray-400 bg-transparent hover:bg-gray-200 hover:text-gray-900 rounded-lg text-sm p-1.5 inline-flex items-center dark:hover:bg-gray-600 dark:hover:text-white"
              >
                <svg
                  aria-hidden="true"
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  ></path>
                </svg>
                <span className="sr-only">Close sidebar</span>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto" ref={contentRef}>
            <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 p-4 border-b border-gray-200 dark:border-gray-700 shadow-sm">
              {children}
            </div>

            {/* Display Processed Text File Content */}
            {textFilePath && (
              <div className="p-4">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-2 uppercase">
                  Повний вміст документу
                </h3>
                {loadingFile ? (
                  <div className="flex items-center justify-center py-8">
                    <svg
                      aria-hidden="true"
                      className="w-8 h-8 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600"
                      viewBox="0 0 100 101"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                        fill="currentColor"
                      />
                      <path
                        d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                        fill="currentFill"
                      />
                    </svg>
                  </div>
                ) : fileError ? (
                  <div className="p-4 mb-4 text-sm text-red-800 rounded-lg bg-red-50 dark:bg-gray-700 dark:text-red-400 border border-red-200 dark:border-red-800">
                    {fileError}
                  </div>
                ) : (
                  <pre className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-700 text-xs sm:text-sm font-mono text-gray-800 dark:text-gray-200 overflow-x-auto whitespace-pre-wrap break-words">
                    <HighlightedText
                      text={fileContent || ''}
                      highlights={highlightPhrases}
                    />
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export { FormProcessDocumentSideOver };
