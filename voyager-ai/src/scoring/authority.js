// src/scoring/authority.js
// Detects authority signals from structured metadata + web verification.
// Badges are NEVER LLM-inferred — only confirmed from structured sources.

const KNOWN_MICHELIN_CITIES = new Set([
  'tokyo','osaka','kyoto','fukuoka','sapporo','yokohama',
  'paris','lyon','bordeaux','strasbourg','nice',
  'rome','milan','florence','venice','naples',
  'madrid','barcelona','san sebastian','bilbao',
  'london','edinburgh',
  'new york','chicago','san francisco','los angeles',
  'hong kong','singapore','bangkok',
  'copenhagen','stockholm','amsterdam','zurich',
]);

/**
 * Build authority badges for a candidate from structured data.
 * Call this after source data is merged but before scoring.
 *
 * @param {object} candidate
 * @param {object} geoMeta
 * @returns {string[]} badge IDs (matching scoring.json authorityMultipliers keys)
 */
function detectAuthorityBadges(candidate, geoMeta) {
  const badges = [...(candidate.authorityBadges || [])];

  // Michelin detection — from explicit source metadata (SerpAPI Michelin check)
  if (candidate._michelinTier) {
    const tierMap = {
      threeStar: 'michelin_3_star',
      twoStar:   'michelin_2_star',
      oneStar:   'michelin_1_star',
      bibGourmand: 'michelin_bib',
      listed:    'michelin_listed',
    };
    const badge = tierMap[candidate._michelinTier];
    if (badge && !badges.includes(badge)) badges.push(badge);
  }

  // Tabelog tier detection (from tabelog adapter metadata)
  if (candidate.sourceId === 'tabelog' && candidate._tabelogTier) {
    const tierMap = { gold: 'tabelog_gold', silver: 'tabelog_silver', bronze: 'tabelog_bronze' };
    const badge   = tierMap[candidate._tabelogTier];
    if (badge && !badges.includes(badge)) badges.push(badge);
  }

  // High-rating heuristic for high-volume local sources
  // (NOT a substitute for real badge detection — just a soft signal)
  if (candidate.sourceId === 'tabelog' && candidate.rating >= 4.5 && candidate.reviewCount >= 200) {
    if (!badges.some(b => b.startsWith('tabelog_'))) badges.push('tabelog_bronze');
  }

  return [...new Set(badges)];
}

/**
 * Build the display badge list for UI rendering.
 * Maps internal badge IDs to display strings.
 */
function buildDisplayBadges(badgeIds = []) {
  const displayMap = {
    michelin_3_star:  '⭐⭐⭐ Michelin',
    michelin_2_star:  '⭐⭐ Michelin',
    michelin_1_star:  '⭐ Michelin',
    michelin_bib:     'Michelin Bib Gourmand',
    michelin_listed:  'Michelin Listed',
    tabelog_gold:     '🥇 Tabelog Gold',
    tabelog_silver:   '🥈 Tabelog Silver',
    tabelog_bronze:   '🥉 Tabelog Bronze',
    james_beard:      '🏆 James Beard',
    worlds_50_best:   '🌍 World\'s 50 Best',
    zagat:            '📖 Zagat',
    editorial_major:  '📰 Major Editorial',
    editorial_minor:  '📰 Editorial Pick',
  };

  return badgeIds.map(id => displayMap[id]).filter(Boolean);
}

/**
 * Check if a city is in a Michelin-covered region.
 * Used to decide whether to run Michelin verification.
 */
function isMichelinCity(location = '') {
  return KNOWN_MICHELIN_CITIES.has(location.toLowerCase().split(',')[0].trim());
}

module.exports = { detectAuthorityBadges, buildDisplayBadges, isMichelinCity };
