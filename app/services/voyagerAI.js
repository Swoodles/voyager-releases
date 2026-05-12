// frontend/services/voyagerAI.js
// Thin HTTP client that talks to the voyager-ai Node.js backend.
// Works in both Electron/PyWebView (localhost) and standard web contexts.

const BASE_URL = `http://127.0.0.1:${window.__VOYAGER_AI_PORT__ || 3747}`;

// ── Types (JSDoc) ─────────────────────────────────────────────────────────────
/**
 * @typedef {Object} SearchWeights
 * @property {number} rating    0–1
 * @property {number} reviews   0–1
 * @property {number} value     0–1
 * @property {number} features  0–1
 */

/**
 * @typedef {Object} SearchOptions
 * @property {SearchWeights} [weights]
 * @property {'Balanced'|'Quality'|'Budget'|'Trending'|'Local Pick'} [priority]
 * @property {string}  [ipCountry]   ISO-2 from ipapi
 * @property {boolean} [noCache]
 */

/**
 * @typedef {Object} VoyagerResult
 * @property {number}   local_score
 * @property {number}   tourist_score
 * @property {number}   score_gap
 * @property {string}   score_gap_explanation
 * @property {object}   local_sentiment
 * @property {object}   tourist_sentiment
 * @property {string}   what_makes_it_good
 * @property {string[]} authority_signals
 * @property {boolean}  trending
 * @property {string}   trending_reason
 * @property {string}   recommendation
 * @property {string}   one_line
 * @property {string}   place_name
 * @property {string}   place_type
 * @property {string}   price_range
 */

// ── Core helpers ──────────────────────────────────────────────────────────────

async function post(endpoint, body) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

async function get(endpoint, params = {}) {
  const qs  = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${endpoint}${qs ? '?' + qs : ''}`;
  const res = await fetch(url);

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run a natural-language search through the full AI pipeline.
 *
 * @param {string}        query
 * @param {SearchOptions} [options]
 * @returns {Promise<VoyagerResult>}
 */
export async function searchWithAI(query, options = {}) {
  const { weights, priority, ipCountry, noCache } = options;
  const body = { query, weights, priority, ipCountry, noCache };
  const data = await post('/search', body);
  if (!data.ok) throw new Error(data.error || 'Unknown error');
  return data.result;
}

/**
 * Fetch Discover page results for a given location + category.
 * Returns an array of VoyagerResult objects.
 *
 * @param {string} location    e.g. 'Paris, France'
 * @param {string} category    e.g. 'Restaurants'
 * @param {number} [limit=6]
 * @param {string} [ipCountry]
 * @returns {Promise<VoyagerResult[]>}
 */
export async function fetchDiscoverResults(location, category, limit = 6, ipCountry = null) {
  const params = { location, category, limit };
  if (ipCountry) params.ipCountry = ipCountry;

  const data = await get('/search/discover', params);
  if (!data.ok) throw new Error(data.error || 'Unknown error');
  return data.items;
}

/**
 * Health-check — returns true if the AI backend is running.
 */
export async function checkHealth() {
  try {
    const res  = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

/**
 * Detect the user's country from their IP via ipapi.co (free, no key needed).
 * Returns ISO-2 code string, e.g. 'JP', or null on failure.
 */
export async function detectIpCountry() {
  try {
    const res  = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return data.country_code || null;
  } catch {
    return null;
  }
}
