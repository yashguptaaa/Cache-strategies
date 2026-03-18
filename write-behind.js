const redis = require("./redis-client");
const { getQueue } = require("./queue");

const PENDING_KEY = "product:all";

const LOG = {
  CACHE_STORED: (product) =>
    console.log(`[WRITE_BEHIND] CACHE_STORED — "${product.name}" pushed to Redis (instant)`),
  QUEUED: (product, jobId) =>
    console.log(`[WRITE_BEHIND] QUEUED — "${product.name}" enqueued for DB insert (jobId: ${jobId})`),
};

async function getExisting(client) {
  const raw = await client.get(PENDING_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.data)) return parsed.data;
    return [];
  } catch { return []; }
}

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

  // 1️⃣ GET existing array, append, SET back
  const existing = await getExisting(client);
  existing.push(product);
  await client.set(PENDING_KEY, JSON.stringify(existing));
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
  return getExisting(client);
}

async function removePending(productTempId) {
  const client = redis.getClient();
  if (!client) return;

  const existing = await getExisting(client);
  const filtered = existing.filter((p) => p.id !== productTempId);
  await client.set(PENDING_KEY, JSON.stringify(filtered));
}

/**
 * Bulk write-behind: accepts an array of products,
 * pushes ALL to Redis in one go, then queues ALL to BullMQ.
 */
async function createProductsBulk(items) {
  const client = redis.getClient();
  if (!client) throw new Error("Redis not connected");

  // 1️⃣ Prepare all products & push ALL to Redis in one SET
  const products = items.map((data) => ({
    id: `temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: data.name,
    price: parseFloat(data.price),
    category: data.category,
  }));

  const existing = await getExisting(client);
  const merged = [...existing, ...products];
  await client.set(PENDING_KEY, JSON.stringify(merged));
  console.log(`[WRITE_BEHIND] BULK_CACHED — ${products.length} products pushed to Redis`);

  // 2️⃣ Queue ALL to BullMQ in batch
  const queue = getQueue();
  const jobData = products.map((p) => ({
    name: "insert-product",
    data: { name: p.name, price: p.price, category: p.category, tempId: p.id },
  }));
  const jobs = await queue.addBulk(jobData);
  console.log(`[WRITE_BEHIND] BULK_QUEUED — ${jobs.length} jobs enqueued for DB insert`);

  return products.map((p, i) => ({
    ...p,
    _writeBehind: true,
    _jobId: jobs[i].id,
  }));
}

module.exports = { createProduct, createProductsBulk, getPendingProducts, removePending, PENDING_KEY };
