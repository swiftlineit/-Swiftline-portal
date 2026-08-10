import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  isBlockedUserStatus,
  resolveDriverProfileStatus,
  resolveMemberStatusForUser,
  resolveUserStatusForMembership
} from "../services/userStatusSync.service.js";
import { normalizeUserPhone } from "../services/userIdentity.service.js";

describe("login status stays in step with access records", () => {
  test("suspended and disabled both block sign-in", () => {
    assert.equal(isBlockedUserStatus("suspended"), true);
    assert.equal(isBlockedUserStatus("disabled"), true);
    assert.equal(isBlockedUserStatus("active"), false);
    assert.equal(isBlockedUserStatus("invited"), false);
  });

  test("blocking a login is mirrored onto the driver profile", () => {
    assert.equal(resolveDriverProfileStatus("suspended", "ACTIVE", true), "SUSPENDED");
    assert.equal(resolveDriverProfileStatus("disabled", "ACTIVE", true), "DISABLED");
    // The reported bug: the Delivery Team page read the profile status, which
    // stayed ACTIVE while the login was already blocked.
    assert.notEqual(resolveDriverProfileStatus("disabled", "ACTIVE", true), "ACTIVE");
  });

  test("reactivation lifts a hold without granting approval", () => {
    assert.equal(resolveDriverProfileStatus("active", "SUSPENDED", true), "ACTIVE");
    assert.equal(resolveDriverProfileStatus("active", "DISABLED", false), "INVITED");
    // An approval still pending is not a hold, so it is left untouched.
    assert.equal(resolveDriverProfileStatus("active", "PENDING_APPROVAL", false), null);
    assert.equal(resolveDriverProfileStatus("active", "ACTIVE", true), null);
  });

  test("blocking a login suspends client access rather than removing it", () => {
    assert.equal(resolveMemberStatusForUser("suspended", "active", true), "suspended");
    assert.equal(resolveMemberStatusForUser("disabled", "invited", false), "suspended");
    assert.equal(resolveMemberStatusForUser("suspended", "suspended", true), null);
    assert.equal(resolveMemberStatusForUser("active", "suspended", true), "active");
    assert.equal(resolveMemberStatusForUser("active", "suspended", false), "invited");
    assert.equal(resolveMemberStatusForUser("active", "active", true), null);
  });

  test("withdrawing client access also stops the login", () => {
    assert.equal(resolveUserStatusForMembership("suspended"), "suspended");
    assert.equal(resolveUserStatusForMembership("removed"), "disabled");
    assert.equal(resolveUserStatusForMembership("active"), "active");
    assert.equal(resolveUserStatusForMembership("invited"), "invited");
  });
});

describe("staff phone numbers are one global identity", () => {
  test("a staff number typed without a country code canonicalizes like a client's", () => {
    // The staff form defaults to India; the client and driver forms demand the
    // country code. Both have to land on the same E.164 value or the unique index
    // never sees them as the same person.
    assert.equal(normalizeUserPhone("98765 43210", "IN"), "+919876543210");
    assert.equal(normalizeUserPhone("+91 98765 43210", "IN"), "+919876543210");
    assert.equal(normalizeUserPhone("+91 98765 43210"), "+919876543210");
    assert.equal(normalizeUserPhone("098765-43210", "IN"), "+919876543210");
  });

  test("a country code in the number still wins over the default", () => {
    assert.equal(normalizeUserPhone("+44 7400 123456", "IN"), "+447400123456");
  });

  test("an unusable number is rejected rather than stored uncanonicalized", () => {
    assert.equal(normalizeUserPhone("12345", "IN"), null);
    assert.equal(normalizeUserPhone("not-a-phone", "IN"), null);
  });
});
