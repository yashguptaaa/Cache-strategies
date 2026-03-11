/**
 * tiered-cache.js — Tiered caching (L1 memory + L2 Redis) for cache stampede mitigation
 *
 * Read: L1 → L2 → DB. Write: set both L1 and L2. Reduces Redis load and latency for hot keys.
 */

const L1 = new Map();

const LOG = {
  L1_HIT: () => console.log('[L1_HIT] products'),
  L2_HIT: () => console.log('[L2_HIT] products'),
  CACHE_MISS: () => console.log('[CACHE_MISS] products'),
  DB_QUERY_EXECUTED: () => console.log('[DB_QUERY_EXECUTED] products'),
};

function l1Get(key, now) {
  const entry = L1.get(key);
  if (!entry) return null;
  if (now >= entry.expiresAt) {
    L1.delete(key);
    return null;
  }
  return entry.value;
}

function l1Set(key, value, ttlSec) {
  const expiresAt = Date.now() + ttlSec * 1000;
  L1.set(key, { value, expiresAt });
}

async function getAllProducts(cache, db, key, ttlSec) {
  const now = Date.now();
  const l1 = l1Get(key, now);
  if (l1 != null) {
    LOG.L1_HIT();
    return l1;
  }

  const l2 = await cache.get(key);
  if (l2 != null) {
    LOG.L2_HIT();
    l1Set(key, l2, ttlSec);
    return l2;
  }

  LOG.CACHE_MISS();
  LOG.DB_QUERY_EXECUTED();
  const data = await db.getAllProducts();
  const result = data || [];
  if (result.length >= 0) {
    l1Set(key, result, ttlSec);
    await cache.set(key, result, ttlSec);
  }
  return result;
}

module.exports = { getAllProducts };
