// src/pipeline.js
// Master pipeline. Assembles all components for a query.
// Tier routing keeps costs down; every component is independently replaceable.

const { classifyQuery }           = require('./router/query-classifier');
const { detectGeo, getSourcesForRegion, normaliseCategory } = require('./router/geo-router');
const { fetchAllSources }         = require('./sources/index');
const { scoreAndRank }            = require('./scoring/engine');
const { detectAuthorityBadges, buildDisplayBadges } = require('./scoring/authority');
const { generateSnippets, explainScoreGap, generateItinerary, compareOptions } = require('./ai/explainer');
const cache                       = require('./cache/cache-manager');
const costTracker                 = require('./observability/cost-tracker');

/**
 * Run the full Voyager AI pipeline for a query.
 *
 * @param {string} query
 * @param {object} options
 * @param {object} [options.weights]       - Slider overrides { rating, reviews, value, features }
 * @param {string} [options.priority]      - Balanced | Quality | Budget | Trending | Local Pick
 * @param {string} [options.ipCountry]     - ISO-2 from client ipapi call
 * @param {boolean}[options.noCache]       - Skip cache
 * @param {string} [options.userId]        - For user-scoped caching (itineraries)
 * @param {boolean}[options.isPrecompute]  - Background job flag (skips some enrichment)
 * @returns {Promise<PipelineResult>}
 */
async function runPipeline(query, options = {}) {
  const t0 = Date.now();
  const { weights = {}, priority = 'Balanced', ipCountry, noCache, userId, isPrecompute } = options;

  // ── 1. Classify query → tier ──────────────────────────────────────────────
  const { tier, intent } = classifyQuery(query);
  const category         = normaliseCategory(intent.category);

  // ── 2. Detect geography ───────────────────────────────────────────────────
  const geoMeta = detectGeo(query, ipCountry);

  // ── 3. Cache check ────────────────────────────────────────────────────────
  const cacheKey = [
    'search', geoMeta.countryCode, category,
    query.toLowerCase().trim().replace(/\s+/g,'_').slice(0, 60),
  ];

  if (!noCache) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      costTracker.recordRequest({ cacheHit: true, tier, latencyMs: Date.now() - t0 });
      return { ...cached, _fromCache: true };
    }
  }

  costTracker.recordRequest({ cacheHit: false, tier, latencyMs: 0, sourcesUsed: [] });

  // ── 4. Fetch sources in parallel ──────────────────────────────────────────
  const { candidates, signals, sourcesUsed } = await fetchAllSources(
    query, geoMeta, category, { limit: 12 }
  );

  // ── 5. Authority badge detection ──────────────────────────────────────────
  const enrichedCandidates = candidates.map(c => ({
    ...c,
    authorityBadges: detectAuthorityBadges(c, geoMeta),
  }));

  // ── 6. Deterministic scoring engine ──────────────────────────────────────
  const scored = scoreAndRank(enrichedCandidates, signals, geoMeta, weights);

  // ── 7. Tier-specific AI enrichment ────────────────────────────────────────
  let result;

  if (tier === 1 || isPrecompute) {
    // Tier 1: No LLM — return structured data immediately
    result = buildResponse(query, scored, signals, geoMeta, intent, tier, null, null);

  } else if (tier === 2) {
    // Tier 2: Cheap LLM for snippets + gap explanation
    const [enriched, gapExplanation] = await Promise.all([
      generateSnippets(scored, query, geoMeta),
      explainScoreGap(scored[0], geoMeta),
    ]);
    result = buildResponse(query, enriched, signals, geoMeta, intent, tier, gapExplanation, null);

  } else {
    // Tier 3: Premium LLM for itinerary or comparison
    let enriched = await generateSnippets(scored, query, geoMeta);

    let itinerary = null, comparison = null;
    if (intent.isPlanning || intent.duration) {
      itinerary = await generateItinerary(query, enriched, intent, geoMeta);
    } else if (/\bvs\b|\bcompare\b|\bor\b.*\bor\b/i.test(query)) {
      comparison = await compareOptions(enriched.slice(0, 5), query, geoMeta);
    }

    result = buildResponse(query, enriched, signals, geoMeta, intent, tier, null, { itinerary, comparison });
  }

  // ── 8. Cache result ───────────────────────────────────────────────────────
  const isTrending = signals.some(s => s.trending);
  await cache.set(cacheKey, result, category, isTrending);

  const latencyMs = Date.now() - t0;
  costTracker.recordRequest({ cacheHit: false, tier, latencyMs, sourcesUsed });
  console.log(`[pipeline] "${query}" → tier${tier} | ${scored.length} results | ${latencyMs}ms`);

  return result;
}

// ── Response builder ──────────────────────────────────────────────────────────

function buildResponse(query, scored, signals, geoMeta, intent, tier, gapExplanation, aiExtras) {
  const top       = scored[0] || null;
  const trendSig  = signals.find(s => s.sourceId === 'trends');
  const redditSig = signals.find(s => s.sourceId === 'reddit');

  return {
    query,
    geo: geoMeta,
    tier,
    intent,
    results: scored.slice(0, 10).map(formatCandidate),
    top: top ? formatCandidate(top) : null,
    trending:         trendSig?.trending || false,
    trendMomentum:    trendSig?.momentum || 1,
    redditPosts:      redditSig?.redditPosts || [],
    gapExplanation:   gapExplanation || null,
    ...(aiExtras || {}),
    _generatedAt: new Date().toISOString(),
    _fromCache:   false,
  };
}

function formatCandidate(c) {
  return {
    id:             c.id,
    name:           c.name,
    category:       c.category,
    rating:         c.rating,
    reviewCount:    c.reviewCount,
    address:        c.address,
    lat:            c.lat,
    lng:            c.lng,
    priceRange:     c.priceRange,
    website:        c.website,
    phone:          c.phone,
    imageUrl:       c.imageUrl,
    description:    c.description,
    isOpen:         c.isOpen,
    features:       c.features || [],
    authorityBadges:  c.authorityBadges || [],
    displayBadges:    buildDisplayBadges(c.authorityBadges || []),
    score:            c._score,
    localScore:       c._localScore,
    touristScore:     c._touristScore,
    scoreGap:         c._scoreGap,
    aiSnippet:        c.aiSnippet || null,
    sourcesUsed:      c._sourcesUsed || [],
    trending:         (c.trendScore || 0) > 0.6,
  };
}

module.exports = { runPipeline };
