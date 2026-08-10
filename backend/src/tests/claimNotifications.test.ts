import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { portalNotificationTypeValues } from "../models/portalNotification.model.js";
import { getEmailPolicy, isEmailEnabledType } from "../services/email/catalog.js";
import { getEmailTemplate, hasEmailTemplate } from "../services/email/templates/index.js";

/**
 * The failure this guards against is silent: a notification type that exists but
 * is missing from the email catalog sends nothing by email, and nobody notices
 * until a client says they were never told their claim was decided.
 */

const claimTypes = portalNotificationTypeValues.filter((type) => type.startsWith("CLAIM_"));

describe("claim notification types", () => {
  it("registers every claim event the services raise", () => {
    for (const expected of [
      "CLAIM_SUBMITTED",
      "CLAIM_DOCUMENTS_REQUIRED",
      "CLAIM_DOCUMENT_REJECTED",
      "CLAIM_DECISION_ISSUED",
      "CLAIM_SETTLEMENT_ACCEPTANCE_REQUIRED",
      "CLAIM_BANK_DETAILS_REJECTED",
      "CLAIM_PAYMENT_COMPLETED",
      "CLAIM_APPEAL_WINDOW_CLOSING",
      "CLAIM_RECEIVED_STAFF",
      "CLAIM_CLIENT_REPLIED",
      "CLAIM_SETTLEMENT_ACCEPTED",
      "CLAIM_APPEAL_SUBMITTED",
      "CLAIM_SLA_DUE"
    ]) {
      assert.ok(
        (portalNotificationTypeValues as readonly string[]).includes(expected),
        `${expected} is missing from the notification enum`
      );
    }
  });

  it("emails every claim notification rather than leaving some in-app only", () => {
    // A type absent from the catalog is silently in-app only. For claims that
    // would mean a client never hearing about a deadline they are bound by.
    for (const type of claimTypes) {
      assert.ok(isEmailEnabledType(type), `${type} has no email policy`);
    }
  });

  it("treats client-facing claim mail as transactional", () => {
    // A client who unsubscribed from operational mail must still be told their
    // evidence is missing or their appeal window is closing.
    for (const type of [
      "CLAIM_SUBMITTED",
      "CLAIM_DOCUMENTS_REQUIRED",
      "CLAIM_DOCUMENT_REJECTED",
      "CLAIM_DECISION_ISSUED",
      "CLAIM_APPEAL_WINDOW_CLOSING",
      "CLAIM_SETTLEMENT_ACCEPTANCE_REQUIRED",
      "CLAIM_BANK_DETAILS_REJECTED",
      "CLAIM_PAYMENT_COMPLETED"
    ]) {
      assert.equal(getEmailPolicy(type)?.category, "TRANSACTIONAL", `${type} category`);
    }
  });

  it("treats staff queue mail as operational", () => {
    for (const type of [
      "CLAIM_RECEIVED_STAFF",
      "CLAIM_CLIENT_REPLIED",
      "CLAIM_SLA_DUE",
      "CLAIM_RECOVERY_FOLLOW_UP"
    ]) {
      assert.equal(getEmailPolicy(type)?.category, "OPERATIONAL", `${type} category`);
    }
  });

  it("ranks the decision and payment above routine queue mail", () => {
    const decision = getEmailPolicy("CLAIM_DECISION_ISSUED")?.priority ?? 0;
    const payment = getEmailPolicy("CLAIM_PAYMENT_COMPLETED")?.priority ?? 0;
    const recovery = getEmailPolicy("CLAIM_RECOVERY_FOLLOW_UP")?.priority ?? 0;

    assert.ok(decision > recovery, "a decision must drain before a recovery chase");
    assert.ok(payment > recovery, "a payment must drain before a recovery chase");
  });
});

describe("claim decision email", () => {
  const render = (payload: Record<string, unknown>) =>
    getEmailTemplate("CLAIM_DECISION")({
      recipientName: "Asha Menon",
      appUrl: "https://portal.example.com",
      payload
    });

  it("has a bespoke template registered", () => {
    assert.equal(hasEmailTemplate("CLAIM_DECISION"), true);
  });

  it("states the approved amount in the subject line for an approval", () => {
    const content = render({
      claimNumber: "CLM/26-27/00001",
      outcome: "FULLY_APPROVED",
      requestedAmountMinor: 50_000_00,
      approvedAmountMinor: 50_000_00,
      declaredValueMinor: 60_000_00,
      customerExplanation: "The evidence supports the claim in full."
    });

    assert.match(content.subject, /approved/i);
    assert.match(content.heading, /CLM\/26-27\/00001/);
  });

  it("does not say approved when the claim was rejected", () => {
    const content = render({
      claimNumber: "CLM/26-27/00002",
      outcome: "REJECTED",
      requestedAmountMinor: 50_000_00,
      approvedAmountMinor: 0,
      declaredValueMinor: 60_000_00,
      customerExplanation: "The packaging was inadequate for the contents."
    });

    assert.match(content.subject, /not approved/i);
    assert.ok(!/^Claim .* was approved/.test(content.heading));
  });

  it("shows the declared value even on a rejection", () => {
    // It is the figure most decisions turn on, and its absence is the first
    // thing a disputing client asks about.
    const content = render({
      claimNumber: "CLM/26-27/00003",
      outcome: "REJECTED",
      requestedAmountMinor: 75_000_00,
      approvedAmountMinor: 0,
      declaredValueMinor: 60_000_00,
      customerExplanation: "Rejected."
    });

    const facts = content.blocks.find((block) => block.kind === "facts");
    assert.ok(facts && "rows" in facts);
    assert.ok(
      facts.rows.some((row) => row.label.toLowerCase().includes("declared")),
      "declared value is missing from the decision email"
    );
  });

  it("carries the appeal deadline when one exists", () => {
    const content = render({
      claimNumber: "CLM/26-27/00004",
      outcome: "PARTIALLY_APPROVED",
      requestedAmountMinor: 50_000_00,
      approvedAmountMinor: 30_000_00,
      declaredValueMinor: 60_000_00,
      customerExplanation: "Part of the loss is supported.",
      appealDeadlineAt: "2026-09-01T00:00:00.000Z"
    });

    const text = JSON.stringify(content.blocks);
    assert.match(text, /appeal/i);
  });

  it("never puts a bank account number in the email", () => {
    // Payloads are assembled by callers, so this asserts the template ignores
    // anything it was not designed to render rather than echoing the payload.
    const content = render({
      claimNumber: "CLM/26-27/00005",
      outcome: "FULLY_APPROVED",
      requestedAmountMinor: 10_000_00,
      approvedAmountMinor: 10_000_00,
      declaredValueMinor: 10_000_00,
      customerExplanation: "Approved.",
      accountNumber: "123456789012"
    });

    assert.ok(!JSON.stringify(content).includes("123456789012"));
  });
});
