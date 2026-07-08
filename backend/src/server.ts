import mongoose from "mongoose";

import { app } from "./app.js";
import { connectDatabase } from "./config/database.js";
import { ensureAdminSeeded } from "./config/admin.js";
import { connectRedis, disconnectRedis } from "./config/redis.js";
import { env } from "./config/env.js";

async function bootstrap(): Promise<void> {
  await connectDatabase();
  await ensureAdminSeeded();
  await connectRedis();

  const server = app.listen(env.PORT, () => {
    console.log(`API running on http://localhost:${env.PORT}`);
    console.log(
      `Health check: http://localhost:${env.PORT}/api/v1/health`
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`${signal} received. Closing services...`);

    server.close(async () => {
      try {
        await disconnectRedis();
        await mongoose.disconnect();

        console.log("Services closed successfully");
        process.exit(0);
      } catch (error) {
        console.error("Shutdown failed:", error);
        process.exit(1);
      }
    });
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

bootstrap().catch((error) => {
  console.error("Application startup failed:", error);
  process.exit(1);
});