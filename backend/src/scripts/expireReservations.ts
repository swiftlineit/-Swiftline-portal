import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { expireStaleReservations } from "../services/creditBooking.service.js";

// Scheduled job: release booking reservations that passed their TTL without being
// converted or released, so their funds stop consuming available credit.
// Recommended cadence: every 5 minutes.
async function run() {
  await connectDatabase();
  try {
    const result = await expireStaleReservations();
    console.log(`Reservation sweep complete: scanned ${result.scanned}, released ${result.released}.`);
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error("Reservation expiry job failed.", error);
  process.exitCode = 1;
});
