-- src/db/schema.sql
-- Complete Voyager AI database schema.
-- Run against your existing Supabase PostgreSQL instance.
-- Extends existing voyager_users, voyager_shared_trips, voyager_friends tables.

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- fuzzy name matching

-- ── Places cache ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voy_places (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  external_id     TEXT NOT NULL,              -- source:place_id
  source_id       TEXT NOT NULL,
  name            TEXT NOT NULL,
  category        TEXT,
  country_code    CHAR(2),
  city            TEXT,
  address         TEXT,
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  rating          DECIMAL(3,2),
  review_count    INTEGER DEFAULT 0,
  local_review_ratio DECIMAL(4,3),
  price_range     TEXT,
  website         TEXT,
  phone           TEXT,
  image_url       TEXT,
  description     TEXT,
  features        JSONB DEFAULT '[]',
  authority_badges JSONB DEFAULT '[]',
  hours           JSONB,
  is_open         BOOLEAN,
  trend_score     DECIMAL(4,3),
  last_review_date DATE,
  raw_data        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(external_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_places_country_category ON voy_places(country_code, category);
CREATE INDEX IF NOT EXISTS idx_places_city ON voy_places(city);
CREATE INDEX IF NOT EXISTS idx_places_name_trgm ON voy_places USING gin(name gin_trgm_ops);

-- ── Search result cache ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voy_search_cache (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cache_key    TEXT NOT NULL UNIQUE,
  query        TEXT NOT NULL,
  country_code CHAR(2),
  category     TEXT,
  tier         SMALLINT,              -- 1, 2, or 3
  result_json  JSONB NOT NULL,
  hit_count    INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_cache_key ON voy_search_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_search_cache_expires ON voy_search_cache(expires_at);

-- ── Scoring config (admin-adjustable) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voy_scoring_config (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_key   TEXT NOT NULL UNIQUE,  -- e.g. 'global', 'JP', 'FR'
  config_json  JSONB NOT NULL,
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── AI conversations ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voy_ai_conversations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES voyager_users(id) ON DELETE CASCADE,
  session_id   TEXT,
  query        TEXT NOT NULL,
  tier         SMALLINT,
  response_json JSONB,
  tokens_in    INTEGER DEFAULT 0,
  tokens_out   INTEGER DEFAULT 0,
  cost_usd     DECIMAL(10,6) DEFAULT 0,
  latency_ms   INTEGER,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON voy_ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_session ON voy_ai_conversations(session_id);

-- ── Cost / observability log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voy_cost_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ts           TIMESTAMPTZ DEFAULT NOW(),
  event_type   TEXT,               -- 'llm' | 'request' | 'source_failure'
  provider     TEXT,
  model        TEXT,
  tokens_in    INTEGER DEFAULT 0,
  tokens_out   INTEGER DEFAULT 0,
  cost_usd     DECIMAL(10,6) DEFAULT 0,
  query_tier   SMALLINT,
  latency_ms   INTEGER,
  cache_hit    BOOLEAN,
  source_id    TEXT,               -- for source_failure events
  error_msg    TEXT
);

CREATE INDEX IF NOT EXISTS idx_cost_log_ts ON voy_cost_log(ts);
CREATE INDEX IF NOT EXISTS idx_cost_log_type ON voy_cost_log(event_type);

-- ── Trend scores (precomputed) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voy_trend_scores (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  place_id     UUID REFERENCES voy_places(id) ON DELETE CASCADE,
  country_code CHAR(2),
  category     TEXT,
  trend_score  DECIMAL(4,3),
  momentum     DECIMAL(6,3),
  is_trending  BOOLEAN DEFAULT FALSE,
  source       TEXT,               -- 'google_trends' | 'reddit' | 'social'
  computed_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(place_id, source)
);

-- ── User itineraries (AI-generated) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voy_ai_itineraries (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES voyager_users(id) ON DELETE CASCADE,
  trip_id      UUID,               -- references user's trip
  title        TEXT,
  query        TEXT,
  itinerary_json JSONB NOT NULL,
  model_used   TEXT,
  cost_usd     DECIMAL(10,6),
  is_saved     BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_itineraries_user ON voy_ai_itineraries(user_id);

-- ── Feature flags (monetisation) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voy_feature_flags (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES voyager_users(id) ON DELETE CASCADE,
  plan         TEXT DEFAULT 'free', -- 'free' | 'premium' | 'enterprise'
  flags        JSONB DEFAULT '{}',  -- { ai_searches_remaining: 5, itinerary_enabled: false }
  reset_at     TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ── Row-level security ────────────────────────────────────────────────────────
ALTER TABLE voy_ai_conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE voy_ai_itineraries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE voy_feature_flags     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_conversations" ON voy_ai_conversations
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users_own_itineraries" ON voy_ai_itineraries
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users_own_flags" ON voy_feature_flags
  FOR ALL USING (auth.uid() = user_id);

-- ── Cleanup function (called by scheduler) ────────────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS INTEGER AS $$
DECLARE deleted INTEGER;
BEGIN
  DELETE FROM voy_search_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql;
