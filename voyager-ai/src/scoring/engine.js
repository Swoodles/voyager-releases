// src/scoring/engine.js
// Deterministic weighted scoring — config-driven, zero LLM dependency.
// AI explains scores; this engine CALCULATES them.

const scoringConfig  = require('../config/scoring.json');
const { getSourceMetadata } = require('../router/geo-router');

/**
 * Score and rank a list of candidates.
 *
 * @param {object[]} candidates  - From sources/index.js
 * @param {object[]} signals     - Reddit/trend signal records
 * @param {object}   geoMeta     - { countryCode, lang }
 * @param {object}   [weights]   - User weight overrides from Params sliders
 * @returns {ScoredCandidate[]}  - Sorted best-first
 */
function scoreAndRank(candidates, signals, geoMeta, weights = {}) {
  const cfg     = getEffectiveConfig(geoMeta.countryCode);
  const w       = mergeWeights(cfg.global, weights);
  const trendSig = extractTrendSignal(signals);

  const scored = candidates.map(c => {
    const scores = computeComponentScores(c, geoMeta, trendSig, cfg);
    const raw    = (
      scores.rating    * w.rating_weight        +
      scores.volume    * w.volume_weight        +
      scores.recency   * w.recency_weight       +
      scores.authority * w.authority_weight     +
      scores.trend     * w.trend_weight         +
      scores.localSrc  * w.local_source_weight
    ) * 100;

    // Authority multiplier (Michelin, Tabelog gold, etc.)
    const multiplier = getBestAuthorityMultiplier(c.authorityBadges, cfg);
    let finalScore   = Math.min(raw * multiplier, 100);

    // Michelin floor
    finalScore = applyMichelinFloor(finalScore, c.authorityBadges, cfg);

    // Low-signal cap
    finalScore = applyLowSignalCap(finalScore, c, cfg);

    const { localScore, touristScore } = computeLocalTouristScores(c, geoMeta, trendSig, cfg);

    return {
      ...c,
      _score:       Math.round(finalScore),
      _localScore:  Math.round(localScore),
      _touristScore:Math.round(touristScore),
      _scoreGap:    Math.round(localScore - touristScore),
      _components:  scores,
      _multiplier:  multiplier,
      _sourcesUsed: c._sources || [c.sourceId],
    };
  });

  return scored.sort((a, b) => b._score - a._score);
}

// ── Component scorers ─────────────────────────────────────────────────────────

function computeComponentScores(c, geoMeta, trendSig, cfg) {
  return {
    rating:    ratingScore(c.rating),
    volume:    volumeScore(c.reviewCount, cfg),
    recency:   recencyScore(c.lastReviewDate, cfg),
    authority: authorityScore(c.authorityBadges),
    trend:     trendScore(c, trendSig, cfg),
    localSrc:  localSourceScore(c, geoMeta),
  };
}

function ratingScore(rating) {
  if (rating == null) return 0.5; // neutral when unknown
  return Math.min(Math.max(rating / 5, 0), 1);
}

function volumeScore(reviewCount, cfg) {
  if (!reviewCount) return 0;
  const { log_base, max_bonus_pts, min_reviews_for_full_score } = cfg.volumeScoring;
  const raw  = Math.log(reviewCount + 1) / Math.log(log_base);
  const full = Math.log(min_reviews_for_full_score + 1) / Math.log(log_base);
  return Math.min(raw / full, 1) * (max_bonus_pts / 10);
}

function recencyScore(lastReviewDate, cfg) {
  if (!lastReviewDate) return 0.5;
  const daysSince = (Date.now() - new Date(lastReviewDate)) / 86400000;
  const { days_for_full_score, days_decay_half } = cfg.recencyScoring;
  if (daysSince <= days_for_full_score) return 1.0;
  const decay = Math.exp(-Math.log(2) * (daysSince - days_for_full_score) / days_decay_half);
  return Math.max(decay, 0.1);
}

function authorityScore(badges = []) {
  if (!badges.length) return 0;
  // Presence of ANY authority badge gets a base bump; stacks slightly
  return Math.min(0.3 + badges.length * 0.1, 1.0);
}

function trendScore(candidate, trendSig, cfg) {
  const base     = candidate.trendScore || 0;
  const external = trendSig ? trendSig.trendScore : 0;
  return Math.min((base + external) / 2, 1);
}

