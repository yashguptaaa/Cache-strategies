require("dotenv").config();
const express = require("express");
const redis = require("./redis-client");
const cache = require("./cache");
const lock = require("./lock");
const db = require("./db");
const readThrough = require("./read-through");
const staleRevalidate = require("./stale-revalidate");
const coalescing = require("./coalescing");
const tieredCache = require("./tiered-cache");
const ttlJitter = require("./ttl-jitter");
const cacheWarming = require("./cache-warming");
const writeBehind = require("./write-behind");
const writeBehindWorker = require("./write-behind-worker");

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const CACHE_TTL_SEC = parseInt(process.env.CACHE_TTL_SEC || "10", 10);
const CACHE_JITTER_SEC = parseInt(process.env.CACHE_JITTER_SEC || "0", 10);
const ALL_KEY = cache.ALL_PRODUCTS_KEY;

const LOG = {
  CACHE_HIT: () => console.log("[CACHE_HIT] products"),
  CACHE_MISS: () => console.log("[CACHE_MISS] products"),
  DB_QUERY_EXECUTED: () => console.log("[DB_QUERY_EXECUTED] products"),
  LOCK_ACQUIRED: () => console.log("[LOCK_ACQUIRED] products"),
  LOCK_WAIT: () => console.log("[LOCK_WAIT] products"),
};

async function getAllProductsStampede() {
  const cached = await cache.get(ALL_KEY);
  if (cached) {
    LOG.CACHE_HIT();
    return cached;
  }
  LOG.CACHE_MISS();
  LOG.DB_QUERY_EXECUTED();
  const data = await db.getAllProducts();
  if (data && data.length >= 0) await cache.set(ALL_KEY, data, CACHE_TTL_SEC);
  return data || [];
}

async function getAllProductsWithLock() {
  const cached = await cache.get(ALL_KEY);
  if (cached) {
    LOG.CACHE_HIT();
    return cached;
  }
  LOG.CACHE_MISS();

  const acquired = await lock.acquireLock(ALL_KEY);
  if (acquired) {
    LOG.LOCK_ACQUIRED();
    try {
      LOG.DB_QUERY_EXECUTED();
      const data = await db.getAllProducts();
      if (data && data.length >= 0)
        await cache.set(ALL_KEY, data, CACHE_TTL_SEC);
      return data || [];
    } finally {
      await lock.releaseLock(ALL_KEY);
    }
  }

  LOG.LOCK_WAIT();
  const data = await lock.waitForCache(ALL_KEY, 15000, cache.get);
  return data || [];
}

async function getAllProducts(strategy) {
  switch (strategy) {
    case "lock":
      return getAllProductsWithLock();
    case "read-through":
      return readThrough.getAllProducts(cache, db, ALL_KEY, CACHE_TTL_SEC);
    case "stale-revalidate":
      return staleRevalidate.getAllProducts(cache, db, ALL_KEY, CACHE_TTL_SEC);
    case "coalescing":
      return coalescing.getAllProducts(cache, db, ALL_KEY, CACHE_TTL_SEC);
    case "tiered":
      return tieredCache.getAllProducts(cache, db, ALL_KEY, CACHE_TTL_SEC);
    case "jitter":
      return ttlJitter.getAllProducts(
        cache,
        db,
        ALL_KEY,
        CACHE_TTL_SEC,
        CACHE_JITTER_SEC || undefined,
      );
    case "warming":
      return cacheWarming.getAllProducts(cache, db, ALL_KEY, CACHE_TTL_SEC);
    case "stampede":
    default:
      return getAllProductsStampede();
  }
}

