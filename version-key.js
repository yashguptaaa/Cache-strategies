/**
 * version-key.js — Version-Key Cache Invalidation
 *
 * Each cache entry is stored with a version number. A separate Redis key
 * (e.g. "product:all:version") holds the current version. On reads, the
 * cached version is compared to the current version — a mismatch triggers
 * a re-fetch from the database. Writes bump the version via INCR.
 */

const redis = require("./redis-client");

const LOG = {
  VERSION_HIT: (v) => console.log(`[VERSION_KEY] VERSION_HIT — cached version ${v} matches current`),
  VERSION_MISS: (cached, current) =>
    console.log(`[VERSION_KEY] VERSION_MISMATCH — cached version ${cached}, current version ${current} → re-fetching from DB`),
  NO_CACHE: () => console.log("[VERSION_KEY] CACHE_MISS — no cached data, loading from DB"),
  CACHE_SET: (v) => console.log(`[VERSION_KEY] CACHE_SET — stored with version ${v}`),
  BUMPED: (key, v) => console.log(`[VERSION_KEY] BUMPED — ${key} → version ${v}`),
};

/**
 * Get the version key name for a given cache key.
 * e.g. "product:all" → "product:all:version"
 */
function versionKeyFor(cacheKey) {
  return `${cacheKey}:version`;
}

/**
 * Get the current version number from Redis.
 * Returns 0 if the key doesn't exist yet.
 */
async function getCurrentVersion(cacheKey) {
  const client = redis.getClient();
  if (!client) return 0;
  const raw = await client.get(versionKeyFor(cacheKey));
  return raw ? parseInt(raw, 10) : 0;
}

/**
 * Bump the version — call this after any write (create/update/delete).
 * Uses INCR for atomic increment.
 */
async function bumpVersion(cacheKey) {
  const client = redis.getClient();
  if (!client) return 0;
  const newVersion = await client.incr(versionKeyFor(cacheKey));
  LOG.BUMPED(versionKeyFor(cacheKey), newVersion);
  return newVersion;
}

/**
 * Read path: check cache → compare version → serve or re-fetch.
 *
 * 1. Read cached data (which includes an embedded version number)
 * 2. Read the current version key from Redis
 * 3. If versions match → cache hit, return cached data
 * 4. If mismatch or no cache → load from DB, store with current version
 */
async function getAllProducts(cache, db, cacheKey, ttlSec) {
  const currentVersion = await getCurrentVersion(cacheKey);

  // Try to get versioned data from cache
  const cached = await cache.getVersioned(cacheKey);

  if (cached && cached.version === currentVersion && currentVersion > 0) {
    LOG.VERSION_HIT(currentVersion);
    return cached.data;
  }

  if (cached) {
    LOG.VERSION_MISS(cached.version, currentVersion);
  } else {
    LOG.NO_CACHE();
  }

  // Fetch fresh data from DB
  const data = await db.getAllProducts();

  // If version is 0 (first time), initialize it to 1
  let storeVersion = currentVersion;
  if (storeVersion === 0) {
    storeVersion = await bumpVersion(cacheKey);
  }

  if (data && data.length >= 0) {
    await cache.setVersioned(cacheKey, data, storeVersion, ttlSec);
    LOG.CACHE_SET(storeVersion);
  }

  return data || [];
}

module.exports = {
  getAllProducts,
  bumpVersion,
  getCurrentVersion,
  versionKeyFor,
};
