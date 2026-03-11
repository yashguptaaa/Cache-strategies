const Redis = require("ioredis");

let client = null;

function getClient() {
  return client;
}

function createClient() {
  if (client) return client;
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  client = new Redis(url, { maxRetriesPerRequest: null });
  client.on("error", (err) => console.error("[Redis]", err.message));
  return client;
}

async function disconnect() {
  if (client) {
    await client.quit();
    client = null;
  }
}

module.exports = { getClient, createClient, disconnect };
