/**
 * cache.js — Redis cache layer (real Redis)
 */

const redis = require("./redis-client");

const KEY_PREFIX = "product:";
const ALL_PRODUCTS_KEY = "product:all";

function cacheKey(id) {
  return KEY_PREFIX + id;
}

async function get(key) {
  const client = redis.getClient();
  if (!client) return null;

  const raw = await client.get(key);
  if (raw == null) return null;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.data))
      return parsed.data;
    return parsed;
  } catch {
    return null;
  }
}

async function set(key, value, ttlSec) {
  const client = redis.getClient();
  if (!client) return;

  const serialized = JSON.stringify(value);
  await client.setex(key, ttlSec, serialized);
}

async function getWithExpiry(key) {
  const client = redis.getClient();
  if (!client) return null;
  const raw = await client.get(key);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.expiresAt === "number" &&
      Array.isArray(parsed.data)
    )
      return parsed;
    return null;
  } catch {
    return null;
  }
}

async function setWithExpiry(key, data, ttlSec) {
  const client = redis.getClient();
  if (!client) return;
  const expiresAt = Date.now() + ttlSec * 1000;
  const value = JSON.stringify({ data, expiresAt });
  await client.setex(key, ttlSec * 2, value);
}

async function setStale(key) {
  const client = redis.getClient();
  if (!client) return false;

  let data = null;
  const stored = await getWithExpiry(key);
  if (stored) {
    data = stored.data;
  } else {
    const raw = await client.get(key);
    if (raw == null) return false;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) data = parsed;
      else if (parsed && Array.isArray(parsed.data)) data = parsed.data;
    } catch {
      return false;
    }
  }
  if (!data) return false;

  const value = JSON.stringify({ data, expiresAt: 0 });
  await client.setex(key, 60, value);
  return true;
}

module.exports = {
  cacheKey,
  ALL_PRODUCTS_KEY,
  get,
  set,
  getWithExpiry,
  setWithExpiry,
  setStale,
};