function localSourceScore(candidate, geoMeta) {
  const meta = getSourceMetadata(candidate.sourceId);
  // If this source is highly local for this region, boost it
  return meta.localSignal;
}

// ── Local / Tourist Split ─────────────────────────────────────────────────────

function computeLocalTouristScores(c, geoMeta, trendSig, cfg) {
  const lt  = cfg.localTouristSplit;
  const lrr = c.localReviewRatio ?? 0.5;
  const meta = getSourceMetadata(c.sourceId);

  const localScore = Math.min(100, (
    lrr                    * lt.local.local_review_ratio_weight  * 100 +
    (c.rating || 3) / 5   * lt.local.local_source_rating_weight * 100 * meta.localSignal +
    (trendSig?.trendScore || 0) * lt.local.social_local_weight  * 100 -
    (1 - lrr)             * lt.local.english_density_penalty    * 30
  ));

  const touristScore = Math.min(100, (
    (1 - lrr)              * lt.tourist.english_review_ratio_weight   * 100 +
    (c.rating || 3) / 5   * lt.tourist.global_source_rating_weight   * 100 * meta.touristSignal +
    accessibilityScore(c) * lt.tourist.accessibility_weight           * 100 +
    (trendSig?.trendScore || 0) * lt.tourist.social_tourist_weight   * 100
  ));

  return { localScore: Math.max(localScore, 0), touristScore: Math.max(touristScore, 0) };
}

function accessibilityScore(c) {
  let score = 0.5;
  if (c.website) score += 0.1;
  if (c.phone)   score += 0.1;
  if (c.address) score += 0.1;
  if (c.hours)   score += 0.1;
  if (c.priceRange && c.priceRange.length <= 2) score += 0.1; // budget-friendly
  return Math.min(score, 1);
}

// ── Authority & floors ────────────────────────────────────────────────────────

function getBestAuthorityMultiplier(badges = [], cfg) {
  if (!badges.length) return 1.0;
  const mults = badges.map(b => cfg.authorityMultipliers[b] || 1.0);
  return Math.max(...mults);
}

function applyMichelinFloor(score, badges = [], cfg) {
  const floors = cfg.michelinFloors || {};
  for (const [badge, floor] of Object.entries(floors)) {
    if (badges.includes(badge) && score < floor) return floor;
  }
  return score;
}

function applyLowSignalCap(score, candidate, cfg) {
  const { min_reviews_threshold, no_authority_score_cap } = cfg.lowSignalProtection;
  const reviewCount  = candidate.reviewCount || 0;
  const hasAuthority = (candidate.authorityBadges || []).length > 0;
  if (reviewCount < min_reviews_threshold && !hasAuthority) {
    return Math.min(score, no_authority_score_cap);
  }
  return score;
}

// ── Config helpers ────────────────────────────────────────────────────────────

function getEffectiveConfig(countryCode) {
  const base     = { ...scoringConfig };
  const override = scoringConfig.regionalOverrides?.[countryCode];
  if (!override) return base;

  return {
    ...base,
    global: { ...base.global, ...override },
    authorityMultipliers: {
      ...base.authorityMultipliers,
      ...(override.authorityMultipliers || {}),
    },
  };
}

function mergeWeights(cfgWeights, userWeights = {}) {
  // User weights from Params sliders (0–1 each, should sum to 1)
  const out = { ...cfgWeights };
  const keys = ['rating_weight', 'volume_weight', 'recency_weight', 'authority_weight', 'trend_weight', 'local_source_weight'];
  // Map slider names to config names
  if (userWeights.rating)   out.rating_weight        = userWeights.rating;
  if (userWeights.reviews)  out.volume_weight         = userWeights.reviews;
  if (userWeights.value)    out.recency_weight        = userWeights.value;
  if (userWeights.features) out.local_source_weight   = userWeights.features;
  return out;
}

function extractTrendSignal(signals = []) {
  const trendRec = signals.find(s => s.sourceId === 'trends');
  const redditRec = signals.find(s => s.sourceId === 'reddit');
  if (!trendRec && !redditRec) return null;

  return {
    trending:   trendRec?.trending || false,
    trendScore: (trendRec?.trendScore || 0) * 0.6 + (redditRec?.trendScore || 0) * 0.4,
    momentum:   trendRec?.momentum || 1,
    redditPosts: redditRec?.redditPosts || [],
  };
}

module.exports = { scoreAndRank };
