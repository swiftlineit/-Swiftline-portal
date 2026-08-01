import mongoose from "mongoose";

import { app } from "./app.js";
import { connectDatabase } from "./config/database.js";
import { ensureAdminSeeded } from "./config/admin.js";
import { env } from "./config/env.js";

// Production defaulting to the SMTP driver would quietly send client mail
// through whatever relay is left in the environment, with no bounce handling and
// none of SES's reputation protection. Loud at boot beats silent in production.
function warnOnMailMisconfiguration(): void {
  if (env.NODE_ENV !== "production") return;

  if (env.MAIL_DRIVER !== "ses") {
    console.warn(`WARNING: MAIL_DRIVER is "${env.MAIL_DRIVER}" in production. Set MAIL_DRIVER=ses.`);
  }
  if (!env.MAIL_FROM) {
    console.warn("WARNING: MAIL_FROM is not set. No email can be sent.");
  }
  if (env.MAIL_DRIVER === "ses" && !env.SES_CONFIGURATION_SET) {
    console.warn("WARNING: SES_CONFIGURATION_SET is not set. Bounce and complaint events will not be delivered.");
  }
  if (!env.SES_WEBHOOK_SECRET) {
    console.warn("WARNING: SES_WEBHOOK_SECRET is not set. The SES webhook will reject every request.");
  }
}

async function bootstrap(): Promise<void> {
  await connectDatabase();
  await ensureAdminSeeded();
  warnOnMailMisconfiguration();

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