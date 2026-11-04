import { useEffect, useState } from "react";

import { resolveList, searchCategories } from "../api/client";
import type { SearchHit } from "../api/types";
import { useDebouncedValue } from "./useDebouncedValue";

const DEBOUNCE_MS = 150;
// Long enough that a pause mid-word doesn't count as what the shopper wanted.
const SETTLED_MS = 2000;
const MIN_SETTLED_LENGTH = 3;

interface SearchResult {
  query: string;
  hits: SearchHit[];
  failed: boolean;
}

const NO_RESULT: SearchResult = { query: "", hits: [], failed: false };

/**
 * Live search. Only the latest term's answer is kept, so slow replies can't overwrite it.
 *
 * A term that settles on nothing goes through list matching too, the one place the
 * backend records what shoppers wanted. Every keystroke searches, so a miss in
 * search itself would mostly be half a word.
 */
export function useCategorySearch(term: string, sessionId: string) {
  const trimmed = term.trim();
  const query = useDebouncedValue(trimmed, DEBOUNCE_MS);
  const settled = useDebouncedValue(trimmed, SETTLED_MS);
  const [result, setResult] = useState(NO_RESULT);

  useEffect(() => {
    if (!query) {
      setResult(NO_RESULT);
      return;
    }
    const controller = new AbortController();
    searchCategories(query, controller.signal)
      .then((hits) => setResult({ query, hits, failed: false }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setResult({ query, hits: [], failed: true });
        }
      });
    return () => controller.abort();
  }, [query]);

  const cameUpEmpty = settled === result.query && !result.failed && result.hits.length === 0;
  useEffect(() => {
    if (cameUpEmpty && settled.length >= MIN_SETTLED_LENGTH) {
      resolveList([settled], sessionId).catch(() => undefined);
    }
  }, [cameUpEmpty, settled, sessionId]);

  return {
    hits: result.query === trimmed ? result.hits : [],
    failed: result.query === trimmed && result.failed,
    isSearching: trimmed !== "" && result.query !== trimmed,
  };
}
