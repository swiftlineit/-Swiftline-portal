import mongoose from "mongoose";
import { env } from "../config/env.js";
import { syncProfitabilityRange } from "../services/shipmentProfitability.service.js";

async function main() {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(env.MONGODB_URI);
  try {
    const result = await syncProfitabilityRange({ apply });
    console.log(JSON.stringify({ mode: apply ? "apply" : "audit", ...result }, null, 2));
    if (apply && result.failed > 0) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
