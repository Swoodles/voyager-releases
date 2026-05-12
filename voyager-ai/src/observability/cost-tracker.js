// src/observability/cost-tracker.js
// Tracks token usage, API costs, latency, and cache hit rates.
// In-memory for dev; writes to DB in production (see db/client.js).

const _log = [];           // ring buffer of recent events
const MAX_LOG = 1000;

let _dailyCost    = 0;
let _dailyReset   = todayKey();
let _cacheHits    = 0;
let _cacheMisses  = 0;
let _totalRequests = 0;

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function checkDayRollover() {
  const today = todayKey();
  if (today !== _dailyReset) {
    _dailyCost  = 0;
    _dailyReset = today;
  }
}

/**
 * Record an LLM call.
 */
async function record({ provider, model, inputTokens, outputTokens, costUsd, queryTier, latencyMs }) {
  checkDayRollover();
  _dailyCost += costUsd || 0;

  const entry = {
    ts:           new Date().toISOString(),
    type:         'llm',
    provider,
    model,
    inputTokens,
    outputTokens,
    costUsd:      Math.round(costUsd * 1e6) / 1e6,
    queryTier,
    latencyMs,
  };

  _log.push(entry);
  if (_log.length > MAX_LOG) _log.shift();

  // In production: write to DB
  // await db.query('INSERT INTO cost_log (...) VALUES (...)', [...]);
}

/**
 * Record a full request (for latency + cache tracking).
 */
function recordRequest({ cacheHit, tier, latencyMs, sourcesUsed }) {
  _totalRequests++;
  if (cacheHit) _cacheHits++;
  else          _cacheMisses++;

  _log.push({
    ts: new Date().toISOString(),
    type: 'request',
    cacheHit,
    tier,
    latencyMs,
    sourcesUsed,
  });
  if (_log.length > MAX_LOG) _log.shift();
}

/**
 * Record a source API call failure.
 */
function recordSourceFailure(sourceId, errorMsg) {
  _log.push({
    ts: new Date().toISOString(),
    type: 'source_failure',
    sourceId,
    error: errorMsg,
  });
  if (_log.length > MAX_LOG) _log.shift();
}

async function getDailyCost() {
  checkDayRollover();
  return _dailyCost;
}

function getMetrics() {
  checkDayRollover();
  const llmCalls    = _log.filter(e => e.type === 'llm');
  const reqLogs     = _log.filter(e => e.type === 'request');
  const failures    = _log.filter(e => e.type === 'source_failure');
  const avgLatency  = reqLogs.length
    ? Math.round(reqLogs.reduce((s, r) => s + (r.latencyMs || 0), 0) / reqLogs.length)
    : 0;

  return {
    totalRequests:   _totalRequests,
    cacheHits:       _cacheHits,
    cacheMisses:     _cacheMisses,
    cacheHitRate:    _totalRequests ? Math.round(_cacheHits / _totalRequests * 100) : 0,
    dailyCostUsd:    Math.round(_dailyCost * 10000) / 10000,
    llmCallsToday:   llmCalls.length,
    avgLatencyMs:    avgLatency,
    sourceFailures:  failures.length,
    recentLog:       _log.slice(-50),
    tierBreakdown:   {
      tier1: reqLogs.filter(r => r.tier === 1).length,
      tier2: reqLogs.filter(r => r.tier === 2).length,
      tier3: reqLogs.filter(r => r.tier === 3).length,
    },
  };
}

module.exports = { record, recordRequest, recordSourceFailure, getDailyCost, getMetrics };
