// src/sources/index.js
// Runs the geo-configured source set in parallel, deduplicates, and normalises.

const { getSourcesForRegion } = require('../router/geo-router');
const GooglePlacesAdapter = require('./google-places');
const FoursquareAdapter   = require('./foursquare');
const RedditAdapter       = require('./reddit');
const TrendsAdapter       = require('./trends');

// Registry — add new adapters here only
const ADAPTER_REGISTRY = {
  google_places: new GooglePlacesAdapter(),
  foursquare:    new FoursquareAdapter(),
  reddit:        new RedditAdapter(),
  trends:        new TrendsAdapter(),
  // Regional (use stub adapters until real APIs are integrated)
  tabelog:    makeStub('tabelog',    0.92, 0.95),
  gurunavi:   makeStub('gurunavi',   0.80, 0.90),
  naver_place:makeStub('naver_place',0.88, 0.93),
  kakao:      makeStub('kakao',      0.82, 0.90),
  dianping:   makeStub('dianping',   0.88, 0.92),
  meituan:    makeStub('meituan',    0.80, 0.88),
  thefork:    makeStub('thefork',    0.78, 0.72),
  opentripmap:makeStub('opentripmap',0.65, 0.40),
  ticketmaster:makeStub('ticketmaster',0.85, 0.50),
};

/**
 * Fetch all configured sources for a query in parallel.
 *
 * @param {string} query
 * @param {object} geoMeta     - { countryCode, lang, ... }
 * @param {string} category    - normalised category
 * @param {object} [options]   - { limit, placeType }
 * @returns {Promise<{ candidates, signals }>}
 */
async function fetchAllSources(query, geoMeta, category = 'all', options = {}) {
  const sourceIds = getSourcesForRegion(geoMeta.countryCode, category);

  // Run all sources in parallel — failures are isolated
  const results = await Promise.allSettled(
    sourceIds.map(id => {
      const adapter = ADAPTER_REGISTRY[id];
      if (!adapter) {
        console.warn(`[sources] No adapter for ${id}`);
        return Promise.resolve([]);
      }
      return adapter.fetch(query, geoMeta, options).catch(err => {
        console.error(`[sources] ${id} failed:`, err.message);
        return [];
      });
    })
  );

  const all = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  // Separate place candidates from signal records (reddit/trends)
  const candidates = all.filter(r => r.category !== 'signal');
  const signals    = all.filter(r => r.category === 'signal');

  // Deduplicate candidates by normalised name (fuzzy)
  const deduped = deduplicateCandidates(candidates);

  return { candidates: deduped, signals, sourcesUsed: sourceIds };
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function deduplicateCandidates(candidates) {
  const seen = new Map();

  for (const c of candidates) {
    const key = normaliseKey(c.name);
    if (!seen.has(key)) {
      seen.set(key, { ...c, _sources: [c.sourceId] });
    } else {
      // Merge: keep best rating, sum review counts, union badges
      const existing = seen.get(key);
      existing._sources.push(c.sourceId);
      if (c.rating != null && (existing.rating == null || c.rating > existing.rating)) {
        existing.rating = c.rating;
      }
      existing.reviewCount     = (existing.reviewCount || 0) + (c.reviewCount || 0);
      existing.authorityBadges = [...new Set([...(existing.authorityBadges||[]), ...(c.authorityBadges||[])])];
      // Fill in missing fields from additional source
      if (!existing.address    && c.address)    existing.address    = c.address;
      if (!existing.lat        && c.lat)        existing.lat        = c.lat;
      if (!existing.lng        && c.lng)        existing.lng        = c.lng;
      if (!existing.website    && c.website)    existing.website    = c.website;
      if (!existing.imageUrl   && c.imageUrl)   existing.imageUrl   = c.imageUrl;
      if (!existing.description && c.description) existing.description = c.description;
    }
  }

  return Array.from(seen.values());
}

function normaliseKey(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
}

// ── Stub adapter factory (for regional sources pending real API integration) ──

function makeStub(sourceId, authority, localSignal) {
  return {
    sourceId,
    async fetch(query, geoMeta, options = {}) {
      // Stub: returns empty. Replace with real implementation when API is available.
      // Log so we know it was called during development
      console.log(`[stub:${sourceId}] fetch called for "${query}" — no implementation yet`);
      return [];
    },
  };
}

module.exports = { fetchAllSources };
