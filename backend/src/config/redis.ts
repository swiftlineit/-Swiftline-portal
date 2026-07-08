import { createClient } from "redis";
import { env } from "./env.js";

export let redisClient: ReturnType<typeof createClient> | null = null;

export async function connectRedis(): Promise<void> {
  if (!env.REDIS_URL) {
    console.warn("REDIS_URL not set; skipping Redis connection");
    return;
  }

  redisClient = createClient({ url: env.REDIS_URL });

  redisClient.on("error", (err) => {
    console.error("Redis Client Error:", err);
  });

  await redisClient.connect();

  console.log("Redis connected");
}

export async function disconnectRedis(): Promise<void> {
  if (!redisClient) return;

  try {
    await redisClient.disconnect();
    console.log("Redis disconnected");
  } catch (error) {
    console.error("Error disconnecting Redis:", error);
  } finally {
    redisClient = null;
  }
}

export function getRedisClient() {
  if (!redisClient) throw new Error("Redis client not connected");
  return redisClient;
}
