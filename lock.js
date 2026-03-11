/**
 * lock.js — Redis mutex (one-key lock) for cache stampede prevention
 *
 * Only ONE request acquires the lock and fetches from DB; others wait
 * and then read from cache. Uses Redis SET key NX EX (set if not exists, with TTL).
 */

const redis = require("./redis-client");

const LOCK_PREFIX = "lock:";
const LOCK_TTL_SEC = 15;

async function acquireLock(key) {
  const lockKey = LOCK_PREFIX + key;
  const client = redis.getClient();
  if (!client) return false;
  const result = await client.set(lockKey, "1", "EX", LOCK_TTL_SEC, "NX");
  return result === "OK";
}

async function releaseLock(key) {
  const lockKey = LOCK_PREFIX + key;
  const client = redis.getClient();
  if (client) await client.del(lockKey);
}

async function waitForCache(cacheKey, maxWaitMs, getCached) {
  const start = Date.now();
  const pollIntervalMs = 50;
  while (Date.now() - start < maxWaitMs) {
    const value = await getCached(cacheKey);
    if (value != null) return value;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return null;
}

module.exports = {
  acquireLock,
  releaseLock,
  waitForCache,
};
