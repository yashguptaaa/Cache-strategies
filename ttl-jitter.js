const LOG = {
  CACHE_HIT: () => console.log('[CACHE_HIT] products'),
  CACHE_MISS: () => console.log('[CACHE_MISS] products'),
  DB_QUERY_EXECUTED: () => console.log('[DB_QUERY_EXECUTED] products'),
};

function withJitter(ttlSec, jitterSec) {
  const jitter = Math.random() * (jitterSec || Math.max(1, Math.floor(ttlSec * 0.2)));
  return Math.max(1, Math.floor(ttlSec + jitter));
}

async function getAllProducts(cache, db, key, ttlSec, jitterSec) {
  const cached = await cache.get(key);
  if (cached) {
    LOG.CACHE_HIT();
    return cached;
  }

  LOG.CACHE_MISS();
  LOG.DB_QUERY_EXECUTED();
  const data = await db.getAllProducts();
  const result = data || [];
  if (result.length >= 0) {
    const actualTtl = withJitter(ttlSec, jitterSec);
    await cache.set(key, result, actualTtl);
  }
  return result;
}

module.exports = { getAllProducts };
