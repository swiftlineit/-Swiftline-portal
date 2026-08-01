import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { env } from "../config/env.js";
import { drainEmailOutbox } from "../services/email/dispatcher.js";

// Scheduled job: the safety net behind the post-enqueue drain. Picks up rows the
// API process never got to — because it crashed mid-send, because SES was
// throttling, or because the send is waiting out its backoff.
// Recommended cadence: every 5 minutes.
//
// The batch size bounds one run; a large backlog drains across several runs
// rather than in one burst, which is also what keeps us inside the SES send
// rate.
async function run() {
  await connectDatabase();
  try {
    const result = await drainEmailOutbox(env.EMAIL_DRAIN_BATCH_SIZE);
    console.log(
      `Email drain complete: processed ${result.processed}, sent ${result.sent}, failed ${result.failed}.`
    );
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error("Email drain job failed.", error);
  process.exitCode = 1;
});
