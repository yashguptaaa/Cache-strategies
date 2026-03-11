/**
 * stale-revalidate.js — Stale-while-revalidate for cache stampede prevention
 *
 * Return cached value immediately (fresh or stale). If stale, trigger background
 * revalidation so the next request gets fresh data. Uses cache.getWithExpiry/setWithExpiry.
 */

const LOG = {
  CACHE_HIT: () => console.log('[CACHE_HIT] products'),
  CACHE_MISS: () => console.log('[CACHE_MISS] products'),
  STALE_SERVED: () => console.log('[STALE_SERVED] products'),
  REVALIDATE_STARTED: () => console.log('[REVALIDATE_STARTED] products'),
  DB_QUERY_EXECUTED: () => console.log('[DB_QUERY_EXECUTED] products'),
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

  const now = Date.now();
  if (now <= stored.expiresAt) {
    LOG.CACHE_HIT();
    return stored.data;
  }

  LOG.STALE_SERVED();
  setImmediate(async () => {
    LOG.REVALIDATE_STARTED();
    try {
      LOG.DB_QUERY_EXECUTED();
      const data = await db.getAllProducts();
      if (data && data.length >= 0) await cache.setWithExpiry(key, data, ttlSec);
    } catch (err) {
      console.error('[stale-revalidate] revalidate failed:', err.message);
    }
  });
  return stored.data;
}

module.exports = { getAllProducts };
