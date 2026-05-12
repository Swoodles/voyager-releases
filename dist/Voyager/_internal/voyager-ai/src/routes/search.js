// src/routes/search.js
const express        = require('express');
const { runPipeline }= require('../pipeline');
const cache          = require('../cache/cache-manager');
const costTracker    = require('../observability/cost-tracker');
const { detectGeo }  = require('../router/geo-router');
const { classifyQuery } = require('../router/query-classifier');

const router = express.Router();

// ── POST /search — main AI search pipeline ────────────────────────────────────
router.post('/', async (req, res) => {
  const { query, weights, priority, ipCountry, noCache, userId } = req.body;
  if (!query?.trim()) return res.status(400).json({ ok: false, error: 'query required' });

  try {
    const result = await runPipeline(query.trim(), {
      weights:   weights   || {},
      priority:  priority  || 'Balanced',
      ipCountry: ipCountry || null,
      noCache:   !!noCache,
      userId:    userId    || null,
    });
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[route /search]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /search/classify — preview tier routing without running ──────────────
router.post('/classify', (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ ok: false, error: 'query required' });
  const classification = classifyQuery(query.trim());
  const geo            = detectGeo(query.trim());
  res.json({ ok: true, classification, geo });
});

// ── GET /search/discover — Discover tab auto-populate ────────────────────────
router.get('/discover', async (req, res) => {
  const { location, category = 'restaurants', limit = 8, ipCountry } = req.query;
  if (!location) return res.status(400).json({ ok: false, error: 'location required' });

  // Check precomputed cache first
  const geo      = detectGeo(location, ipCountry);
  const cacheKey = ['precompute', geo.countryCode, category];
  const cached   = await cache.get(cacheKey);
  if (cached) return res.json({ ok: true, location, category, items: cached.results?.slice(0, parseInt(limit)) || [], _fromCache: true });

  // Fall back to live pipeline
  const queries = buildDiscoverQueries(location, category, parseInt(limit));
  const results = await Promise.allSettled(
    queries.map(q => runPipeline(q, { ipCountry: ipCountry || null }))
  );
  const items = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value.top || r.value.results?.[0])
    .filter(Boolean);

  res.json({ ok: true, location, category, items });
});

// ── Admin routes ──────────────────────────────────────────────────────────────
router.get('/admin/metrics', (req, res) => {
  res.json({ ok: true, metrics: costTracker.getMetrics() });
});

router.post('/admin/cache/clear', async (req, res) => {
  await cache.clearAll();
  res.json({ ok: true, message: 'Cache cleared' });
});

router.get('/admin/cache/stats', async (req, res) => {
  const s = await cache.stats();
  res.json({ ok: true, ...s });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const DISCOVER_TEMPLATES = {
  restaurants: ['best local restaurants', 'top rated dinner spots', 'must try food'],
  cafes:       ['best cafes', 'specialty coffee', 'top coffee shops'],
  bars:        ['best bars', 'craft cocktail bars', 'local nightlife'],
  attractions: ['must visit attractions', 'top sightseeing spots', 'hidden gems'],
  museums:     ['best museums', 'art museums', 'history museums'],
  bakeries:    ['best bakeries', 'artisan pastries', 'local bread'],
  hotels:      ['best hotels', 'boutique hotels', 'top accommodations'],
};

function buildDiscoverQueries(location, category, limit) {
  const templates = DISCOVER_TEMPLATES[category] || DISCOVER_TEMPLATES.restaurants;
  return templates.slice(0, Math.min(limit, templates.length))
    .map(t => `${t} in ${location}`);
}

module.exports = router;
