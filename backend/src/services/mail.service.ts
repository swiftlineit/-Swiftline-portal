import nodemailer from "nodemailer";
import { env } from "../config/env.js";

type ClientInvitationEmailInput = {
  to: string;
  name: string;
  companyName: string;
  activationUrl: string;
  expiresAt: Date;
};

type PasswordResetEmailInput = {
  to: string;
  name: string;
  resetUrl: string;
  expiresAt: Date;
};

function isSmtpConfigured() {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.MAIL_FROM);
}

function createTransporter() {
  const { SMTP_HOST, SMTP_PORT, MAIL_FROM } = env;

  if (!isSmtpConfigured() || !SMTP_HOST || !SMTP_PORT || !MAIL_FROM) {
    return null;
  }

  // Google displays app passwords in groups with spaces. Gmail SMTP expects the
  // compact value, so we normalize only for Gmail and leave other providers as-is.
  const smtpPassword = SMTP_HOST.includes("gmail.com")
    ? env.SMTP_PASSWORD?.replace(/\s+/g, "")
    : env.SMTP_PASSWORD;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: env.SMTP_SECURE,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
    auth: env.SMTP_USER && smtpPassword ? {
      user: env.SMTP_USER,
      pass: smtpPassword
    } : undefined
  });
}

function buildClientInvitationText(input: ClientInvitationEmailInput) {
  return [
    `Hello ${input.name || "there"},`,
    "",
    `You have been invited to access ${input.companyName} on the Swiftline Portal.`,
    "Create your password using the secure activation link below:",
    "",
    input.activationUrl,
    "",
    `This link expires on ${input.expiresAt.toLocaleString("en-IN")}.`,
    "",
    "If you were not expecting this invitation, you can ignore this email.",
    "",
    "Swiftline Portal"
  ].join("\n");
}

function buildClientInvitationHtml(input: ClientInvitationEmailInput) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
      <p>Hello ${input.name || "there"},</p>
      <p>You have been invited to access <strong>${input.companyName}</strong> on the Swiftline Portal.</p>
      <p>Create your password using the secure activation link below:</p>
      <p>
        <a href="${input.activationUrl}" style="display:inline-block;background:#1e3a8a;color:#ffffff;padding:10px 16px;text-decoration:none;font-weight:700">
          Activate Account
        </a>
      </p>
      <p style="word-break:break-all">${input.activationUrl}</p>
      <p>This link expires on <strong>${input.expiresAt.toLocaleString("en-IN")}</strong>.</p>
      <p>If you were not expecting this invitation, you can ignore this email.</p>
      <p>Swiftline Portal</p>
    </div>
  `;
}

function buildPasswordResetText(input: PasswordResetEmailInput) {
  return [
    `Hello ${input.name || "there"},`,
    "",
    "We received a request to reset your Swiftline Portal password.",
    "Use the secure link below to create a new password:",
    "",
    input.resetUrl,
    "",
    `This link expires on ${input.expiresAt.toLocaleString("en-IN")}.`,
    "",
    "If you did not request this reset, you can ignore this email.",
    "",
    "Swiftline Portal"
  ].join("\n");
}

function buildPasswordResetHtml(input: PasswordResetEmailInput) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
      <p>Hello ${input.name || "there"},</p>
      <p>We received a request to reset your Swiftline Portal password.</p>
      <p>Use the secure link below to create a new password:</p>
      <p>
        <a href="${input.resetUrl}" style="display:inline-block;background:#1e3a8a;color:#ffffff;padding:10px 16px;text-decoration:none;font-weight:700">
          Reset Password
        </a>
      </p>
      <p style="word-break:break-all">${input.resetUrl}</p>
      <p>This link expires on <strong>${input.expiresAt.toLocaleString("en-IN")}</strong>.</p>
      <p>If you did not request this reset, you can ignore this email.</p>
      <p>Swiftline Portal</p>
    </div>
  `;
}

export async function sendClientInvitationEmail(input: ClientInvitationEmailInput) {
  const transporter = createTransporter();

  if (!transporter) {
    if (env.NODE_ENV === "production") {
      throw new Error("SMTP is not configured.");
    }

    console.info("SMTP is not configured. Client invitation email skipped.", {
      to: input.to,
      activationUrl: input.activationUrl
    });

    return { sent: false, skipped: true };
  }

  console.info("Sending client invitation email.", { to: input.to, companyName: input.companyName });

  await transporter.sendMail({
    from: env.MAIL_FROM,
    to: input.to,
    subject: `Activate your Swiftline Portal access for ${input.companyName}`,
    text: buildClientInvitationText(input),
    html: buildClientInvitationHtml(input)
  });

  console.info("Client invitation email sent.", { to: input.to, companyName: input.companyName });

  return { sent: true, skipped: false };
}

export async function sendPasswordResetEmail(input: PasswordResetEmailInput) {
  const transporter = createTransporter();

  if (!transporter) {
    if (env.NODE_ENV === "production") {
      throw new Error("SMTP is not configured.");
    }

    console.info("SMTP is not configured. Password reset email skipped.", {
      to: input.to,
      resetUrl: input.resetUrl
    });

    return { sent: false, skipped: true };
  }

  console.info("Sending password reset email.", { to: input.to });

  await transporter.sendMail({
    from: env.MAIL_FROM,
    to: input.to,
    subject: "Reset your Swiftline Portal password",
    text: buildPasswordResetText(input),
    html: buildPasswordResetHtml(input)
  });

  console.info("Password reset email sent.", { to: input.to });

  return { sent: true, skipped: false };
}
