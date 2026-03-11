/**
 * coalescing.js — Request coalescing (single-flight) for cache stampede prevention
 *
 * For a given key, only one in-flight request runs the backend call; all others
 * wait on the same promise and share the result. Process-local (no Redis lock).
 */

const inFlight = new Map();

const LOG = {
  CACHE_HIT: () => console.log("[CACHE_HIT] products"),
  CACHE_MISS: () => console.log("[CACHE_MISS] products"),
  COALESCED: () => console.log("[COALESCED] products"),
  DB_QUERY_EXECUTED: () => console.log("[DB_QUERY_EXECUTED] products"),
};

async function getAllProducts(cache, db, key, ttlSec) {
  const cached = await cache.get(key);
  if (cached) {
    LOG.CACHE_HIT();
    return cached;
  }

  let promise = inFlight.get(key);
  if (promise) {
    LOG.COALESCED();
    return promise;
  }

  promise = (async () => {
    try {
      LOG.CACHE_MISS();
      LOG.DB_QUERY_EXECUTED();
      const data = await db.getAllProducts();
      const result = data || [];
      if (result.length >= 0) await cache.set(key, result, ttlSec);
      return result;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

module.exports = { getAllProducts };
