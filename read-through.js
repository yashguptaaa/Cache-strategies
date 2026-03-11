const redis = require("./redis-client");

const LOCK_TTL_SEC = 5;
const POLL_INTERVAL_MS = 30;
const MAX_WAIT_MS = 15000;

const LOG = {
  CACHE_HIT: () => console.log("[READ_THROUGH] CACHE_HIT — served from cache"),
  CACHE_MISS: () =>
    console.log("[READ_THROUGH] CACHE_MISS — key not in cache"),
  LOCK_ACQUIRED: () =>
    console.log("[READ_THROUGH] LOCK_ACQUIRED — fetching from DB"),
  WAITING_FOR_FILL: () =>
    console.log("[READ_THROUGH] WAITING_FOR_CACHE_FILL — another request is loading"),
  DB_QUERY_EXECUTED: () =>
    console.log("[READ_THROUGH] DB_QUERY_EXECUTED — queried database"),
  CACHE_FILLED: () =>
    console.log("[READ_THROUGH] CACHE_FILLED — stored in Redis"),
  FALLBACK_FETCH: () =>
    console.log("[READ_THROUGH] FALLBACK_FETCH — lock holder may have failed"),
};

async function get(fetchFn, key, ttlSec) {
  const client = redis.getClient();
  if (!client) return fetchFn();

  const cached = await client.get(key);
  if (cached) {
    LOG.CACHE_HIT();
    try {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.data))
        return parsed.data;
      return parsed;
    } catch {
      return null;
    }
  }

  LOG.CACHE_MISS();

  const lockKey = `lock:rt:${key}`;

  const lock = await client.set(lockKey, "1", "NX", "EX", LOCK_TTL_SEC);

  if (lock) {
    LOG.LOCK_ACQUIRED();
    try {
      LOG.DB_QUERY_EXECUTED();
      const data = await fetchFn();
      const result = data || [];

      await client.setex(key, ttlSec, JSON.stringify(result));
      LOG.CACHE_FILLED();

      return result;
    } finally {
      await client.del(lockKey);
    }
  }

  LOG.WAITING_FOR_FILL();

  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const retry = await client.get(key);
    if (retry) {
      LOG.CACHE_HIT();
      try {
        const parsed = JSON.parse(retry);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.data))
          return parsed.data;
        return parsed;
      } catch {
        return null;
      }
    }
  }

  LOG.FALLBACK_FETCH();
  return fetchFn();
}

async function getAllProducts(cache, db, key, ttlSec) {
  return get(() => db.getAllProducts(), key, ttlSec);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { get, getAllProducts };
