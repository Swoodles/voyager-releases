// src/jobs/scheduler.js
// Background job runner — fires periodic tasks without blocking request handling.
// Uses setInterval for dev; swap for BullMQ/Celery in production.

const cacheManager = require('../cache/cache-manager');
const costTracker  = require('../observability/cost-tracker');

// ── Precomputed city datasets ─────────────────────────────────────────────────
// These cities get their top categories precomputed and cached on startup + refresh.
const PRECOMPUTE_CITIES = [
  { city: 'Tokyo, Japan',          countryCode: 'JP', categories: ['restaurants','cafes','attractions','bars'] },
  { city: 'Osaka, Japan',          countryCode: 'JP', categories: ['restaurants','bars','attractions'] },
  { city: 'Paris, France',         countryCode: 'FR', categories: ['restaurants','cafes','bakeries','museums'] },
  { city: 'London, UK',            countryCode: 'GB', categories: ['restaurants','bars','museums','attractions'] },
  { city: 'New York, USA',         countryCode: 'US', categories: ['restaurants','bars','attractions','cafes'] },
  { city: 'Rome, Italy',           countryCode: 'IT', categories: ['restaurants','attractions','cafes'] },
  { city: 'Barcelona, Spain',      countryCode: 'ES', categories: ['restaurants','bars','attractions'] },
  { city: 'Bangkok, Thailand',     countryCode: 'TH', categories: ['restaurants','attractions','bars'] },
  { city: 'Seoul, South Korea',    countryCode: 'KR', categories: ['restaurants','cafes','attractions'] },
  { city: 'Mexico City, Mexico',   countryCode: 'MX', categories: ['restaurants','bars','attractions'] },
];

// ── Job definitions ───────────────────────────────────────────────────────────

const JOBS = [
  {
    name:       'trend-refresh',
    intervalMs: 60 * 60 * 1000,        // every hour
    fn:         runTrendRefresh,
  },
  {
    name:       'city-precompute',
    intervalMs: 6 * 60 * 60 * 1000,   // every 6 hours
    fn:         runCityPrecompute,
  },
  {
    name:       'cache-cleanup',
    intervalMs: 30 * 60 * 1000,       // every 30 minutes
    fn:         runCacheCleanup,
  },
];

const _timers = [];
let   _running = false;

/**
 * Start all background jobs.
 * Call from server.js after startup.
 */
function startAll() {
  if (_running) return;
  _running = true;

  for (const job of JOBS) {
    console.log(`[scheduler] Starting job: ${job.name} (every ${job.intervalMs / 60000}min)`);
    // Fire once on startup, then on interval
    job.fn().catch(err => console.error(`[scheduler] ${job.name} startup error:`, err.message));
    _timers.push(setInterval(() => {
      job.fn().catch(err => console.error(`[scheduler] ${job.name} error:`, err.message));
    }, job.intervalMs));
  }

  console.log('[scheduler] All background jobs started');
}

function stopAll() {
  _timers.forEach(t => clearInterval(t));
  _timers.length = 0;
  _running = false;
}

// ── Job implementations ───────────────────────────────────────────────────────

async function runTrendRefresh() {
  console.log('[scheduler] trend-refresh: running');
  // In production: query Google Trends + Reddit for top cities
  // Store results in cache with TTL.trending TTL
  // Stub: just log for now
  console.log('[scheduler] trend-refresh: complete (stub)');
}

async function runCityPrecompute() {
  console.log(`[scheduler] city-precompute: precomputing ${PRECOMPUTE_CITIES.length} cities`);

  // Dynamically import pipeline to avoid circular deps
  const { runPipeline } = require('../pipeline');

  let computed = 0;
  for (const entry of PRECOMPUTE_CITIES) {
    for (const category of entry.categories) {
      try {
        const cacheKey = ['precompute', entry.countryCode, category];
        const existing = await cacheManager.get(cacheKey);
        if (existing) continue; // already fresh

        const result = await runPipeline(`top ${category} in ${entry.city}`, {
          priority:  'Balanced',
          noCache:   true,
          isPrecompute: true,
        });

        // Store with category TTL (7 days for attractions, 24h for restaurants)
        await cacheManager.set(cacheKey, result, category);
        computed++;
        console.log(`[scheduler] precomputed: ${entry.city} / ${category}`);
      } catch (err) {
        console.warn(`[scheduler] precompute failed: ${entry.city}/${category}:`, err.message);
      }

      // Throttle to avoid hammering APIs
      await sleep(2000);
    }
  }

  console.log(`[scheduler] city-precompute: ${computed} datasets refreshed`);
}

async function runCacheCleanup() {
  // In-memory cache prunes itself; this is for any DB-side cleanup
  const metrics = costTracker.getMetrics();
  if (metrics.cacheHitRate < 30 && metrics.totalRequests > 50) {
    console.warn(`[scheduler] Low cache hit rate: ${metrics.cacheHitRate}% — consider precomputing more cities`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { startAll, stopAll, PRECOMPUTE_CITIES };
