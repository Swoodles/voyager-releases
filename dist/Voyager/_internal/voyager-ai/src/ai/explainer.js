// src/ai/explainer.js
// AI's ONLY job: explain scores, synthesise sentiment, write snippets.
// Never asked to find, score, or verify facts.

const { callLLM, parseJSONResponse } = require('./llm-client');
const { getModelForTier }            = require('../router/model-router');

// ── Tier 2: Rerank + snippet ──────────────────────────────────────────────────

const TIER2_SYSTEM = `You are a travel recommendation assistant.
Your task is to produce SHORT, accurate explanations for pre-scored restaurant/place results.
Never invent facts. Only comment on what's in the data provided.
Return ONLY valid JSON. No markdown, no preamble.`;

/**
 * Generate a one-line snippet for each scored candidate.
 * Tiny token footprint — one line per place.
 *
 * @param {object[]} scoredCandidates  - From scoring engine
 * @param {string}   query
 * @param {object}   geoMeta
 * @returns {Promise<object[]>} candidates enriched with .aiSnippet
 */
async function generateSnippets(scoredCandidates, query, geoMeta) {
  const modelConf = await getModelForTier(2);
  if (!modelConf) return scoredCandidates; // tier 1 — no LLM

  // Only generate snippets for top 6 to keep tokens minimal
  const toEnrich = scoredCandidates.slice(0, 6);

  const listText = toEnrich.map((c, i) =>
    `${i+1}. ${c.name} | Rating:${c.rating?.toFixed(1)||'?'} | Reviews:${c.reviewCount||0} | Local score:${c._localScore} | Tourist score:${c._touristScore} | Badges:${(c.authorityBadges||[]).join(',')||'none'}`
  ).join('\n');

  const userPrompt = `Query: "${query}" (${geoMeta.countryName})

Places:
${listText}

For each place, write one sentence (max 15 words) explaining why it's worth visiting or what makes it unique.
Return JSON array: [{"index":1,"snippet":"..."},...]`;

  try {
    const raw      = await callLLM({ system: TIER2_SYSTEM, user: userPrompt }, modelConf);
    const snippets = parseJSONResponse(raw);

    const snippetMap = {};
    snippets.forEach(s => { snippetMap[s.index] = s.snippet; });

    return scoredCandidates.map((c, i) => ({
      ...c,
      aiSnippet: i < 6 ? (snippetMap[i+1] || null) : null,
    }));
  } catch (err) {
    console.error('[explainer] Snippet generation failed:', err.message);
    return scoredCandidates;
  }
}

// ── Tier 2: Gap explanation ───────────────────────────────────────────────────

/**
 * Explain a significant local/tourist score gap for the top result.
 * Only called when |localScore - touristScore| >= 10.
 */
async function explainScoreGap(candidate, geoMeta) {
  const modelConf = await getModelForTier(2);
  if (!modelConf) return null;

  const gap = candidate._localScore - candidate._touristScore;
  if (Math.abs(gap) < 10) return null;

  const direction = gap > 0 ? 'locals rate it significantly higher than tourists' : 'tourists rate it significantly higher than locals';

  const userPrompt = `Place: ${candidate.name} in ${geoMeta.countryName}
Local score: ${candidate._localScore}/100
Tourist score: ${candidate._touristScore}/100
Sources: ${(candidate._sourcesUsed || []).join(', ')}

In ONE sentence (max 20 words), explain why ${direction}.
Return JSON: {"explanation":"..."}`;

  try {
    const raw    = await callLLM({ system: TIER2_SYSTEM, user: userPrompt }, modelConf);
    const result = parseJSONResponse(raw);
    return result.explanation || null;
  } catch {
    return null;
  }
}

// ── Tier 3: Itinerary generation ──────────────────────────────────────────────

const TIER3_SYSTEM = `You are an expert travel planner.
Generate detailed, realistic travel itineraries based on the provided structured place data.
Only reference places and facts from the provided data — never invent addresses, hours, or prices.
Be specific, practical, and personalised to the user's request.
Return ONLY valid JSON.`;

/**
 * Generate a multi-day itinerary from pre-scored candidates.
 *
 * @param {string}   query          - Original user request
 * @param {object[]} candidates     - Scored candidates to use
 * @param {object}   intent         - { duration, modifiers, dietary, budget }
 * @param {object}   geoMeta
 * @returns {Promise<object>}       - Structured itinerary
 */
async function generateItinerary(query, candidates, intent, geoMeta) {
  const modelConf = await getModelForTier(3);
  if (!modelConf) throw new Error('Premium model not available (budget limit reached)');

  const days = intent.duration || 3;
  const placeList = candidates.slice(0, 20).map(c =>
    `- ${c.name} (${c.category}) | ${c.priceRange||'?'} | Score:${c._score} | Local:${c._localScore} | ${c.authorityBadges?.join(',')||'no awards'} | ${c.aiSnippet || c.description?.slice(0,60) || ''}`
  ).join('\n');

  const userPrompt = `User request: "${query}"
Location: ${geoMeta.countryName}
Duration: ${days} days
Modifiers: ${intent.modifiers?.join(', ')||'none'}
Dietary: ${intent.dietary?.join(', ')||'none'}
Budget: ${intent.budget ? `$${intent.budget}/day` : 'flexible'}

Available places:
${placeList}

Generate a ${days}-day itinerary using these places.
Return JSON:
{
  "title": "...",
  "summary": "...",
  "days": [
    {
      "day": 1,
      "theme": "...",
      "morning": { "place": "...", "activity": "...", "tip": "..." },
      "lunch":   { "place": "...", "activity": "...", "tip": "..." },
      "afternoon":{ "place":"...", "activity":"...", "tip":"..." },
      "dinner":  { "place": "...", "activity": "...", "tip": "..." },
      "evening": { "place": "...", "activity": "...", "tip": "..." }
    }
  ],
  "tips": ["...", "..."],
  "estimatedBudget": "..."
}`;

  const raw    = await callLLM({ system: TIER3_SYSTEM, user: userPrompt }, modelConf);
  return parseJSONResponse(raw);
}

// ── Tier 3: Deep comparison ───────────────────────────────────────────────────

/**
 * Compare two or more candidates in depth.
 */
async function compareOptions(candidates, query, geoMeta) {
  const modelConf = await getModelForTier(2); // Comparison is tier 2 (cheap)
  if (!modelConf) return null;

  const placeList = candidates.slice(0, 5).map((c, i) =>
    `${i+1}. ${c.name} | Rating:${c.rating?.toFixed(1)||'?'} | Price:${c.priceRange||'?'} | Local:${c._localScore} | Tourist:${c._touristScore} | Badges:${c.authorityBadges?.join(',')||'none'}`
  ).join('\n');

  const userPrompt = `Query: "${query}" — ${geoMeta.countryName}

Options:
${placeList}

Compare these options. Return JSON:
{
  "recommendation": "Place name here",
  "reasoning": "2-3 sentence explanation",
  "tradeoffs": [{"place":"...","pro":"...","con":"..."}]
}`;

  try {
    const raw = await callLLM({ system: TIER2_SYSTEM, user: userPrompt }, modelConf);
    return parseJSONResponse(raw);
  } catch {
    return null;
  }
}

module.exports = { generateSnippets, explainScoreGap, generateItinerary, compareOptions };
