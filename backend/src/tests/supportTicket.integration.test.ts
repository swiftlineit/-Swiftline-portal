import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { AuditLog } from "../models/auditLog.model.js";
import { Branch } from "../models/branch.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { BusinessAccountMember } from "../models/businessAccountMember.model.js";
import { PortalNotification } from "../models/portalNotification.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { SupportTicket } from "../models/supportTicket.model.js";
import { SupportTicketCounter } from "../models/supportTicketCounter.model.js";
import { SupportTicketMessage } from "../models/supportTicketMessage.model.js";
import { User } from "../models/user.model.js";
import {
  SupportTicketError, addSupportTicketReply, createClientSupportTicket, getSupportTicket,
  listClientSupportTickets, serializeSupportTicket, updateSupportTicketByAdmin
} from "../services/supportTicket.service.js";

const databaseName = `swiftline_support_ticket_${Date.now()}`;

before(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: databaseName, family: 4, retryWrites: false });
  assert.equal(mongoose.connection.name, databaseName);
  await Promise.all([
    AuditLog.init(), Branch.init(), BusinessAccount.init(), BusinessAccountMember.init(), PortalNotification.init(),
    SupportTicket.init(), SupportTicketCounter.init(), SupportTicketMessage.init(), User.init()
  ]);
}, { timeout: 120_000 });

