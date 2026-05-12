// frontend/hooks/useAISearch.js
// React hook — drives the bottom AI search bar + Params panel.
// Calls the full pipeline and exposes the structured result.

import { useState, useCallback, useRef } from 'react';
import { searchWithAI, detectIpCountry } from '../services/voyagerAI';

/** Default Params slider values (matching the UI: Rating 40%, Reviews 20%, Value 25%, Features 15%) */
const DEFAULT_WEIGHTS = { rating: 0.40, reviews: 0.20, value: 0.25, features: 0.15 };

/**
 * @returns {{
 *   query:        string,
 *   setQuery:     Function,
 *   weights:      object,
 *   setWeights:   Function,
 *   priority:     string,
 *   setPriority:  Function,
 *   result:       object | null,
 *   loading:      boolean,
 *   error:        string | null,
 *   search:       Function,
 *   clear:        Function,
 * }}
 */
export function useAISearch() {
  const [query,    setQuery]    = useState('');
  const [weights,  setWeights]  = useState(DEFAULT_WEIGHTS);
  const [priority, setPriority] = useState('Balanced');
  const [result,   setResult]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  const ipCountryRef = useRef(null);

  // Detect IP country once
  if (ipCountryRef.current === null) {
    detectIpCountry().then(code => { ipCountryRef.current = code || ''; });
  }

  /**
   * Update a single slider weight. The Params panel should call this for each slider.
   * @param {'rating'|'reviews'|'value'|'features'} key
   * @param {number} value   0–1
   */
  const setWeight = useCallback((key, value) => {
    setWeights(prev => ({ ...prev, [key]: value }));
  }, []);

  /**
   * Fire the search — called when user submits the search bar.
   * @param {string} [overrideQuery]  Pass a query directly (optional)
   */
  const search = useCallback(async (overrideQuery) => {
    const q = (overrideQuery || query).trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await searchWithAI(q, {
        weights,
        priority,
        ipCountry: ipCountryRef.current || undefined,
      });
      setResult(res);
    } catch (err) {
      console.error('[useAISearch] Error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query, weights, priority]);

  /** Reset everything back to initial state */
  const clear = useCallback(() => {
    setQuery('');
    setResult(null);
    setError(null);
  }, []);

  return {
    // State
    query, setQuery,
    weights, setWeight, setWeights,
    priority, setPriority,
    result, loading, error,
    // Actions
    search, clear,
    defaultWeights: DEFAULT_WEIGHTS,
  };
}
