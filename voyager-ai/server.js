// server.js — Voyager AI v2
// Entry point. Starts Express, registers routes, fires background jobs.

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const searchRoute = require('./src/routes/search');
const scheduler   = require('./src/jobs/scheduler');
const costTracker = require('./src/observability/cost-tracker');

const app  = express();
const PORT = process.env.VOYAGER_AI_PORT || 3747;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/search', searchRoute);

// Health check — ai_bridge.py watches for VOYAGER_AI_READY in stdout
app.get('/health', (req, res) => {
  res.json({
    ok:      true,
    service: 'voyager-ai',
    version: '2.0.0',
    uptime:  process.uptime(),
  });
});

// Quick metrics endpoint
app.get('/metrics', (req, res) => {
  res.json({ ok: true, ...costTracker.getMetrics() });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`VOYAGER_AI_READY port=${PORT}`);

  // Start background jobs (trend refresh, city precompute, cache cleanup)
  if (process.env.DISABLE_JOBS !== 'true') {
    scheduler.startAll();
  }
});

process.on('SIGTERM', () => {
  scheduler.stopAll();
  console.log('[server] Shutting down');
  process.exit(0);
});
