/**
 * event-driven.js — Event-Driven Cache Invalidation
 *
 * Instead of relying on TTL expiry, the cache is explicitly invalidated
 * when data changes. An EventEmitter emits "product:invalidate" on writes,
 * and a listener immediately deletes the cache key.
 */

const { EventEmitter } = require("events");
const redis = require("./redis-client");

const emitter = new EventEmitter();

const LOG = {
  CACHE_HIT: () => console.log("[EVENT_DRIVEN] CACHE_HIT — serving from cache"),
  CACHE_MISS: () => console.log("[EVENT_DRIVEN] CACHE_MISS — loading from DB"),
  CACHE_SET: () => console.log("[EVENT_DRIVEN] CACHE_SET — stored in cache"),
  INVALIDATED: (key) => console.log(`[EVENT_DRIVEN] INVALIDATED — cache deleted for "${key}"`),
};

/**
 * Set up the listener that deletes the cache key when an invalidation event fires.
 * Call this once at startup.
 */
function setupListeners(cache, cacheKey) {
  emitter.on("product:invalidate", async () => {
    const deleted = await cache.del(cacheKey);
    if (deleted) {
      LOG.INVALIDATED(cacheKey);
    }
  });
  console.log(`[EVENT_DRIVEN] Listener registered — watching "product:invalidate" for key "${cacheKey}"`);
}

/**
 * Emit invalidation event — call this after any write (create/update/delete).
 */
function emitInvalidation() {
  emitter.emit("product:invalidate");
}

/**
 * Read path: simple cache-aside with event-driven invalidation.
 * Cache hit → return cached data.
 * Cache miss → load from DB → store in cache → return.
 */
async function getAllProducts(cache, db, cacheKey, ttlSec) {
  const cached = await cache.get(cacheKey);
  if (cached) {
    LOG.CACHE_HIT();
    return cached;
  }

  LOG.CACHE_MISS();
  const data = await db.getAllProducts();
  if (data && data.length >= 0) {
    await cache.set(cacheKey, data, ttlSec);
    LOG.CACHE_SET();
  }
  return data || [];
}

module.exports = {
  setupListeners,
  emitInvalidation,
  getAllProducts,
  emitter, // exposed for testing/inspection
};
