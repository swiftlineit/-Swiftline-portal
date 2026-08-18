import mongoose from "mongoose";
import { env } from "../config/env.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import {
  SupportTicket,
  openSupportTicketStatusValues,
  supportTicketStatusLabels
} from "../models/supportTicket.model.js";
import { notifyOperationsStaff } from "../services/portalNotification.service.js";

/**
 * Alerts Swiftline when a ticket misses its first-response deadline.
 *
 * Nothing else can raise this. Every other ticket notification hangs off
 * somebody acting; a breach happens because time passed and no one did, so
 * without a scheduled pass the one event that most needs attention is the only
 * one that goes unannounced.
 *
 * Deliberately does not touch the ticket. Raising its priority would overwrite
 * a judgement a person made, and reporting on "how many URGENT tickets" would
 * start counting the sweeper's own edits rather than the business's.
 *
 * Run every 15-30 minutes:
 *   npm run job:tickets:sla-escalation
 *
 * Safe to run as often as you like: escalation is stamped on the ticket, so a
 * breach is announced once and re-running is a no-op.
 */

/** How many tickets one pass will escalate, so a backlog cannot flood inboxes. */
const MAX_PER_RUN = 200;

function hoursLate(dueAt: Date, now: Date) {
  return Math.max(0, Math.round(((now.getTime() - dueAt.getTime()) / (60 * 60 * 1000)) * 10) / 10);
}

async function main() {
  await mongoose.connect(env.MONGODB_URI, { family: 4 });
  const now = new Date();

  /**
   * A breach is: past due, never responded to, and still open.
   *
   * `firstRespondedAt: null` is the whole test for "unanswered"- a ticket
   * answered late is not breaching now, it breached and was dealt with, and
   * alerting on it would bury the ones still waiting.
   */
  const breached = await SupportTicket.find({
    firstResponseDueAt: { $lt: now },
    firstRespondedAt: null,
    slaEscalatedAt: null,
    status: { $in: openSupportTicketStatusValues }
  })
    .sort({ firstResponseDueAt: 1 })
    .limit(MAX_PER_RUN)
    .exec();

  if (!breached.length) {
    console.log("No unescalated SLA breaches.");
    await mongoose.disconnect();
    return;
  }

  const accounts = await BusinessAccount.find({ _id: { $in: breached.map((ticket) => ticket.businessAccountId) } })
    .select("accountId company.companyName")
    .lean()
    .exec();
  const accountById = new Map(accounts.map((account) => [String(account._id), account]));

  let escalated = 0;
  for (const ticket of breached) {
    const account = accountById.get(String(ticket.businessAccountId));
    const accountLabel = account
      ? `${account.company?.companyName ?? "Customer"} (${account.accountId})`
      : "Customer";
    const late = hoursLate(ticket.firstResponseDueAt, now);
    const title = `SLA exceeded- ${ticket.ticketNumber}`;
    const message = `${accountLabel} has waited ${late}h past the ${ticket.priority.toLowerCase()} first-response deadline. Status: ${supportTicketStatusLabels[ticket.status]}.`;

    /**
     * One call, both channels.
     *
     * Email is a delivery channel on the notification here, not a parallel
     * system- every notify* helper queues mail for the types the catalogue
     * enables. Queueing separately alongside this would collide on the same
     * idempotency key and let one write silently overwrite the other.
     */
    await notifyOperationsStaff({
      businessAccountId: ticket.businessAccountId,
      // One breach, one notification row per member, however often this runs.
      idempotencyKey: `ticket-sla-${String(ticket._id)}`,
      type: "SUPPORT_TICKET_SLA_BREACHED",
      title,
      message,
      href: `/dashboard/tickets/${String(ticket._id)}`,
      // Carried into the email body as well as the notification row, so the
      // alert names the ticket without the reader opening the portal.
      metadata: {
        ticketNumber: ticket.ticketNumber,
        ticketSubject: ticket.subject,
        customer: accountLabel,
        priority: ticket.priority,
        status: supportTicketStatusLabels[ticket.status],
        hoursLate: late,
        dueAt: ticket.firstResponseDueAt.toISOString()
      }
    });

    ticket.slaEscalatedAt = now;
    await ticket.save();
    escalated += 1;
    console.log(`Escalated ${ticket.ticketNumber} (${late}h late)`);
  }

  console.log(`\nEscalated ${escalated} ticket(s).`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
