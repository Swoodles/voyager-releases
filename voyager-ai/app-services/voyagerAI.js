// app/services/voyagerAI.js  v2
// Talks to the voyager-ai v2 backend.
// Drop-in replacement — same function names, richer response shape.

const PORT     = window.__VOYAGER_AI_PORT__ || localStorage.getItem('voy_ai_port') || 3747;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// ── Core fetch helper ─────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const { method = 'GET', body, timeout = 60000 } = options;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body:    body ? JSON.stringify(body) : undefined,
    signal:  AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Health check ──────────────────────────────────────────────────────────────
export async function checkHealth() {
  try {
    const d = await apiFetch('/health', { timeout: 2000 });
    return d.ok === true;
  } catch { return false; }
}

// ── Main search (calls full pipeline) ────────────────────────────────────────
/**
 * @param {string} query
 * @param {object} opts
 * @param {object}  opts.weights    { rating, reviews, value, features } 0-1 each
 * @param {string}  opts.priority   Balanced | Quality | Budget | Trending | Local Pick
 * @param {string}  [opts.ipCountry]  ISO-2
 * @param {boolean} [opts.noCache]
 * @returns {Promise<PipelineResult>}
 */
export async function searchWithAI(query, opts = {}) {
  const data = await apiFetch('/search', {
    method: 'POST',
    body: {
      query,
      weights:   opts.weights   || {},
      priority:  opts.priority  || 'Balanced',
      ipCountry: opts.ipCountry || null,
      noCache:   !!opts.noCache,
    },
  });
  if (!data.ok) throw new Error(data.error || 'Search failed');
  return data.result;
}

// ── Discover tab ──────────────────────────────────────────────────────────────
/**
 * @param {string} location   e.g. 'Paris, France'
 * @param {string} category   restaurants | cafes | bars | attractions | museums | bakeries
 * @param {number} [limit=8]
 * @param {string} [ipCountry]
 * @returns {Promise<Candidate[]>}
 */
export async function fetchDiscoverResults(location, category, limit = 8, ipCountry = null) {
  const params = new URLSearchParams({ location, category, limit });
  if (ipCountry) params.set('ipCountry', ipCountry);
  const data = await apiFetch(`/search/discover?${params}`);
  if (!data.ok) throw new Error(data.error || 'Discover failed');
  return data.items || [];
}

// ── Query classification (preview without running) ────────────────────────────
export async function classifyQuery(query) {
  const data = await apiFetch('/search/classify', { method: 'POST', body: { query } });
  return data.ok ? { classification: data.classification, geo: data.geo } : null;
}

// ── Metrics (admin) ───────────────────────────────────────────────────────────
export async function fetchMetrics() {
  const data = await apiFetch('/metrics', { timeout: 5000 });
  return data.ok ? data : null;
}

export async function clearCache() {
  return apiFetch('/search/admin/cache/clear', { method: 'POST' });
}

export async function getCacheStats() {
  return apiFetch('/search/admin/cache/stats');
}

// ── IP detection ──────────────────────────────────────────────────────────────
export async function detectIpCountry() {
  try {
    const r = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(3000) });
    const d = await r.json();
    return d.country_code || null;
  } catch { return null; }
}

// ── Result helpers ────────────────────────────────────────────────────────────

/** Colour for a score 0–100 */
export function scoreColor(score) {
  if (score >= 90) return 'var(--green)';
  if (score >= 80) return 'var(--teal)';
  if (score >= 70) return 'var(--gold)';
  return 'var(--coral)';
}

/** Human-readable tier label */
export function tierLabel(tier) {
  return { 1: 'Quick Search', 2: 'AI Enhanced', 3: 'AI Planner' }[tier] || '';
}
