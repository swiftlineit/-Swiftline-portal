import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { changeProfilePassword } from "../controllers/profile.controller.js";
import { User } from "../models/user.model.js";
import { comparePassword, hashPassword } from "../services/auth.service.js";

// Kept short: Atlas caps database names at 38 bytes.
const databaseName = `swiftline_pw_test_${Date.now()}`;

function createResponseRecorder() {
  let statusCode = 200;
  let body: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(payload: unknown) {
      body = payload;
      return response;
    }
  } as unknown as Response;
  return { response, statusCode: () => statusCode, body: <T>() => body as T };
}

function controllerRequest(input: { userId: mongoose.Types.ObjectId; body?: unknown }) {
  return {
    user: { _id: input.userId, role: "client" },
    body: input.body ?? {},
    params: {},
    query: {}
  } as unknown as Request;
}

async function createPasswordUser(label: string, password: string) {
  return User.create({
    email: `pw_${label}_${Date.now()}@swiftline.test`,
    passwordHash: await hashPassword(password),
    role: "client"
  });
}

describe("profile password change", () => {
  before(async () => {
    await mongoose.connect(env.MONGODB_URI, { dbName: databaseName, family: 4, retryWrites: false });
    assert.equal(mongoose.connection.name, databaseName, "Tests must use the isolated password test database.");
    // The partial googleId index is what this suite is really guarding, so it has
    // to exist before any user is written.
    await User.init();
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) {
      assert.ok(mongoose.connection.name.startsWith("swiftline_pw_test_"), "Refusing to clean a non-test database.");
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  // Regression: googleId used to carry a `unique + sparse` index while defaulting
  // to an explicit null. Sparse only skips missing fields, so the second
  // password-based user collided on null and could not be created or saved.
  test("several password-based users can coexist and be re-saved", async () => {
    const first = await createPasswordUser("first", "FirstPassw0rd!");
    const second = await createPasswordUser("second", "SecondPassw0rd!");
    const third = await createPasswordUser("third", "ThirdPassw0rd!");

    assert.ok(first._id && second._id && third._id);

    // Re-saving is the exact operation the change-password handler performs.
    await assert.doesNotReject(() => second.save());
  });

  test("changes the password when the current password is correct", async () => {
    const user = await createPasswordUser("change", "OldPassw0rd!");
    // A second null-googleId user makes the old duplicate-key bug reachable.
    await createPasswordUser("bystander", "OtherPassw0rd!");

    const recorder = createResponseRecorder();
    await changeProfilePassword(
      controllerRequest({
        userId: user._id as mongoose.Types.ObjectId,
        body: {
          currentPassword: "OldPassw0rd!",
          newPassword: "BrandNewPassw0rd!",
          confirmPassword: "BrandNewPassw0rd!"
        }
      }),
      recorder.response
    );

    assert.equal(recorder.statusCode(), 200);

    const stored = (await User.findById(user._id).select("passwordHash").exec())?.passwordHash ?? "";
    assert.ok(await comparePassword("BrandNewPassw0rd!", stored), "The new password must be stored.");
    assert.equal(await comparePassword("OldPassw0rd!", stored), false, "The old password must stop working.");
  });

  test("saving a user does not clear an existing google link", async () => {
    const googleSub = `google-sub-${Date.now()}`;
    const user = await User.create({
      email: `pw_google_${Date.now()}@swiftline.test`,
      passwordHash: await hashPassword("GooglePassw0rd!"),
      googleId: googleSub,
      role: "client"
    });

    const recorder = createResponseRecorder();
    await changeProfilePassword(
      controllerRequest({
        userId: user._id as mongoose.Types.ObjectId,
        body: {
          currentPassword: "GooglePassw0rd!",
          newPassword: "RotatedPassw0rd!",
          confirmPassword: "RotatedPassw0rd!"
        }
      }),
      recorder.response
    );

    assert.equal(recorder.statusCode(), 200);
    const reloaded = await User.findById(user._id).select("googleId").exec();
    assert.equal(reloaded?.googleId, googleSub, "The google link must survive a password change.");
  });

  test("two google users cannot share one google id", async () => {
    const googleSub = `shared-sub-${Date.now()}`;
    await User.create({
      email: `pw_g1_${Date.now()}@swiftline.test`,
      googleId: googleSub,
      role: "client"
    });

    await assert.rejects(
      () => User.create({
        email: `pw_g2_${Date.now()}@swiftline.test`,
        googleId: googleSub,
        role: "client"
      }),
      "Uniqueness must still hold for real google ids."
    );
  });

  test("rejects a wrong current password", async () => {
    const user = await createPasswordUser("wrong", "OldPassw0rd!");

    const recorder = createResponseRecorder();
    await changeProfilePassword(
      controllerRequest({
        userId: user._id as mongoose.Types.ObjectId,
        body: {
          currentPassword: "NotTheRightOne!",
          newPassword: "BrandNewPassw0rd!",
          confirmPassword: "BrandNewPassw0rd!"
        }
      }),
      recorder.response
    );

    assert.equal(recorder.statusCode(), 400);

    const stored = (await User.findById(user._id).select("passwordHash").exec())?.passwordHash ?? "";
    assert.ok(await comparePassword("OldPassw0rd!", stored), "The password must be unchanged.");
  });

  test("rejects a mismatched confirmation", async () => {
    const user = await createPasswordUser("mismatch", "OldPassw0rd!");

    const recorder = createResponseRecorder();
    await changeProfilePassword(
      controllerRequest({
        userId: user._id as mongoose.Types.ObjectId,
        body: {
          currentPassword: "OldPassw0rd!",
          newPassword: "BrandNewPassw0rd!",
          confirmPassword: "DifferentPassw0rd!"
        }
      }),
      recorder.response
    );

    assert.equal(recorder.statusCode(), 400);
  });

  test("rejects reusing the current password", async () => {
    const user = await createPasswordUser("reuse", "SamePassw0rd!");

    const recorder = createResponseRecorder();
    await changeProfilePassword(
      controllerRequest({
        userId: user._id as mongoose.Types.ObjectId,
        body: {
          currentPassword: "SamePassw0rd!",
          newPassword: "SamePassw0rd!",
          confirmPassword: "SamePassw0rd!"
        }
      }),
      recorder.response
    );

    assert.equal(recorder.statusCode(), 400);
  });
});
