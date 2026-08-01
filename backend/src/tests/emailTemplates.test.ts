import assert from "node:assert/strict";
import test from "node:test";
import { renderEmail } from "../services/email/layout.js";
import { getEmailTemplate, hasEmailTemplate } from "../services/email/templates/index.js";

const shipmentPayload = {
  trackingNumber: "SWL000123456",
  shipmentReference: "REF-8891",
  serviceType: "Courier",
  bookingProvider: "DPD",
  destination: "Manchester, United Kingdom",
  parcelCount: 3,
  totalWeightKg: 12.5,
  bookedAt: new Date("2026-07-30T09:15:00.000Z"),
  invoiceNumber: "SWL/2026-27/000412",
  currency: "INR",
  taxableValueMinor: 4500000,
  totalTaxAmountMinor: 810000,
  invoiceTotalMinor: 5310000,
  businessAccountName: "Northline Exports",
  branchName: "Delhi",
  bookedByName: "Priya Raman",
  href: "/client/shipments/665f0b2c1a",
  staffHref: "/dashboard/dpd-labels/665f0b2c1a"
};

function render(templateKey: string, payload: Record<string, unknown>, recipientName = "Priya Raman") {
  const content = getEmailTemplate(templateKey)({
    recipientName,
    payload,
    appUrl: "https://portal.swiftline.example"
  });
  return { content, ...renderEmail(content, "Footer note.") };
}

test("shipment booked client template renders the invoice and shipment facts", () => {
  const { content, html, text } = render("SHIPMENT_BOOKED_CLIENT", { ...shipmentPayload, labelsAttached: true });

  assert.match(content.subject, /SWL000123456/);
  assert.match(html, /SWL000123456/);
  assert.match(html, /SWL\/2026-27\/000412/);
  // Money must be rendered from minor units, never printed raw.
  assert.match(html, /53,100\.00/);
  assert.doesNotMatch(html, /5310000/);
  assert.match(html, /https:\/\/portal\.swiftline\.example\/client\/shipments\/665f0b2c1a/);
  assert.match(text, /SWL000123456/);
  assert.ok(text.length > 0, "a plaintext alternative is always produced");
});

test("shipment booked client template does not claim labels are attached when they are not", () => {
  const attached = render("SHIPMENT_BOOKED_CLIENT", { ...shipmentPayload, labelsAttached: true });
  const dropped = render("SHIPMENT_BOOKED_CLIENT", { ...shipmentPayload, labelsAttached: false });

  assert.match(attached.html, /Shipping labels are attached/);
  assert.doesNotMatch(dropped.html, /Shipping labels are attached/);
  assert.match(dropped.html, /download from the portal/);
});

test("shipment booked staff template names the account and the booker", () => {
  const { content, html } = render("SHIPMENT_BOOKED_STAFF", shipmentPayload);

  assert.match(content.subject, /Northline Exports/);
  assert.match(html, /Priya Raman/);
  assert.match(html, /Delhi/);
  assert.match(html, /\/dashboard\/dpd-labels\/665f0b2c1a/);
});

test("generic template covers any notification type without a bespoke file", () => {
  assert.equal(hasEmailTemplate("SUPPORT_TICKET_REPLY"), false);

  const { content, html, text } = render("SUPPORT_TICKET_REPLY", {
    title: "New reply on ticket TKT-204",
    message: "Operations replied to your ticket about a delayed pickup.",
    href: "/client/tickets/abc#ticket-conversation"
  });

  assert.equal(content.subject, "New reply on ticket TKT-204");
  assert.match(html, /Operations replied to your ticket/);
  assert.match(html, /https:\/\/portal\.swiftline\.example\/client\/tickets\/abc#ticket-conversation/);
  assert.match(text, /Operations replied to your ticket/);
});

test("payload values are HTML escaped", () => {
  const { html } = render("SUPPORT_TICKET_REPLY", {
    title: "Reply <script>alert(1)</script>",
    message: "Contains \"quotes\" & ampersands",
    href: "/client/tickets/abc"
  });

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp;/);
});

test("missing optional payload values degrade instead of printing undefined", () => {
  const { html, text } = render("SHIPMENT_BOOKED_CLIENT", {
    invoiceNumber: "SWL/2026-27/000001",
    currency: "INR",
    invoiceTotalMinor: 100000
  });

  assert.doesNotMatch(html, /undefined/);
  assert.doesNotMatch(text, /undefined/);
  assert.doesNotMatch(html, /NaN/);
});

test("invitation and reset templates surface their action link and expiry", () => {
  const invitation = render("CLIENT_INVITATION", {
    companyName: "Northline Exports",
    activationUrl: "https://portal.swiftline.example/activate?token=abc123",
    expiresAt: new Date("2026-08-03T10:00:00.000Z")
  });
  assert.match(invitation.html, /activate\?token=abc123/);
  assert.match(invitation.html, /expires/i);

  const reset = render("PASSWORD_RESET", {
    resetUrl: "https://portal.swiftline.example/reset?token=xyz789",
    expiresAt: new Date("2026-08-01T11:00:00.000Z")
  });
  assert.match(reset.content.subject, /Reset your Swiftline Portal password/);
  assert.match(reset.html, /reset\?token=xyz789/);
});
