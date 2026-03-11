/**
 * cache-warming.js — Cache warming for cache stampede mitigation
 *
 * When serving from cache, if we're past a renew threshold (e.g. 80% of TTL),
 * trigger background refresh so cache stays warm. Uses getWithExpiry/setWithExpiry.
 */

const WARM_THRESHOLD = 0.8;
let refreshInProgress = false;

const LOG = {
  CACHE_HIT: () => console.log("[CACHE_HIT] products"),
  CACHE_MISS: () => console.log("[CACHE_MISS] products"),
  WARMING_TRIGGERED: () => console.log("[WARMING_TRIGGERED] products"),
  DB_QUERY_EXECUTED: () => console.log("[DB_QUERY_EXECUTED] products"),
};

async function getAllProducts(cache, db, key, ttlSec) {
  const stored = await cache.getWithExpiry(key);
  if (!stored) {
    LOG.CACHE_MISS();
    LOG.DB_QUERY_EXECUTED();
    const data = await db.getAllProducts();
    const result = data || [];
    await cache.setWithExpiry(key, result, ttlSec);
    return result;
  }

  LOG.CACHE_HIT();
  const now = Date.now();
  const remainingMs = stored.expiresAt - now;
  const ttlMs = ttlSec * 1000;
  if (remainingMs <= (1 - WARM_THRESHOLD) * ttlMs && !refreshInProgress) {
    refreshInProgress = true;
    setImmediate(async () => {
      try {
        LOG.WARMING_TRIGGERED();
        LOG.DB_QUERY_EXECUTED();
        const data = await db.getAllProducts();
        if (data && data.length >= 0)
          await cache.setWithExpiry(key, data, ttlSec);
      } catch (err) {
        console.error("[cache-warming] refresh failed:", err.message);
      } finally {
        refreshInProgress = false;
      }
    });
  }
  return stored.data;
}

module.exports = { getAllProducts };
