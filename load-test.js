#!/usr/bin/env node
/**
 * load-test.js — Load test for cache stampede demo (GET /products)
 *
 * Usage: node load-test.js [strategy]
 *        npm run load      — strategy=stampede (no lock); flushes cache first
 *        npm run load:lock — strategy=lock (one-key lock)
 *
 * Default: 20 connections, 4s — keeps server logs readable.
 * Override: LOAD_CONNECTIONS=50 LOAD_DURATION=6 node load-test.js
 */

require("dotenv").config();
const autocannon = require("autocannon");

const strategy = process.argv[2] || "stampede";
const baseUrl = process.env.BASE_URL || "http://localhost:3000";
const url = `${baseUrl.replace(/\/$/, "")}/products?strategy=${strategy}`;

// Lower connections & duration so server logs (CACHE_MISS, DB_QUERY_EXECUTED) stay visible in demo
const opts = {
  url,
  connections: parseInt(process.env.LOAD_CONNECTIONS || "20", 10),
  duration: parseInt(process.env.LOAD_DURATION || "4", 10),
  method: "GET",
};

async function invalidateCache() {
  const url = `${baseUrl.replace(/\/$/, "")}/demo/invalidate`;
  try {
    const res = await fetch(url, { method: "POST" });
    if (res.ok) return true;
  } catch (e) {
    console.warn("Could not invalidate cache:", e.message);
  }
  return false;
}

async function run() {
  console.log("Cache Stampede Demo — Load Test");
  console.log("Strategy:", strategy);
  console.log("URL:", url);
  console.log(
    "Connections: %d, Duration: %ds",
    opts.connections,
    opts.duration,
  );

  if (strategy === "stampede" || strategy === "lock") {
    const ok = await invalidateCache();
    if (ok)
      console.log(
        "Step 1: Cache invalidated. Step 2: Sending many GET /products (" +
          strategy +
          ").",
      );
    else console.warn("Invalidate failed — cache may be warm.");
    if (strategy === "stampede")
      console.log(
        "Set DB_DELAY_MS=2000 in .env to see many DB_QUERY_EXECUTED.",
      );
  }
  console.log("");

  autocannon(opts, (err, result) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(autocannon.printResult(result));
  });
}

run();