app.get("/products", async (req, res) => {
  const strategy = req.query.strategy || process.env.STRATEGY || "stampede";
  const start = Date.now();
  try {
    const products = await getAllProducts(strategy);
    res.set("X-Response-Time-Ms", String(Date.now() - start));
    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.patch("/products/:id", async (req, res) => {
  const id = req.params.id;
  const patch = req.body || {};
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({
      error: "Provide at least one field to update: name, price, or category",
    });
  }
  try {
    const updated = await db.updateProduct(id, {
      name: patch.name,
      price: patch.price,
      category: patch.category,
    });
    if (!updated) {
      return res.status(404).json({ error: "Product not found" });
    }
    const marked = await cache.setStale(ALL_KEY);
    if (marked) {
      console.log(
        "[PATCH /products/:id] Cache marked stale; next GET (stale-revalidate) will serve old data and revalidate.",
      );
    }
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/products/write-behind", async (req, res) => {
  const { name, price, category } = req.body || {};
  if (!name || price === undefined || !category) {
    return res.status(400).json({
      error: "Provide name, price, and category",
    });
  }
  try {
    const result = await writeBehind.createProduct(
      { name, price, category },
      ALL_KEY,
      CACHE_TTL_SEC,
    );
    res.json({
      status: "queued",
      message: "Written to cache instantly. DB insert queued via BullMQ.",
      product: result,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/demo/write-behind-pending", async (req, res) => {
  try {
    const pending = await writeBehind.getPendingProducts();
    res.json({ count: pending.length, products: pending });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/demo/invalidate", async (req, res) => {
  const client = redis.getClient();
  if (!client) return res.status(503).json({ error: "Redis not connected" });
  await client.flushdb();
  console.log("[DEMO] Cache invalidated (ready for load test)");
  res.json({
    ok: true,
    message:
      "Cache invalidated. Now run many GET /products at once for stampede.",
  });
});

app.get("/demo/stale-revalidate-flow", async (req, res) => {
  const client = redis.getClient();
  if (!client) return res.status(503).json({ error: "Redis not connected" });

  const count = Math.min(
    200,
    Math.max(2, parseInt(req.query.count || "100", 10) || 100),
  );
  const patchAtParam = req.query.patchAt;
  const patchAt =
    patchAtParam !== undefined && patchAtParam !== ""
      ? Math.min(count, Math.max(1, parseInt(patchAtParam, 10) || 1))
      : Math.floor(Math.random() * (count - 2) + 2);

  try {
    await getAllProducts("stale-revalidate");

    const results = [];
    for (let i = 1; i <= count; i++) {
      if (i === patchAt) {
        const updated = await db.updateProduct(1, {
          name: `Widget Pro (updated at request ${i})`,
        });
        if (updated) await cache.setStale(ALL_KEY);
        results.push({ request: i, type: "PATCH", product: updated });
      } else {
        const t0 = Date.now();
        const products = await getAllProducts("stale-revalidate");
        results.push({
          request: i,
          type: "GET",
          count: products.length,
          ms: Date.now() - t0,
          firstProductName: products[0]?.name,
        });
      }
    }

    res.json({
      message: `Ran ${count} requests; request #${patchAt} was PATCH (in between). GETs after that return stale data until revalidation. Check server logs for STALE_SERVED.`,
      count,
      patchAt,
      results,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message) });
  }
});

app.get("/demo/burst", async (req, res) => {
  const client = redis.getClient();
  if (!client) return res.status(503).json({ error: "Redis not connected" });

  const strategy = req.query.strategy || "stampede";
  console.log("strategy", strategy);
  const count = Math.min(
    100,
    Math.max(1, parseInt(req.query.count || "10", 10) || 10),
  );

  try {
    if (strategy === "stale-revalidate") {
      const flowCount = Math.min(
        200,
        Math.max(2, parseInt(req.query.count || "100", 10) || 100),
      );
      const patchAtParam = req.query.patchAt;
      const patchAt =
        patchAtParam !== undefined && patchAtParam !== ""
          ? Math.min(flowCount, Math.max(1, parseInt(patchAtParam, 10) || 1))
          : Math.floor(Math.random() * (flowCount - 2) + 2);

      await getAllProducts("stale-revalidate");

      const results = [];
      for (let i = 1; i <= flowCount; i++) {
        if (i === patchAt) {
          const updated = await db.updateProduct(1, {
            name: `Widget Pro (updated at request ${i})`,
          });
          if (updated) await cache.setStale(ALL_KEY);
          results.push({ request: i, type: "PATCH", product: updated });
        } else {
          const t0 = Date.now();
          const products = await getAllProducts("stale-revalidate");
          results.push({
            request: i,
            type: "GET",
            count: products.length,
            ms: Date.now() - t0,
            firstProductName: products[0]?.name,
          });
        }
      }

      return res.json({
        strategy: "stale-invalidate",
        count: flowCount,
        patchAt,
        message: `Request #${patchAt} was PATCH. GETs after that return stale data until revalidation. Check server logs for STALE_SERVED.`,
        results,
      });
    }

    const start = Date.now();
    const promises = Array(count)
      .fill(0)
      .map(() => {
        const t0 = Date.now();
        return getAllProducts(strategy).then(() => ({ ms: Date.now() - t0 }));
      });
    const results = await Promise.all(promises);
    const timesMs = results.map((r) => r.ms);
    const totalMs = Date.now() - start;
    const sum = timesMs.reduce((a, b) => a + b, 0);

    const description =
      strategy === "lock"
        ? "One request hits DB; rest wait for cache. Check server logs: one LOCK_ACQUIRED, one DB_QUERY_EXECUTED."
        : strategy === "read-through"
          ? "First request(s): CACHE_MISS → DB_LOAD → CACHE_STORE. Rest: CACHE_HIT. Cache is never preloaded."
          : "All requests hit DB (stampede). Check server logs: many CACHE_MISS, many DB_QUERY_EXECUTED.";
    res.json({
      strategy,
      count,
      description,
      timesMs,
      minMs: Math.min(...timesMs),
      maxMs: Math.max(...timesMs),
      avgMs: Math.round(sum / count),
      totalMs,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message) });
  }
});

async function main() {
  if (!process.env.REDIS_URL) {
    console.error(
      "REDIS_URL is required. Copy .env.example to .env and set REDIS_URL.",
    );
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is required. Copy .env.example to .env and set DATABASE_URL.",
    );
    process.exit(1);
  }
  await db.init();
  const redisClient = redis.createClient();

  writeBehindWorker.startWorker({
    host: redisClient.options.host || "localhost",
    port: redisClient.options.port || 6379,
    password: redisClient.options.password || undefined,
  }, writeBehind.removePending);

  app.listen(PORT, () => {
    console.log(`Cache Stampede Demo — http://localhost:${PORT}`);
    console.log(
      "GET /products?strategy=stampede|lock|read-through|stale-revalidate|coalescing|tiered|jitter|warming",
    );
    console.log(
      "POST /products/write-behind — Write-Behind (BullMQ)",
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
