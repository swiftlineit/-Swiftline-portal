import assert from "node:assert/strict";
import mongoose from "mongoose";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { createPasswordLoginLimiters } from "../middleware/rateLimit.middleware.js";
import { User } from "../models/user.model.js";
import {
  passwordLockDetails,
  recordFailedPasswordAttempt
} from "../services/authLockout.service.js";

type TestServer = { server: Server; url: string };
const openServers = new Set<Server>();

after(async () => {
  await Promise.all([...openServers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function startLoginServer(accountMax: number, networkMax: number): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  const limiters = createPasswordLoginLimiters({ accountMax, networkMax });

  app.post("/login", limiters.network, limiters.account, (request, response) => {
    const status = typeof request.body?.status === "number" ? request.body.status : 200;
    response.status(status).json({ handled: true });
  });

  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  openServers.add(server);
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}/login` };
}

async function stopLoginServer(server: Server) {
  openServers.delete(server);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function attempt(url: string, email: string, status: number) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, status })
  });
  return { response, body: await response.json() as { handled?: boolean; message?: string } };
}

describe("password login rate limiting", () => {
  it("does not block another account sharing the same office IP", async () => {
    const { server, url } = await startLoginServer(2, 20);
    try {
      assert.equal((await attempt(url, "first@swiftlineindia.com", 401)).response.status, 401);
      assert.equal((await attempt(url, "FIRST@swiftlineindia.com", 401)).response.status, 401);

      const blocked = await attempt(url, "first@swiftlineindia.com", 401);
      assert.equal(blocked.response.status, 429);
      assert.match(blocked.body.message ?? "", /15 minutes/i);

      const colleague = await attempt(url, "second@swiftlineindia.com", 200);
      assert.equal(colleague.response.status, 200);
      assert.equal(colleague.body.handled, true);
    } finally {
      await stopLoginServer(server);
    }
  });

  it("does not count backend errors as wrong-password attempts", async () => {
    const { server, url } = await startLoginServer(2, 20);
    try {
      for (let index = 0; index < 3; index += 1) {
        const serverError = await attempt(url, "user@swiftlineindia.com", 500);
        assert.equal(serverError.response.status, 500);
        assert.equal(serverError.body.handled, true);
      }

      assert.equal((await attempt(url, "user@swiftlineindia.com", 401)).response.status, 401);
      assert.equal((await attempt(url, "user@swiftlineindia.com", 401)).response.status, 401);
      assert.equal((await attempt(url, "user@swiftlineindia.com", 401)).response.status, 429);
    } finally {
      await stopLoginServer(server);
    }
  });

  it("keeps a higher network-wide emergency brake for password spraying", async () => {
    const { server, url } = await startLoginServer(2, 3);
    try {
      for (let index = 0; index < 3; index += 1) {
        assert.equal((await attempt(url, `user${index}@swiftlineindia.com`, 401)).response.status, 401);
      }

      const blocked = await attempt(url, "another@swiftlineindia.com", 401);
      assert.equal(blocked.response.status, 429);
      assert.match(blocked.body.message ?? "", /network/i);
    } finally {
      await stopLoginServer(server);
    }
  });
});

describe("password account lock warning", () => {
  it("explicitly enables Mongoose aggregation-pipeline updates", async () => {
    const originalFindOneAndUpdate = User.findOneAndUpdate;
    const now = new Date("2026-08-10T10:00:00.000Z");
    const expectedLock = new Date(now.getTime() + 15 * 60 * 1000);
    let captured: { update?: unknown; options?: { updatePipeline?: boolean } } = {};

    try {
      (User as any).findOneAndUpdate = (_filter: unknown, update: unknown, options: { updatePipeline?: boolean }) => {
        captured = { update, options };
        const query = {
          select() { return query; },
          lean() { return query; },
          async exec() { return { lockedUntil: expectedLock }; }
        };
        return query;
      };

      const result = await recordFailedPasswordAttempt(new mongoose.Types.ObjectId(), now);

      assert.equal(Array.isArray(captured.update), true);
      assert.equal(captured.options?.updatePipeline, true);
      assert.equal(result?.toISOString(), expectedLock.toISOString());
    } finally {
      (User as any).findOneAndUpdate = originalFindOneAndUpdate;
    }
  });

  it("returns an exact fifteen-minute warning when the lock opens", () => {
    const now = new Date("2026-08-10T10:00:00.000Z");
    const details = passwordLockDetails(new Date(now.getTime() + 15 * 60 * 1000), now);

    assert.equal(details.retryAfterSeconds, 900);
    assert.equal(details.message, "Too many unsuccessful login attempts. Try again in 15 minutes.");
  });

  it("rounds the remaining wait up so the warning never promises an early retry", () => {
    const now = new Date("2026-08-10T10:00:00.000Z");
    const details = passwordLockDetails(new Date(now.getTime() + 61_001), now);

    assert.equal(details.retryAfterSeconds, 62);
    assert.match(details.message, /2 minutes/);
  });
});
