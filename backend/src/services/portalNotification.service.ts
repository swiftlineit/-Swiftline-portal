import mongoose from "mongoose";
import { BusinessAccountMember, type BusinessAccountMemberRole } from "../models/businessAccountMember.model.js";
import { BusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { CreditBillingStatement } from "../models/creditBillingStatement.model.js";
import { PortalNotification, type PortalNotificationType } from "../models/portalNotification.model.js";
import { User } from "../models/user.model.js";
import { getCreditBalances } from "./creditAccount.service.js";
import { getCreditRestrictionState } from "./creditOverdue.service.js";
import { formatIndiaDate } from "../utils/dateFormat.js";

type NotificationInput = {
  type: PortalNotificationType;
  title: string;
  message: string;
  href: string;
  idempotencyKey: string;
  businessAccountId?: mongoose.Types.ObjectId | null;
  metadata?: Record<string, unknown>;
};

async function insertNotifications(
  recipientUserIds: mongoose.Types.ObjectId[],
  input: NotificationInput,
  session?: mongoose.ClientSession
) {
  const uniqueRecipients = [...new Map(recipientUserIds.map((id) => [String(id), id])).values()];
  if (!uniqueRecipients.length) return;

  const operations = uniqueRecipients.map((recipientUserId) => ({
    updateOne: {
      filter: { idempotencyKey: `${input.idempotencyKey}:${String(recipientUserId)}` },
      update: {
        $setOnInsert: {
          recipientUserId,
          businessAccountId: input.businessAccountId ?? null,
          type: input.type,
          title: input.title,
          message: input.message,
          href: input.href,
          idempotencyKey: `${input.idempotencyKey}:${String(recipientUserId)}`,
          metadata: input.metadata ?? {},
          readAt: null,
          createdAt: new Date()
        }
      },
      upsert: true
    }
  }));

  await PortalNotification.bulkWrite(operations, { ordered: false, session });
}

export async function notifyPortalUsers(
  recipientUserIds: mongoose.Types.ObjectId[],
  input: NotificationInput,
  session?: mongoose.ClientSession
) {
  await insertNotifications(recipientUserIds, input, session);
}

async function notifyBusinessMembersWithRole(
  businessAccountId: mongoose.Types.ObjectId,
  roles: BusinessAccountMemberRole[],
  input: NotificationInput,
  session?: mongoose.ClientSession
) {
  const members = await BusinessAccountMember.find({
    businessAccount: businessAccountId,
    status: "active",
    role: { $in: roles }
  }).select("user").session(session ?? null).lean().exec();

  await insertNotifications(
    members.map((member) => member.user),
    { ...input, businessAccountId },
    session
  );
}

export async function notifyBusinessFinancialMembers(
  businessAccountId: mongoose.Types.ObjectId,
  input: NotificationInput,
  session?: mongoose.ClientSession
) {
  await notifyBusinessMembersWithRole(
    businessAccountId,
    ["account_owner", "account_admin", "finance"],
    input,
    session
  );
}

export async function notifyBusinessQuoteMembers(
  businessAccountId: mongoose.Types.ObjectId,
  input: NotificationInput,
  session?: mongoose.ClientSession
) {
  await notifyBusinessMembersWithRole(
    businessAccountId,
    ["account_owner", "account_admin", "operations", "finance"],
    input,
    session
  );
}

// Account lifecycle news (approval, KYC, suspension) only reaches the members who
// can act on it.
export async function notifyBusinessAccountManagers(
  businessAccountId: mongoose.Types.ObjectId,
  input: NotificationInput,
  session?: mongoose.ClientSession
) {
  await notifyBusinessMembersWithRole(
    businessAccountId,
    ["account_owner", "account_admin"],
    input,
    session
  );
}

// Shipment-level news (amendments, verified charges) reaches the members who book
// and pay for shipments.
export async function notifyBusinessShipmentMembers(
  businessAccountId: mongoose.Types.ObjectId,
  input: NotificationInput,
  session?: mongoose.ClientSession
) {
  await notifyBusinessMembersWithRole(
    businessAccountId,
    ["account_owner", "account_admin", "operations", "finance"],
    input,
    session
  );
}

export async function notifyActiveAdmins(input: NotificationInput, session?: mongoose.ClientSession) {
  const admins = await User.find({ role: "admin", userStatus: "active" })
    .select("_id")
    .session(session ?? null)
    .lean()
    .exec();
  await insertNotifications(admins.map((admin) => admin._id), input, session);
}

export function serializePortalNotification(notification: InstanceType<typeof PortalNotification>) {
  return {
    id: String(notification._id),
    businessAccountId: notification.businessAccountId ? String(notification.businessAccountId) : null,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    href: notification.href,
    readAt: notification.readAt ?? null,
    createdAt: notification.createdAt
  };
}

export async function listPortalNotifications(recipientUserId: mongoose.Types.ObjectId) {
  const notifications = await PortalNotification.find({ recipientUserId })
    .sort({ createdAt: -1 })
    .limit(100)
    .exec();
  const unreadCount = await PortalNotification.countDocuments({ recipientUserId, readAt: null });
  return { notifications: notifications.map(serializePortalNotification), unreadCount };
}

export async function markPortalNotificationRead(
  recipientUserId: mongoose.Types.ObjectId,
  notificationId: mongoose.Types.ObjectId
) {
  return PortalNotification.findOneAndUpdate(
    { _id: notificationId, recipientUserId },
    { $set: { readAt: new Date() } },
    { returnDocument: "after", runValidators: true }
  ).exec();
}

export async function markAllPortalNotificationsRead(recipientUserId: mongoose.Types.ObjectId) {
  await PortalNotification.updateMany(
    { recipientUserId, readAt: null },
    { $set: { readAt: new Date() } }
  ).exec();
}

export async function refreshCreditNotificationsForUser(recipientUserId: mongoose.Types.ObjectId) {
  const memberships = await BusinessAccountMember.find({
    user: recipientUserId,
    status: "active",
    role: { $in: ["account_owner", "account_admin", "finance"] }
  }).select("businessAccount").lean().exec();
  const now = new Date();
  const dueSoonAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  for (const membership of memberships) {
    const account = await BusinessCreditAccount.findOne({ businessAccountId: membership.businessAccount }).exec();
    if (!account) continue;
    const restriction = await getCreditRestrictionState({
      businessAccountId: membership.businessAccount,
      gracePeriodDays: account.gracePeriodDays,
      maxOverdueDays: account.maxOverdueDays,
      now
    });
    const statements = await CreditBillingStatement.find({
      businessAccountId: membership.businessAccount,
      outstandingAmountMinor: { $gt: 0 },
      status: { $in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] }
    }).select("statementNumber dueAt status").exec();

    for (const statement of statements) {
      const href = `/client/credit/statements/${String(statement._id)}?businessAccountId=${String(membership.businessAccount)}#statement-payment`;
      if (statement.status === "OVERDUE") {
        await notifyBusinessFinancialMembers(membership.businessAccount, {
          type: "PAYMENT_OVERDUE",
          title: "Credit statement overdue",
          message: `${statement.statementNumber} is overdue. Review the outstanding amount to avoid further restrictions.`,
          href,
          idempotencyKey: `PAYMENT_OVERDUE:${String(statement._id)}`,
          metadata: { statementId: statement._id, restrictionLevel: restriction.level }
        });
      } else if (statement.dueAt >= now && statement.dueAt <= dueSoonAt) {
        await notifyBusinessFinancialMembers(membership.businessAccount, {
          type: "PAYMENT_DUE_SOON",
          title: "Credit statement due soon",
          message: `${statement.statementNumber} is due on ${formatIndiaDate(statement.dueAt)}.`,
          href,
          idempotencyKey: `PAYMENT_DUE_SOON:${String(statement._id)}`,
          metadata: { statementId: statement._id }
        });
      }
    }

    if (account.approvedCreditLimitMinor > 0) {
      const balances = getCreditBalances(account);
      const usedPercent = Math.round((balances.usedCreditMinor / account.approvedCreditLimitMinor) * 100);
      if (usedPercent >= account.creditWarningThresholdPercent) {
        await notifyBusinessFinancialMembers(membership.businessAccount, {
          type: "LOW_BOOKING_CAPACITY",
          title: "Credit capacity running low",
          message: `${usedPercent}% of the approved credit limit is currently used.`,
          href: "/client/credit#credit-summary",
          idempotencyKey: `LOW_BOOKING_CAPACITY:${String(account._id)}:${account.creditWarningThresholdPercent}`,
          metadata: { usedPercent, availableCreditMinor: balances.availableCreditMinor }
        });
      }
    }
  }
}
