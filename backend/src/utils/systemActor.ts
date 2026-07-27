import mongoose from "mongoose";

// Fixed identifier used as the actor for automated (scheduled-job) actions where
// no human user is involved. It intentionally references no real User document;
// populating it simply yields null, which reads as "system".
export const SYSTEM_ACTOR_ID = new mongoose.Types.ObjectId("000000000000000000000000");
