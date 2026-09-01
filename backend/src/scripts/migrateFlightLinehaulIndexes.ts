import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";

const apply = process.argv.includes("--apply");
const ACTIVE_MANIFEST_STATUSES = ["DRAFT", "PACKING", "READY_TO_SEAL", "SEALED", "DISPATCHED"];
const ACTIVE_FLIGHT_STATUSES = [
  "PLANNED", "BOOKING_CONFIRMED", "CARGO_ALLOCATED", "MANIFEST_READY",
  "HANDED_TO_AIRLINE", "DEPARTED", "IN_TRANSIT", "CONNECTION",
  "ARRIVED_DESTINATION", "CUSTOMS", "HANDED_TO_FINAL_MILE"
];
const MANIFEST_INDEX_NAME = "uniq_active_manifest_per_flight";
const ACTIVE_ALLOCATION_INDEX_NAME = "uniq_active_flight_shipment";
const LEGACY_ALLOCATION_INDEX_NAME = "uniq_flight_shipment";
const FLIGHT_MAWB_INDEX_NAME = "uniq_active_flight_mawb";

async function duplicateActiveManifests() {
  return mongoose.connection.collection("operationsmanifests").aggregate([
    {
      $match: {
        flightLinehaulId: { $type: "objectId" },
        status: { $in: ACTIVE_MANIFEST_STATUSES }
      }
    },
    {
      $group: {
        _id: "$flightLinehaulId",
        count: { $sum: 1 },
        manifestNumbers: { $push: "$manifestNumber" }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();
}

async function duplicateActiveAllocations() {
  return mongoose.connection.collection("flightshipmentallocations").aggregate([
    { $match: { status: "ALLOCATED" } },
    {
      $group: {
        _id: { flightLinehaulId: "$flightLinehaulId", shipmentDraftId: "$shipmentDraftId" },
        count: { $sum: 1 }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();
}

async function duplicateActiveMawbs() {
  return mongoose.connection.collection("flightlinehauls").aggregate([
    {
      $match: {
        mawbNumber: { $type: "string", $gt: "" },
        status: { $in: ACTIVE_FLIGHT_STATUSES }
      }
    },
    {
      $group: {
        _id: "$mawbNumber",
        count: { $sum: 1 },
        flightNumbers: { $push: "$flightNumber" }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();
}

async function existingIndexNames(collectionName: string) {
  try {
    return (await mongoose.connection.collection(collectionName).listIndexes().toArray())
      .map((index) => index.name)
      .filter((name): name is string => Boolean(name));
  } catch (error) {
    if (error instanceof mongoose.mongo.MongoServerError && error.codeName === "NamespaceNotFound") return [];
    throw error;
  }
}

async function migrate() {
  mongoose.set("autoIndex", false);
  await connectDatabase();
  try {
    const duplicates = await duplicateActiveManifests();
    const duplicateAllocations = await duplicateActiveAllocations();
    const duplicateMawbs = await duplicateActiveMawbs();
    console.log("Flight linehaul index audit.", { apply, duplicateManifestGroups: duplicates, duplicateAllocationGroups: duplicateAllocations, duplicateActiveMawbs: duplicateMawbs });
    if (duplicates.length || duplicateAllocations.length || duplicateMawbs.length) {
      throw new Error("Resolve duplicate active manifests/allocations/MAWBs before creating the unique indexes. Nothing was changed.");
    }
    if (!apply) {
      console.log(`Dry run passed. Re-run with --apply to create or repair ${MANIFEST_INDEX_NAME}, ${ACTIVE_ALLOCATION_INDEX_NAME}, and ${FLIGHT_MAWB_INDEX_NAME}.`);
      return;
    }

    const allocationIndexes = await existingIndexNames("flightshipmentallocations");
    if (allocationIndexes.includes(LEGACY_ALLOCATION_INDEX_NAME)) {
      await mongoose.connection.collection("flightshipmentallocations").dropIndex(LEGACY_ALLOCATION_INDEX_NAME);
      console.log(`Dropped legacy ${LEGACY_ALLOCATION_INDEX_NAME}.`);
    }

    await mongoose.connection.collection("operationsmanifests").createIndex(
      { flightLinehaulId: 1 },
      {
        unique: true,
        name: MANIFEST_INDEX_NAME,
        partialFilterExpression: {
          flightLinehaulId: { $type: "objectId" },
          status: { $in: ACTIVE_MANIFEST_STATUSES }
        }
      }
    );
    await mongoose.connection.collection("flightshipmentallocations").createIndex(
      { flightLinehaulId: 1, shipmentDraftId: 1 },
      {
        unique: true,
        name: ACTIVE_ALLOCATION_INDEX_NAME,
        partialFilterExpression: { status: "ALLOCATED" }
      }
    );
    await mongoose.connection.collection("flightlinehauls").createIndex(
      { mawbNumber: 1 },
      {
        unique: true,
        name: FLIGHT_MAWB_INDEX_NAME,
        partialFilterExpression: {
          mawbNumber: { $gt: "" },
          status: { $in: ACTIVE_FLIGHT_STATUSES }
        }
      }
    );
    console.log(`Created or confirmed ${MANIFEST_INDEX_NAME}, ${ACTIVE_ALLOCATION_INDEX_NAME}, and ${FLIGHT_MAWB_INDEX_NAME}.`);
  } finally {
    await mongoose.disconnect();
  }
}

migrate().catch((error) => {
  console.error("Flight linehaul index migration failed.", error);
  process.exitCode = 1;
});
