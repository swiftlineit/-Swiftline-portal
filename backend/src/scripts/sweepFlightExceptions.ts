import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { runFlightLinehaulExceptionSweep } from "../services/flightLinehaul.service.js";

/**
 * Scheduled flight exception sweep. The API still evaluates a flight when its
 * detail is opened, while this job covers flights nobody is currently viewing.
 * All exception creation is idempotent by dedupe key.
 */
async function main() {
  await connectDatabase();
  try {
    const result = await runFlightLinehaulExceptionSweep();
    console.log(`Flight exception sweep complete: ${result.evaluated} flight(s) evaluated.`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("Flight exception sweep failed.", error);
  process.exitCode = 1;
});