after(async () => {
  if (mongoose.connection.readyState !== 0) {
    assert.ok(mongoose.connection.name.startsWith("swiftline_support_ticket_"));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

async function fixture() {
  const unique = Date.now();
  const [admin, owner, operations] = await User.create([
    { name: "Support Admin", email: `support-admin-${unique}@example.test`, role: "admin", userStatus: "active", isVerified: true },
    { name: "Account Owner", email: `ticket-owner-${unique}@example.test`, role: "client", userStatus: "active", isVerified: true },
    { name: "Operations User", email: `ticket-operations-${unique}@example.test`, role: "client", userStatus: "active", isVerified: true }
  ]);
  assert.ok(admin && owner && operations);
  const branch = await Branch.create({
    name: "Support Test Branch", code: `ST-${String(unique).slice(-8)}`, status: "ACTIVE",
    address: { countryCode: "IN", countryName: "India", city: "Delhi" },
    operations: { supportedServices: [], shipmentCoverage: [], operatingCountries: ["IN"], workingDays: [] },
    createdBy: admin._id
  });
  const business = await BusinessAccount.create({
    accountId: `TICKET-${unique}`, status: "active",
    contact: {
      title: "mr.", firstName: "Ticket", lastName: "Owner", email: owner.email, mobileType: "mobile",
      // Unique per fixture: live accounts carry a unique index on
      // (countryCode, mobileNumber), and this fixture runs more than once.
      countryCode: "+91", mobileNumber: `9${String(unique).slice(-9)}`, jobTitle: "Owner", department: "Operations",
      shipmentTypes: ["international_courier"]
    },
    company: {
      registrationCountry: "India", registrationId: `SUPPORT${unique}`, companyType: "pvt_ltd",
      companyName: "Support Ticket Test Company", registeredAddress: "Test Address", city: "Delhi",
      stateOrProvince: "Delhi", postalCode: "110001", addressCountry: "India",
      operatingCountries: ["India"], industry: "Testing", monthlyShipmentVolume: "1-10",
      requestedCreditLimit: { currency: "INR", amount: 0 }
    },
    kycReview: { overallStatus: "verified", checks: {} }, assignedBranch: branch._id, createdBy: admin._id
  });
  await BusinessAccountMember.create([
    { businessAccount: business._id, user: owner._id, role: "account_owner", status: "active", invitedBy: admin._id, joinedAt: new Date() },
    { businessAccount: business._id, user: operations._id, role: "operations", status: "active", invitedBy: admin._id, joinedAt: new Date() }
  ]);
  return { admin, owner, operations, business, branch };
}

/** A minimal draft, enough for the related-shipment ownership check. */
async function shipmentFixture(businessAccountId: mongoose.Types.ObjectId, branchId: mongoose.Types.ObjectId, createdBy: mongoose.Types.ObjectId) {
  return ShipmentDraft.create({
    creationSource: "MANUAL", businessAccountId, branchId,
    consigneeEnteredAddress: { contactName: "Test Consignee" }, parcelCount: 1, createdBy
  });
}

const listFilters = { page: 1, limit: 20 };

describe("support ticket lifecycle", () => {
  test("enforces visibility, immutable conversation history and admin reopen", { timeout: 120_000 }, async () => {
    const { admin, owner, operations, business } = await fixture();
    const ownerTicket = await createClientSupportTicket(owner._id, {
      businessAccountId: String(business._id), category: "TRACKING",
      subject: "Tracking status needs review", description: "The tracking status has not changed since collection."
    });
    const operationsTicket = await createClientSupportTicket(operations._id, {
      businessAccountId: String(business._id), category: "SHIPMENT_BOOKING",
      subject: "Shipment booking requires help", description: "The shipment booking needs support from the assigned branch."
    });
    assert.match(ownerTicket.ticketNumber, /^TKT\/\d{2}-\d{2}\/\d{5}$/);
    assert.equal(ownerTicket.status, "OPEN");
    assert.notEqual(ownerTicket.ticketNumber, operationsTicket.ticketNumber);

    const ownerList = await listClientSupportTickets(owner._id, listFilters);
    const operationsList = await listClientSupportTickets(operations._id, listFilters);
    assert.equal(ownerList.total, 2, "Account owners can see company tickets.");
    assert.equal(operationsList.total, 1, "Operations users can only see tickets they created.");
    assert.equal(operationsList.tickets[0]?.id, String(operationsTicket._id));

    await addSupportTicketReply({ ticket: ownerTicket, userId: admin._id, audience: "ADMIN", message: "Private investigation note.", internal: true });
    await addSupportTicketReply({ ticket: ownerTicket, userId: admin._id, audience: "ADMIN", message: "Swiftline is reviewing the tracking scan.", internal: false });
    const clientView = await serializeSupportTicket(ownerTicket, "CLIENT", true);
    const adminView = await serializeSupportTicket(ownerTicket, "ADMIN", true);
    assert.equal(clientView.messages.some((message) => message.internal), false);
    assert.equal(clientView.messages.some((message) => message.message.includes("Private investigation")), false);
    assert.equal(adminView.messages.some((message) => message.internal), true);

    await updateSupportTicketByAdmin({ ticket: ownerTicket, userId: admin._id, status: "CLOSED", note: "Request completed." });
    await assert.rejects(
      addSupportTicketReply({ ticket: ownerTicket, userId: owner._id, audience: "CLIENT", message: "Please check this again." }),
      (error: unknown) => error instanceof SupportTicketError && error.statusCode === 409
    );
    await updateSupportTicketByAdmin({ ticket: ownerTicket, userId: admin._id, status: "IN_PROGRESS", note: "Reopened after further review." });
    assert.equal(ownerTicket.status, "IN_PROGRESS");
    assert.deepEqual(ownerTicket.statusHistory.slice(-2).map((item) => item.toStatus), ["CLOSED", "IN_PROGRESS"]);

    await assert.rejects(
      SupportTicketMessage.updateOne({ ticketId: ownerTicket._id }, { $set: { message: "Changed" } }).exec(),
      /append-only/
    );
    assert.ok(await getSupportTicket(String(ownerTicket._id), "CLIENT", owner._id));
    await assert.rejects(
      getSupportTicket(String(ownerTicket._id), "CLIENT", operations._id),
      (error: unknown) => error instanceof SupportTicketError && error.statusCode === 404
    );
  });

  test("holds one live ticket per shipment and caps customer replies after resolution", { timeout: 120_000 }, async () => {
    const { admin, owner, business, branch } = await fixture();
    const shipment = await shipmentFixture(business._id, branch._id, owner._id);
    const businessAccountId = String(business._id);
    const relatedShipmentDraftId = String(shipment._id);

    // A shipment problem is only actionable against a named shipment.
    await assert.rejects(
      createClientSupportTicket(owner._id, {
        businessAccountId, category: "SHIPMENT_LOST",
        subject: "Shipment cannot be found", description: "The shipment has not arrived and tracking has stopped."
      }),
      (error: unknown) => error instanceof SupportTicketError && error.statusCode === 400
    );

    const first = await createClientSupportTicket(owner._id, {
      businessAccountId, category: "SHIPMENT_LOST", relatedShipmentDraftId,
      subject: "Shipment cannot be found", description: "The shipment has not arrived and tracking has stopped."
    });

    // A second ticket for the same shipment would split one conversation.
    await assert.rejects(
      createClientSupportTicket(owner._id, {
        businessAccountId, category: "SHIPMENT_DAMAGED", relatedShipmentDraftId,
        subject: "Shipment arrived damaged", description: "The parcel was delivered with a crushed corner."
      }),
      (error: unknown) => error instanceof SupportTicketError && error.statusCode === 409
    );

    await updateSupportTicketByAdmin({ ticket: first, userId: admin._id, status: "RESOLVED", note: "Parcel located and delivered." });

    // Resolving releases the shipment for a fresh ticket.
    const second = await createClientSupportTicket(owner._id, {
      businessAccountId, category: "SHIPMENT_DAMAGED", relatedShipmentDraftId,
      subject: "Shipment arrived damaged", description: "The parcel was delivered with a crushed corner."
    });
    assert.notEqual(String(second._id), String(first._id));

    // Two customer follow-ups are allowed on the resolved ticket, then no more.
    await addSupportTicketReply({ ticket: first, userId: owner._id, audience: "CLIENT", message: "Thanks, but one box is still missing." });
    await addSupportTicketReply({ ticket: first, userId: admin._id, audience: "ADMIN", message: "Checking with the destination hub." });
    await addSupportTicketReply({ ticket: first, userId: owner._id, audience: "CLIENT", message: "Any update on the missing box?" });
    await assert.rejects(
      addSupportTicketReply({ ticket: first, userId: owner._id, audience: "CLIENT", message: "Still waiting for an answer." }),
      (error: unknown) => error instanceof SupportTicketError && error.statusCode === 409
    );

    // Swiftline is never capped, so the customer's last question can be answered.
    await addSupportTicketReply({ ticket: first, userId: admin._id, audience: "ADMIN", message: "The box was found and is out for delivery." });

    const clientView = await serializeSupportTicket(first, "CLIENT", true);
    assert.deepEqual(clientView.resolvedReplyAllowance, { used: 2, max: 2 });
    // The allowance only applies once resolved, so an open ticket reports none.
    assert.equal((await serializeSupportTicket(second, "CLIENT", true)).resolvedReplyAllowance, null);
  });
});
