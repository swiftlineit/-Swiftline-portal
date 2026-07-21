import { User } from "../models/user.model.js";
import { env } from "./env.js";
import { comparePassword, hashPassword } from "../services/auth.service.js";

export async function ensureAdminSeeded(): Promise<void> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    console.warn("ADMIN_EMAIL or ADMIN_PASSWORD not set; skipping admin seeding");
    return;
  }

  const existing = await User.findOne({ email: env.ADMIN_EMAIL }).exec();
  const passwordHash = await hashPassword(env.ADMIN_PASSWORD);

  if (!existing) {
    await User.create({
      email: env.ADMIN_EMAIL,
      passwordHash,
      role: "admin",
      isVerified: true
    });

    console.log("Admin user seeded from environment");
    return;
  }

  const currentMatches = existing.passwordHash
    ? await comparePassword(env.ADMIN_PASSWORD, existing.passwordHash)
    : false;
  if (!currentMatches) {
    existing.passwordHash = passwordHash;
    await existing.save();
    console.log("Admin password synced from environment");
  } else {
    console.log("Admin user already exists");
  }
}
