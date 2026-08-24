// Audits and, with --apply, prepares the operations-manifest counter so the
// next successfully committed manifest is SLC017. Run during a create-manifest
// maintenance window; never run a disposable production create smoke afterward.
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { OperationsManifest } from "../models/operationsManifest.model.js";
import { OperationsManifestCounter } from "../models/operationsManifestCounter.model.js";

const apply = process.argv.includes("--apply");
const COUNTER_ID = "operations-manifest";
const BASELINE = 16;
const NEXT_NUMBER = "SLC017";

async function auditState(session?: mongoose.ClientSession) {
  // MongoDB does not support parallel operations on the same transaction
  // session. Keep these safety checks sequential so the locked re-audit works
  // on both replica-set and sharded Atlas deployments.
  const counter = await OperationsManifestCounter.findById(COUNTER_ID)
    .lean()
    .session(session ?? null)
    .exec();
  const collision = await OperationsManifest.exists({ manifestNumber: NEXT_NUMBER })
    .session(session ?? null);
  const numbered = await OperationsManifest.find({ manifestNumber: /^SLC\d+$/ })
    .select("manifestNumber")
    .lean()
    .session(session ?? null)
    .exec();
  const highestSystemSequence = numbered.reduce((highest, item) => {
    const parsed = Number(String(item.manifestNumber).slice(3));
    return Number.isSafeInteger(parsed) ? Math.max(highest, parsed) : highest;
  }, 0);
  return {
    currentSequence: counter?.sequence ?? 0,
    highestSystemSequence,
    slc017Exists: Boolean(collision)
  };
}

function assertSafe(state: Awaited<ReturnType<typeof auditState>>) {
  if (state.slc017Exists) throw new Error(`${NEXT_NUMBER} already exists. The counter was not changed.`);
  if (state.currentSequence > BASELINE || state.highestSystemSequence > BASELINE) {
    throw new Error(
      `The manifest sequence has already advanced beyond ${NEXT_NUMBER}. `
      + `Counter=${state.currentSequence}, highest manifest=${state.highestSystemSequence}. Nothing was changed.`
    );
  }
}

async function migrateOperationsManifestCounter() {
  mongoose.set("autoIndex", false);
  await connectDatabase();
  try {
    const state = await auditState();
    console.log("Operations manifest counter audit.", { ...state, apply, intendedNextNumber: NEXT_NUMBER });
    assertSafe(state);
    if (!apply) {
      console.log(`Dry run passed. Re-run with --apply during the production maintenance window.`);
      return;
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const lockedState = await auditState(session);
        assertSafe(lockedState);
        await OperationsManifestCounter.updateOne(
          { _id: COUNTER_ID },
          { $set: { sequence: BASELINE } },
          { upsert: true, session }
        ).exec();
      });
    } finally {
      await session.endSession();
    }
    console.log(`Counter prepared. The next successfully committed manifest will be ${NEXT_NUMBER}.`);
  } finally {
    await mongoose.disconnect();
  }
}

migrateOperationsManifestCounter().catch((error) => {
  console.error("Operations manifest counter migration failed.", error);
  process.exitCode = 1;
});
