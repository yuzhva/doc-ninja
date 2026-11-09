import { fetchRequest } from '../../../utils';
import type { ProcessDocumentsApiResponse } from '../search-page.types';
import type { SearchRequest } from './SearchForm/SearchForm.types';
import type { SearchSourcePayload } from './search-sources';

/** What a search sends the backend. */
interface SearchPayload extends Pick<
  SearchRequest,
  'pageSize' | 'sortOrder' | 'isInflectedWordFormsAllowed' | 'maxTypoDistance'
> {
  // The queries, each on its own and none blank
  bulkNames: string[];
  // Each folder with where in it to search, and its parser config
  sources: SearchSourcePayload[];
}

/**
 * Runs a search on the backend and resolves to what it found. Rejects when
 * `signal` cancels it, and when the backend answers with an error rather
 * than results — never resolving to something that would empty the pane.
 */
const requestSearch = async (
  payload: SearchPayload,
  signal: AbortSignal,
): Promise<ProcessDocumentsApiResponse> => {
  const response = await fetchRequest('/api-local/process/documents', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });

  if (!response?.extractedResults) {
    throw new Error(
      response?.error?.message ?? 'The search answered with no results',
    );
  }
  return response;
};

export { requestSearch };
export type { SearchPayload };
