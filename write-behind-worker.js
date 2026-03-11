const { Worker } = require("bullmq");
const db = require("./db");

let worker = null;
let removePendingFn = null;

function startWorker(redisOpts, _removePending) {
  if (worker) return worker;
  removePendingFn = _removePending || null;

  worker = new Worker(
    "write-db",
    async (job) => {
      const { name, price, category, tempId } = job.data;

      console.log(
        `[WRITE_BEHIND_WORKER] PROCESSING — inserting "${name}" (jobId: ${job.id})`,
      );

      const inserted = await db.insertProduct(name, price, category);

      console.log(
        `[WRITE_BEHIND_WORKER] DB_INSERTED — product ${inserted.id} "${inserted.name}" persisted to database`,
      );

      // Remove from Redis pending list after DB insert
      if (removePendingFn && tempId) {
        await removePendingFn(tempId);
        console.log(
          `[WRITE_BEHIND_WORKER] PENDING_REMOVED — temp ${tempId} cleaned from Redis`,
        );
      }

      return inserted;
    },
    {
      connection: redisOpts,
      concurrency: 5,
    },
  );

  worker.on("completed", (job) => {
    console.log(
      `[WRITE_BEHIND_WORKER] COMPLETED — jobId: ${job.id}`,
    );
  });

  worker.on("failed", (job, err) => {
    console.log(
      `[WRITE_BEHIND_WORKER] FAILED — jobId: ${job.id}, error: ${err.message}`,
    );
  });

  console.log("[WRITE_BEHIND_WORKER] Worker started — listening for write-db jobs");

  return worker;
}

async function stopWorker() {
  if (worker) {
    await worker.close();
    worker = null;
  }
}

module.exports = { startWorker, stopWorker };
