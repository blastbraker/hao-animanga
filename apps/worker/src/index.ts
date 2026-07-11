import { Worker, type ConnectionOptions } from "bullmq";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.log("HAO worker is idle: REDIS_URL is not configured.");
} else {
  const redis = new URL(redisUrl);
  const connection: ConnectionOptions = {
    host: redis.hostname,
    port: Number(redis.port || 6379),
    maxRetriesPerRequest: null,
  };
  if (redis.username) connection.username = redis.username;
  if (redis.password) connection.password = redis.password;
  if (redis.protocol === "rediss:") connection.tls = {};
  const worker = new Worker("hao-jobs", async (job) => {
    switch (job.name) {
      case "epub.process":
      case "catalog.refresh":
      case "provider.health":
      case "title.match":
        return { job: job.name, status: "accepted", processedAt: new Date().toISOString() };
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  }, { connection, concurrency: 4 });
  worker.on("completed", (job) => console.log(`completed ${job.name}:${job.id}`));
  worker.on("failed", (job, error) => console.error(`failed ${job?.name}:${job?.id}`, error));
}
