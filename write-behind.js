const redis = require("./redis-client");
const { getQueue } = require("./queue");

const PENDING_KEY = "products:write-behind";

const LOG = {
  CACHE_STORED: (product) =>
    console.log(`[WRITE_BEHIND] CACHE_STORED — "${product.name}" pushed to Redis (instant)`),
  QUEUED: (product, jobId) =>
    console.log(`[WRITE_BEHIND] QUEUED — "${product.name}" enqueued for DB insert (jobId: ${jobId})`),
};

async function createProduct(data, allKey, ttlSec) {
  const client = redis.getClient();
  if (!client) throw new Error("Redis not connected");

  const { name, price, category } = data;

  const product = {
    id: `temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    price: parseFloat(price),
    category,
  };

  // 1️⃣ RPUSH to Redis list — atomic, handles 100 concurrent writes safely
  await client.rpush(PENDING_KEY, JSON.stringify(product));
  LOG.CACHE_STORED(product);

  // 2️⃣ Enqueue DB insert via BullMQ (async flush to PostgreSQL)
  const queue = getQueue();
  const job = await queue.add("insert-product", { name, price, category, tempId: product.id });
  LOG.QUEUED(product, job.id);

  return {
    ...product,
    _writeBehind: true,
    _jobId: job.id,
  };
}

async function getPendingProducts() {
  const client = redis.getClient();
  if (!client) return [];

  const items = await client.lrange(PENDING_KEY, 0, -1);
  return items.map((item) => {
    try { return JSON.parse(item); } catch { return null; }
  }).filter(Boolean);
}

async function removePending(productTempId) {
  const client = redis.getClient();
  if (!client) return;

  const items = await client.lrange(PENDING_KEY, 0, -1);
  for (const item of items) {
    try {
      const parsed = JSON.parse(item);
      if (parsed.id === productTempId) {
        await client.lrem(PENDING_KEY, 1, item);
        return;
      }
    } catch {}
  }
}

module.exports = { createProduct, getPendingProducts, removePending, PENDING_KEY };
