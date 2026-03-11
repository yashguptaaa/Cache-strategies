const { Queue } = require("bullmq");
const redis = require("./redis-client");

let queue = null;

function getQueue() {
  if (!queue) {
    const client = redis.getClient();
    if (!client) throw new Error("Redis not connected");

    queue = new Queue("write-db", {
      connection: {
        host: client.options.host || "localhost",
        port: client.options.port || 6379,
        password: client.options.password || undefined,
      },
    });
  }
  return queue;
}

async function closeQueue() {
  if (queue) {
    await queue.close();
    queue = null;
  }
}

module.exports = { getQueue, closeQueue };
