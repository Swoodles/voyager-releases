// src/cache/cache-manager.js
// Redis-first cache with in-memory fallback.
// TTLs are category-aware and configurable.

const TTL = {
  restaurant:  24 * 60 * 60,      // 24 hours
  cafe:        24 * 60 * 60,
  bar:         24 * 60 * 60,
  bakery:      24 * 60 * 60,
  hotel:       12 * 60 * 60,      // 12 hours
  attraction:   7 * 24 * 60 * 60, // 7 days
  museum:       7 * 24 * 60 * 60,
  event:        2 * 60 * 60,      // 2 hours
  trending:     1 * 60 * 60,      // 1 hour
  itinerary:   72 * 60 * 60,      // 3 days (user-scoped)
  general:     24 * 60 * 60,
};

// ── In-memory fallback store ──────────────────────────────────────────────────
const _mem = new Map();
let   _redis = null;

function normaliseKey(parts) {
  return parts
    .map(p => String(p).toLowerCase().trim().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,''))
    .join(':');
}

// ── Redis client (lazy init) ──────────────────────────────────────────────────
async function getRedis() {
  if (_redis) return _redis;
  if (!process.env.REDIS_URL) return null;

  try {
    const redis = await import('redis');
    _redis = redis.createClient({ url: process.env.REDIS_URL });
    _redis.on('error', err => {
      console.warn('[cache] Redis error:', err.message);
      _redis = null;
    });
    await _redis.connect();
    console.log('[cache] Redis connected');
    return _redis;
  } catch (err) {
    console.warn('[cache] Redis unavailable, using in-memory fallback:', err.message);
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get a cached value.
 * @param {string[]} keyParts   - e.g. ['search', 'tokyo', 'ramen', '5km']
 * @returns {any|null}
 */
async function get(keyParts) {
  const key = normaliseKey(keyParts);
  const r   = await getRedis();

  if (r) {
    try {
      const raw = await r.get(`voyager:${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch { /* fall through to memory */ }
  }

  const entry = _mem.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) { _mem.delete(key); return null; }
  return entry.value;
}

/**
 * Set a cached value.
 * @param {string[]} keyParts
 * @param {any}      value
 * @param {string}   category   - Used to look up TTL
 * @param {boolean}  [trending] - Use shorter TTL if trending
 */
async function set(keyParts, value, category = 'general', trending = false) {
  const key = normaliseKey(keyParts);
  const ttl = trending ? TTL.trending : (TTL[category] || TTL.general);
  const r   = await getRedis();

  if (r) {
    try {
      await r.setEx(`voyager:${key}`, ttl, JSON.stringify(value));
      return;
    } catch { /* fall through to memory */ }
  }

  _mem.set(key, { value, exp: Date.now() + ttl * 1000 });
}

/**
 * Invalidate a key.
 */
async function invalidate(keyParts) {
  const key = normaliseKey(keyParts);
  const r   = await getRedis();
  if (r) await r.del(`voyager:${key}`).catch(() => {});
  _mem.delete(key);
}

/**
 * Clear all Voyager cache entries (admin use).
 */
async function clearAll() {
  const r = await getRedis();
  if (r) {
    const keys = await r.keys('voyager:*').catch(() => []);
    if (keys.length) await r.del(keys);
  }
  _mem.clear();
}

/**
 * Return cache stats for the admin panel.
 */
async function stats() {
  const r = await getRedis();
  const redisKeys = r ? (await r.keys('voyager:*').catch(() => [])).length : 0;
  return {
    backend:   r ? 'redis' : 'memory',
    redisKeys,
    memKeys:   _mem.size,
  };
}

// Prune expired memory entries every 30 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _mem.entries()) {
    if (now > v.exp) _mem.delete(k);
  }
}, 30 * 60 * 1000);

module.exports = { get, set, invalidate, clearAll, stats, TTL };
