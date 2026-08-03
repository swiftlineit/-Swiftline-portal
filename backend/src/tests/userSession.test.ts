import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { createAccessToken, createRefreshToken, verifyAccessToken } from "../services/auth.service.js";

const user = { id: "68f0000000000000000000aa", role: "admin", email: "ops@swiftline.test" };

describe("session-bound tokens", () => {
  it("carries the session id on both tokens when one is supplied", () => {
    const access = verifyAccessToken(createAccessToken(user, "sess-1"));
    const refresh = jwt.verify(createRefreshToken(user, "sess-1"), env.JWT_SECRET) as { sid?: string };

    assert.equal(access.sid, "sess-1");
    assert.equal(refresh.sid, "sess-1");
  });

  it("omits the claim entirely when no session is supplied", () => {
    // Tokens issued before sessions existed must stay readable, and must not
    // gain a bogus session id that would fail verification.
    const access = verifyAccessToken(createAccessToken(user));

    assert.equal(access.sid, undefined);
    assert.equal(access.sub, user.id);
    assert.equal(access.role, "admin");
  });

  it("keeps the rest of the access token payload intact", () => {
    const access = verifyAccessToken(createAccessToken(user, "sess-2"));

    assert.equal(access.sub, user.id);
    assert.equal(access.email, user.email);
    assert.equal(access.role, user.role);
  });
});

describe("single-session configuration", () => {
  it("is off by default so a deploy cannot lock anyone out", () => {
    // The flag is what makes this safe to ship: sessions are recorded and
    // audited either way, but nothing is refused until it is switched on.
    assert.equal(typeof env.SINGLE_SESSION_ENFORCED, "boolean");
    assert.equal(env.SINGLE_SESSION_ENFORCED, false);
  });

  it("has a positive idle timeout", () => {
    assert.ok(env.SESSION_IDLE_TIMEOUT_MINUTES > 0);
  });
});
