// src/router/query-classifier.js
// Deterministic tier routing — classifies query complexity WITHOUT an LLM call.
// Tier 1 → API only, no LLM
// Tier 2 → cheap LLM reranking + snippet
// Tier 3 → premium LLM for planning/itinerary

// ── Patterns ──────────────────────────────────────────────────────────────────

const TIER3_PATTERNS = [
  /\b(\d+)[\s-]day\b/i,
  /\bitinerary\b/i,
  /\bweekend (in|trip|getaway)\b/i,
  /\bplan (a|my|the|an)\b/i,
  /\bfull day\b/i,
  /\btrip (through|across|around)\b/i,
  /\broute (through|from|between)\b/i,
  /\bcompare\b.*\bvs\b/i,
  /\bshould i (go|visit|stay)\b/i,
  /\bbest way to spend\b/i,
  /\bpacking list\b/i,
  /\bbudget breakdown\b/i,
  /\ball-inclusive\b/i,
  /\bhoneymoon\b/i,
  /\bromantic (trip|getaway|weekend)\b/i,
  /\bfoodie (tour|trip|weekend|day)\b/i,
];

const TIER2_PATTERNS = [
  /\bquiet\b/i,
  /\bauthentic\b/i,
  /\bhidden gem\b/i,
  /\blocal (favourite|favorite|spot|pick)\b/i,
  /\bunder \$?\d+\b/i,
  /\bcheap\b/i,
  /\bbest\b.*\bfor\b/i,
  /\btop rated\b/i,
  /\bworth (it|visiting|going)\b/i,
  /\bnear\b.*\b(station|metro|airport|hotel)\b/i,
  /\bopen (late|early|now|Sunday|weekend)\b/i,
  /\bvegan\b|\bgluten[\s-]free\b|\bhalal\b|\bkosher\b/i,
  /\bdog[\s-]friendly\b|\bkid[\s-]friendly\b/i,
  /\bout?door seating\b/i,
  /\brecommend\b/i,
  /\bsuggest\b/i,
  /\bhighly rated\b/i,
  /\btrendingb/i,
  /\bpopular with locals\b/i,
  /\bnot touristy\b/i,
];

// Simple location + category, no qualifiers
const TIER1_CATEGORIES = [
  'restaurants', 'restaurant', 'cafes', 'cafe', 'coffee', 'bars', 'bar', 'pubs', 'pub',
  'museums', 'museum', 'attractions', 'sights', 'sightseeing', 'things to do',
  'hotels', 'bakeries', 'bakery', 'nightlife', 'shops', 'shopping',
];

// ── Classifier ────────────────────────────────────────────────────────────────

/**
 * Classify a query into Tier 1, 2, or 3.
 *
 * @param {string} query
 * @returns {{ tier: 1|2|3, reason: string, intent: object }}
 */
function classifyQuery(query) {
  const q = query.trim();

  // Tier 3 — planning / itinerary
  for (const pattern of TIER3_PATTERNS) {
    if (pattern.test(q)) {
      return {
        tier:   3,
        reason: `Matched tier-3 pattern: ${pattern}`,
        intent: extractIntent(q),
      };
    }
  }

  // Tier 2 — qualified search
  for (const pattern of TIER2_PATTERNS) {
    if (pattern.test(q)) {
      return {
        tier:   2,
        reason: `Matched tier-2 pattern: ${pattern}`,
        intent: extractIntent(q),
      };
    }
  }

  // Tier 1 — simple category + location
  // Heuristic: short query (<= 5 words) OR simple category hit
  const words  = q.split(/\s+/);
  const isSimpleCategory = TIER1_CATEGORIES.some(cat => q.toLowerCase().includes(cat));
  if (words.length <= 5 || isSimpleCategory) {
    return {
      tier:   1,
      reason: 'Simple location+category query',
      intent: extractIntent(q),
    };
  }

  // Default to tier 2 for anything unclassified with >5 words
  return {
    tier:   2,
    reason: 'Default: moderate complexity',
    intent: extractIntent(q),
  };
}

/**
 * Extract structured intent from the query.
 * Purely regex/keyword — no LLM.
 */
function extractIntent(query) {
  const q = query.toLowerCase();

  // Category detection
  const categories = [
    { key: 'restaurant', terms: ['restaurant', 'ramen', 'sushi', 'pizza', 'dinner', 'lunch', 'brunch', 'food', 'eat', 'cuisine', 'bistro', 'brasserie'] },
    { key: 'cafe',       terms: ['cafe', 'café', 'coffee', 'latte', 'espresso', 'tea'] },
    { key: 'bar',        terms: ['bar', 'pub', 'cocktail', 'beer', 'wine bar', 'nightlife', 'drinks'] },
    { key: 'hotel',      terms: ['hotel', 'hostel', 'stay', 'accommodation', 'airbnb', 'lodge', 'inn'] },
    { key: 'attraction', terms: ['attraction', 'museum', 'temple', 'shrine', 'castle', 'gallery', 'park', 'landmark', 'sightseeing', 'monument'] },
    { key: 'bakery',     terms: ['bakery', 'pastry', 'patisserie', 'bread', 'croissant'] },
    { key: 'itinerary',  terms: ['itinerary', 'plan', 'day trip', 'weekend', 'schedule', 'route'] },
  ];

  let detectedCategory = 'general';
  for (const cat of categories) {
    if (cat.terms.some(t => q.includes(t))) {
      detectedCategory = cat.key;
      break;
    }
  }

  // Budget detection
  const budgetMatch = q.match(/under\s+\$?(\d+)/i) || q.match(/\$(\d+)\s+budget/i);
  const budget = budgetMatch ? parseInt(budgetMatch[1]) : null;

  // Duration detection (for tier 3)
  const durationMatch = q.match(/(\d+)[\s-]day/i);
  const duration = durationMatch ? parseInt(durationMatch[1]) : null;

  // Dietary
  const dietary = [];
  if (/vegan/i.test(q))                dietary.push('vegan');
  if (/vegetarian/i.test(q))           dietary.push('vegetarian');
  if (/gluten[\s-]free/i.test(q))      dietary.push('gluten-free');
  if (/halal/i.test(q))                dietary.push('halal');
  if (/kosher/i.test(q))               dietary.push('kosher');

  // Modifiers
  const modifiers = [];
  if (/authentic|local favourite|not touristy/i.test(q)) modifiers.push('authentic');
  if (/quiet|peaceful|calm/i.test(q))    modifiers.push('quiet');
  if (/cheap|budget|affordable/i.test(q)) modifiers.push('budget');
  if (/luxury|fine dining|upscale/i.test(q)) modifiers.push('luxury');
  if (/hidden gem/i.test(q))            modifiers.push('hidden');
  if (/trending|popular|hottest/i.test(q)) modifiers.push('trending');

  return {
    category:  detectedCategory,
    budget,
    duration,
    dietary,
    modifiers,
    isPlanning: detectedCategory === 'itinerary' || duration !== null,
  };
}

module.exports = { classifyQuery, extractIntent };
