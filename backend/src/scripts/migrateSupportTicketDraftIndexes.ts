import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { SupportTicket } from "../models/supportTicket.model.js";
import { SupportTicketDraft } from "../models/supportTicketDraft.model.js";

async function migrateSupportTicketDraftIndexes() {
  await connectDatabase();
  try {
    await SupportTicket.createIndexes();
    await SupportTicketDraft.createIndexes();
    console.log("Support ticket draft indexes are up to date.");
  } finally {
    await mongoose.disconnect();
  }
}

migrateSupportTicketDraftIndexes().catch((error) => {
  console.error("Support ticket draft index migration failed.", error);
  process.exitCode = 1;
});
