// src/ai/llm-client.js
// Single interface for all LLM providers.
// Switch providers in models.json without touching this file or callers.

const modelsConfig  = require('../config/models.json');
const costTracker   = require('../observability/cost-tracker');
const { estimateCost } = require('../router/model-router');

/**
 * Call the active LLM with a prompt.
 *
 * @param {{ system: string, user: string }} prompt
 * @param {object} modelConf   - From model-router.getModelForTier()
 * @returns {Promise<string>}  - Raw text response
 */
async function callLLM(prompt, modelConf) {
  if (!modelConf) throw new Error('No model config provided');

  const provider = modelsConfig.providers[modelConf.provider];
  if (!provider) throw new Error(`Unknown provider: ${modelConf.provider}`);

  let text, usage;

  switch (modelConf.provider) {
    case 'claude':
      ({ text, usage } = await callClaude(prompt, modelConf));
      break;
    case 'openai':
      ({ text, usage } = await callOpenAI(prompt, modelConf));
      break;
    case 'gemini':
      ({ text, usage } = await callGemini(prompt, modelConf));
      break;
    default:
      throw new Error(`No implementation for provider: ${modelConf.provider}`);
  }

  // Track cost
  const cost = estimateCost(modelConf, usage.inputTokens, usage.outputTokens);
  await costTracker.record({
    provider:   modelConf.provider,
    model:      modelConf.model,
    inputTokens:  usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd:    cost,
  });

  return text;
}

// ── Provider implementations ──────────────────────────────────────────────────

async function callClaude({ system, user }, modelConf) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const res = await fetch(modelConf.apiBase, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': modelConf.versionHeader || '2023-06-01',
    },
    body: JSON.stringify({
      model:      modelConf.model,
      max_tokens: modelConf.maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err}`);
  }

  const data = await res.json();
  return {
    text:  data.content?.[0]?.text || '',
    usage: {
      inputTokens:  data.usage?.input_tokens  || 0,
      outputTokens: data.usage?.output_tokens || 0,
    },
  };
}

async function callOpenAI({ system, user }, modelConf) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const res = await fetch(modelConf.apiBase, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:      modelConf.model,
      max_tokens: modelConf.maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${err}`);
  }

  const data = await res.json();
  return {
    text:  data.choices?.[0]?.message?.content || '',
    usage: {
      inputTokens:  data.usage?.prompt_tokens     || 0,
      outputTokens: data.usage?.completion_tokens || 0,
    },
  };
}

async function callGemini({ system, user }, modelConf) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const url = `${modelConf.apiBase}/${modelConf.model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${system}\n\n${user}` }] }],
      generationConfig: { maxOutputTokens: modelConf.maxTokens },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return {
    text,
    usage: {
      inputTokens:  data.usageMetadata?.promptTokenCount     || 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
    },
  };
}

/**
 * Parse JSON from LLM output safely — strips markdown fences if present.
 */
function parseJSONResponse(raw) {
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error('LLM returned non-parseable JSON');
  }
}

module.exports = { callLLM, parseJSONResponse };
