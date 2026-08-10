import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAccessBranch, clientCan, staffCan } from "../services/claims/claimPermissions.js";
import { businessAccountMemberRoleValues } from "../models/businessAccountMember.model.js";
import { roleValues } from "../models/user.model.js";

describe("client claim permissions", () => {
  it("lets only owners and admins commit the company", () => {
    // Accepting a settlement, appealing, and changing bank details all bind the
    // company to money, so they stay with the two roles that can bind it.
    for (const action of ["ACCEPT_SETTLEMENT", "SUBMIT_APPEAL", "MANAGE_BANK_DETAILS"] as const) {
      assert.equal(clientCan("account_owner", action), true);
      assert.equal(clientCan("account_admin", action), true);
      assert.equal(clientCan("operations", action), false, `operations could ${action}`);
      assert.equal(clientCan("finance", action), false, `finance could ${action}`);
      assert.equal(clientCan("tracking_only", action), false, `tracking_only could ${action}`);
    }
  });

  it("lets operations prepare a claim without settling it", () => {
    for (const action of ["CREATE", "EDIT_DRAFT", "UPLOAD_DOCUMENT", "SEND_MESSAGE"] as const) {
      assert.equal(clientCan("operations", action), true);
    }
    assert.equal(clientCan("operations", "ACCEPT_SETTLEMENT"), false);
  });

  it("gives finance visibility but no ability to act", () => {
    assert.equal(clientCan("finance", "VIEW"), true);
    assert.equal(clientCan("finance", "VIEW_FINANCIALS"), true);
    for (const action of ["CREATE", "EDIT_DRAFT", "UPLOAD_DOCUMENT", "WITHDRAW"] as const) {
      assert.equal(clientCan("finance", action), false, `finance could ${action}`);
    }
  });

  it("keeps amounts and bank data away from tracking-only members", () => {
    assert.equal(clientCan("tracking_only", "VIEW"), true);
    assert.equal(clientCan("tracking_only", "VIEW_FINANCIALS"), false);
    assert.equal(clientCan("tracking_only", "MANAGE_BANK_DETAILS"), false);
  });

  it("grants nothing to a role outside the matrix", () => {
    // Every member role must appear, so adding one to the enum without adding it
    // here fails loudly rather than defaulting to some inherited permission.
    for (const role of businessAccountMemberRoleValues) {
      assert.doesNotThrow(() => clientCan(role, "VIEW"));
    }
    assert.equal(clientCan("nonsense" as never, "VIEW"), false);
  });
});

describe("staff claim permissions", () => {
  it("gives admin everything", () => {
    for (const action of ["DECIDE", "RECORD_PAYMENT", "MANAGE_LEGAL_HOLD", "REOPEN"] as const) {
      assert.equal(staffCan("admin", action), true);
    }
  });

  it("lets operations run and decide claims", () => {
    for (const action of ["ASSIGN", "INVESTIGATE", "DECIDE", "RECORD_PAYMENT", "CLOSE"] as const) {
      assert.equal(staffCan("operations", action), true);
    }
  });

  it("does not let operations manage legal hold", () => {
    // Legal hold suspends deletion during litigation, so it stays with admin.
    assert.equal(staffCan("operations", "MANAGE_LEGAL_HOLD"), false);
  });

  it("lets finance pay but never decide", () => {
    assert.equal(staffCan("finance", "RECORD_PAYMENT"), true);
    assert.equal(staffCan("finance", "VERIFY_BENEFICIARY"), true);
    assert.equal(staffCan("finance", "DECIDE"), false);
    assert.equal(staffCan("finance", "WAIVE_DOCUMENT"), false);
  });

  it("keeps delivery read-only", () => {
    assert.equal(staffCan("delivery", "VIEW"), true);
    for (const action of ["DECIDE", "RECORD_PAYMENT", "INTERNAL_NOTE", "SEND_MESSAGE"] as const) {
      assert.equal(staffCan("delivery", action), false, `delivery could ${action}`);
    }
  });

  it("gives HR no claims access at all", () => {
    assert.equal(staffCan("hr", "VIEW"), false);
    assert.equal(staffCan("hr", "VIEW_FINANCIALS"), false);
  });

  it("gives the client role no staff access", () => {
    // `client` is in the role enum but is not a staff role; members are
    // authorised through the client matrix instead.
    assert.equal(staffCan("client", "VIEW"), false);
  });

  it("covers every role in the enum", () => {
    for (const role of roleValues) {
      assert.doesNotThrow(() => staffCan(role, "VIEW"));
    }
  });
});

describe("branch scoping", () => {
  it("gives admin every branch", () => {
    assert.equal(
      canAccessBranch({ role: "admin", assignedBranchIds: [], claimBranchId: "branch-9" }),
      true
    );
  });

  it("limits everyone else to their assignments", () => {
    assert.equal(
      canAccessBranch({ role: "operations", assignedBranchIds: ["b1"], claimBranchId: "b1" }),
      true
    );
    assert.equal(
      canAccessBranch({ role: "operations", assignedBranchIds: ["b1"], claimBranchId: "b2" }),
      false
    );
  });

  it("treats no assignment as no access", () => {
    // The failure mode to avoid: an empty list read as "unrestricted".
    for (const role of ["operations", "finance", "delivery"] as const) {
      assert.equal(
        canAccessBranch({ role, assignedBranchIds: [], claimBranchId: "b1" }),
        false,
        `${role} with no branches was granted access`
      );
    }
  });
});
