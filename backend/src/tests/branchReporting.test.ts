import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request } from "express";
import mongoose from "mongoose";
import {
  membershipAppliesToBranch,
  resolveBranchFinanceRange
} from "../controllers/branchReporting.controller.js";
import { allowedBranchIds, canAccessBranch } from "../middleware/branchAccess.middleware.js";

function requestFor(role: string, assignedBranches: mongoose.Types.ObjectId[] = []) {
  return { user: { _id: new mongoose.Types.ObjectId(), role, assignedBranches } } as unknown as Request;
}

describe("branch finance reporting dates", () => {
  it("defaults to the current India-local month and includes the entire end day", () => {
    const range = resolveBranchFinanceRange({}, new Date("2026-08-10T05:00:00.000Z"));
    assert.equal(range.from, "2026-08-01");
    assert.equal(range.to, "2026-08-10");
    assert.equal(range.fromDate.toISOString(), "2026-07-31T18:30:00.000Z");
    assert.equal(range.toExclusive.toISOString(), "2026-08-10T18:30:00.000Z");
  });

  it("rejects invalid and reversed custom ranges", () => {
    assert.throws(
      () => resolveBranchFinanceRange({ from: "2026-02-30", to: "2026-03-01" }),
      /valid reporting date range/
    );
    assert.throws(
      () => resolveBranchFinanceRange({ from: "2026-08-11", to: "2026-08-10" }),
      /cannot be after/
    );
  });
});

describe("branch user membership scope", () => {
  it("uses explicit member branches when present and otherwise inherits the account branch", () => {
    const branch = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    assert.equal(membershipAppliesToBranch([], branch, branch), true);
    assert.equal(membershipAppliesToBranch([], other, branch), false);
    assert.equal(membershipAppliesToBranch([branch], other, branch), true);
    assert.equal(membershipAppliesToBranch([other], branch, branch), false);
  });
});

describe("internal branch access", () => {
  it("keeps admin global and scopes other internal roles to assigned branches", () => {
    const branch = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();

    assert.equal(allowedBranchIds(requestFor("admin")), null);
    assert.equal(canAccessBranch(requestFor("admin"), other), true);
    assert.equal(canAccessBranch(requestFor("operations", [branch]), branch), true);
    assert.equal(canAccessBranch(requestFor("operations", [branch]), other), false);
    assert.equal(canAccessBranch(requestFor("finance", [branch]), branch), true);
    assert.equal(canAccessBranch(requestFor("hr"), branch), false);
  });
});
