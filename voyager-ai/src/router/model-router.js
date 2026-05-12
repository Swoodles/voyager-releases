// src/router/model-router.js
// Selects which LLM (provider + model) to use based on tier and budget guards.
// Provider and model strings live entirely in models.json.

const modelsConfig  = require('../config/models.json');
const costTracker   = require('../observability/cost-tracker');

/**
 * Get the model config for a given tier.
 * Returns null for tier 1 (no LLM).
 *
 * @param {1|2|3} tier
 * @returns {{ provider, model, maxTokens, apiBase, headerKey } | null}
 */
async function getModelForTier(tier) {
  const assignment = modelsConfig.tierAssignments[`tier${tier}`];
  if (!assignment || !assignment.useLLM) return null;

  // Budget guard — fall back to tier 1 if daily limit hit
  if (modelsConfig.budgetGuards.fallback_to_tier1_on_limit) {
    const todayCost = await costTracker.getDailyCost();
    if (todayCost >= modelsConfig.budgetGuards.daily_cost_limit_usd) {
      console.warn(`[model-router] Daily budget limit reached ($${todayCost.toFixed(2)}) — falling back to no-LLM`);
      return null;
    }
  }

  const providerName = modelsConfig.activeProvider;
  const providerConf = modelsConfig.providers[providerName];
  if (!providerConf) throw new Error(`Unknown provider: ${providerName}`);

  const modelStr = assignment.modelClass === 'cheap'
    ? providerConf.cheap
    : providerConf.premium;

  return {
    provider:   providerName,
    model:      modelStr,
    maxTokens:  assignment.maxTokens,
    apiBase:    providerConf.apiBase,
    headerKey:  providerConf.headerKey || 'Authorization',
    versionHeader: providerConf.versionHeader || null,
  };
}

/**
 * Estimate cost for a given token count + model.
 */
function estimateCost(modelConf, inputTokens, outputTokens) {
  if (!modelConf) return 0;
  const cc = modelsConfig.costTracking[modelConf.provider];
  if (!cc) return 0;

  const modelKey = modelConf.model.toLowerCase();
  let inputRate = 0, outputRate = 0;

  if (modelKey.includes('haiku')) {
    inputRate  = cc.haiku_input_per_1k  || 0;
    outputRate = cc.haiku_output_per_1k || 0;
  } else if (modelKey.includes('sonnet')) {
    inputRate  = cc.sonnet_input_per_1k  || 0;
    outputRate = cc.sonnet_output_per_1k || 0;
  } else if (modelKey.includes('mini')) {
    inputRate  = cc.mini_input_per_1k  || 0;
    outputRate = cc.mini_output_per_1k || 0;
  } else if (modelKey.includes('gpt-4o')) {
    inputRate  = cc.gpt4o_input_per_1k  || 0;
    outputRate = cc.gpt4o_output_per_1k || 0;
  }

  return (inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate;
}

module.exports = { getModelForTier, estimateCost };
