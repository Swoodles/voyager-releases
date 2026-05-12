// frontend/hooks/useDiscover.js
// React hook — auto-populates the Discover page with AI-scored results.
// Re-fetches whenever location or category changes.

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchDiscoverResults, detectIpCountry } from '../services/voyagerAI';

/**
 * @param {object} params
 * @param {string}   params.location    e.g. 'Paris, France'
 * @param {string}   params.category    e.g. 'Restaurants'
 * @param {number}   [params.limit=6]
 * @param {boolean}  [params.enabled=true]  Set false to pause fetching
 */
export function useDiscover({ location, category, limit = 6, enabled = true }) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  // Cache reference to avoid duplicate requests
  const lastKey  = useRef(null);
  const ipCountry = useRef(null);

  // Detect user's IP country once on mount (for geo routing)
  useEffect(() => {
    detectIpCountry().then(code => { ipCountry.current = code; });
  }, []);

  const fetchResults = useCallback(async () => {
    if (!enabled || !location || !category) return;

    const key = `${location}|${category}|${limit}`;
    if (key === lastKey.current) return;     // nothing changed
    lastKey.current = key;

    setLoading(true);
    setError(null);

    try {
      const results = await fetchDiscoverResults(
        location,
        category,
        limit,
        ipCountry.current,
      );
      setItems(results);
    } catch (err) {
      console.error('[useDiscover] Error:', err);
      setError(err.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [location, category, limit, enabled]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  /** Manually re-fetch (e.g. pull-to-refresh) */
  const refresh = useCallback(() => {
    lastKey.current = null;    // clear cache guard so next call fires
    fetchResults();
  }, [fetchResults]);

  return { items, loading, error, refresh };
}
