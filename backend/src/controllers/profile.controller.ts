import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog } from "../models/auditLog.model.js";
import { Branch } from "../models/branch.model.js";
import { BusinessAccount, type IBusinessAccount } from "../models/businessAccount.model.js";
import { BusinessAccountMember } from "../models/businessAccountMember.model.js";
import { User } from "../models/user.model.js";
import { comparePassword, hashPassword } from "../services/auth.service.js";
import {
  emailValidationMessage,
  getPostalCodeValidationMessage,
  isHttpOrHttpsUrl,
  isValidBusinessContactEmail,
  isValidPhoneForCountryCode,
  isValidPostalCodeForCountry,
  phoneValidationMessage
} from "../services/businessAccountRules.js";

/** Business-account roles allowed to maintain their account's own details. */
const accountEditorRoles = new Set(["account_owner", "account_admin"]);

// Name bounds mirror the business-account contact rules so one person is not
// described two different ways across the portal.
const userDetailsSchema = z.object({
  firstName: z.string().trim().min(2, "First name must be at least 2 characters.").max(22),
  lastName: z.string().trim().max(22).default(""),
  phone: z.string().trim().max(20).regex(/^$|^\+?\d{6,15}$/, "Enter a valid phone number, 6 to 15 digits.").default("")
});

/**
 * Only the fields that are safe to change after KYC. Company name, type,
 * registration id and GSTIN are deliberately absent: they are what the KYC
 * review and the credit agreement were signed against.
 *
 * Every rule here matches `businessAccountBodySchema` in the business account
 * controller field for field, so an edit made from the profile page cannot store
 * a value the account creation form would have rejected. The two country-aware
 * checks (postal code, phone) are applied in the handler because they need the
 * account's stored country, which is not editable here.
 */
const accountDetailsSchema = z.object({
  company: z.object({
    registeredAddress: z.string().trim().max(500).default(""),
    city: z.string().trim().max(80).default(""),
    stateOrProvince: z.string().trim().max(80).default(""),
    postalCode: z.string().trim().max(20).default(""),
    website: z.string().trim().url("Enter a valid website URL.")
      .refine(isHttpOrHttpsUrl, "Website must start with http:// or https://")
      .optional().or(z.literal("")).default(""),
    industry: z.string().trim().max(100).default(""),
    monthlyShipmentVolume: z.string().trim().max(80).default("")
  }),
  contact: z.object({
    title: z.enum(["mr.", "mrs.", "ms.", "dr.", "prof."]),
    firstName: z.string().trim().min(2).max(22),
    lastName: z.string().trim().min(1).max(22),
    email: z.string().trim().email().toLowerCase().refine(isValidBusinessContactEmail, emailValidationMessage),
    countryCode: z.string().trim().min(1).max(8),
    mobileNumber: z.string().trim().regex(/^\d{6,15}$/, "Mobile number must contain 6 to 15 digits"),
    jobTitle: z.string().trim().min(1, "Job title is required.").max(80),
    department: z.string().trim().min(1, "Department is required.").max(80)
  })
}).superRefine((data, context) => {
  if (!isValidPhoneForCountryCode(data.contact.countryCode, data.contact.mobileNumber)) {
    context.addIssue({ code: "custom", path: ["contact", "mobileNumber"], message: phoneValidationMessage });
  }
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: z.string().min(8, "New password must be at least 8 characters.").max(128),
  confirmPassword: z.string().min(8).max(128)
}).refine((value) => value.newPassword === value.confirmPassword, {
  message: "New password and confirmation do not match.",
  path: ["confirmPassword"]
});

function getUserId(request: Request) {
  const value = (request as Request & { user?: { _id?: unknown } }).user?._id;
  return value && mongoose.Types.ObjectId.isValid(String(value))
    ? new mongoose.Types.ObjectId(String(value))
    : null;
}

function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "The details provided are invalid.";
}

type BranchSummary = { _id: unknown; name?: string; code?: string };

/** The user fields the profile reads. `createdAt` comes from schema timestamps. */
type ProfileUser = {
  _id: unknown;
  firstName?: string;
  lastName?: string;
  name?: string;
  email: string;
  phone?: string;
  role: string;
  userStatus: string;
  isVerified?: boolean;
  emailVerifiedAt?: Date | null;
  lastLogin?: Date | null;
  createdAt?: Date | null;
  assignedBranches?: mongoose.Types.ObjectId[];
};

function serializeBranches(branches: BranchSummary[]) {
  return branches.map((branch) => ({
    id: String(branch._id),
    name: branch.name ?? "",
    code: branch.code ?? ""
  }));
}

function serializeAccount(account: IBusinessAccount, membershipRole: string, joinedAt: Date | null, branches: BranchSummary[]) {
  const company = account.company;
  const contact = account.contact;
  return {
    id: String(account._id),
    accountId: account.accountId,
    status: account.status,
    membershipRole,
    // Only owners and admins maintain the account; everyone else reads it.
    canEdit: accountEditorRoles.has(membershipRole),
    joinedAt,
    assignedBranches: serializeBranches(branches),
    company: {
      companyName: company.companyName ?? "",
      companyType: company.companyType ?? "",
      registrationCountry: company.registrationCountry ?? "",
      registrationIdType: company.registrationIdType ?? "",
      registrationId: company.registrationId ?? "",
      gstin: company.gstin ?? "",
      registeredAddress: company.registeredAddress ?? "",
      city: company.city ?? "",
      stateOrProvince: company.stateOrProvince ?? "",
      postalCode: company.postalCode ?? "",
      addressCountry: company.addressCountry ?? "",
      // Accounts registered without a company are not held to the company rules.
      noCompany: Boolean(company.noCompany),
      website: company.website ?? "",
      industry: company.industry ?? "",
      monthlyShipmentVolume: company.monthlyShipmentVolume ?? "",
      operatingCountries: company.operatingCountries ?? []
    },
    contact: {
      title: contact.title ?? "",
      firstName: contact.firstName ?? "",
      lastName: contact.lastName ?? "",
      email: contact.email ?? "",
      countryCode: contact.countryCode ?? "",
      mobileNumber: contact.mobileNumber ?? "",
      jobTitle: contact.jobTitle ?? "",
      department: contact.department ?? ""
    }
  };
}

async function loadProfile(userId: mongoose.Types.ObjectId) {
  const user = await User.findById(userId)
    .select("firstName lastName name email phone role userStatus isVerified emailVerifiedAt lastLogin assignedBranches createdAt")
    .lean<ProfileUser>()
    .exec();
  if (!user) return null;

  const memberships = await BusinessAccountMember.find({ user: userId, status: "active" })
    .select("businessAccount role joinedAt assignedBranches")
    .lean()
    .exec();
  const accounts = memberships.length
    ? await BusinessAccount.find({ _id: { $in: memberships.map((membership) => membership.businessAccount) } })
      .lean<IBusinessAccount[]>()
      .exec()
    : [];
  const accountById = new Map(accounts.map((account) => [String(account._id), account]));

  const branchIds = [
    ...(user.assignedBranches ?? []),
    ...memberships.flatMap((membership) => membership.assignedBranches ?? [])
  ];
  const branches: BranchSummary[] = branchIds.length
    ? await Branch.find({ _id: { $in: branchIds } }).select("name code").lean<BranchSummary[]>().exec()
    : [];
  const branchById = new Map(branches.map((branch) => [String(branch._id), branch]));
  const resolveBranches = (ids: unknown[]) => ids
    .map((id) => branchById.get(String(id)))
    .filter((branch): branch is BranchSummary => Boolean(branch));

  // Staff invited by an admin carry only a display `name`, so the editable parts
  // are derived from it rather than shown blank.
  const [derivedFirst = "", ...derivedRest] = (user.name ?? "").trim().split(/\s+/).filter(Boolean);
  const firstName = user.firstName || derivedFirst;
  const lastName = user.lastName || derivedRest.join(" ");

  return {
    user: {
      id: String(user._id),
      firstName,
      lastName,
      name: user.name ?? "",
      email: user.email,
      phone: user.phone ?? "",
      role: user.role,
      userStatus: user.userStatus,
      isVerified: Boolean(user.isVerified),
      emailVerifiedAt: user.emailVerifiedAt ?? null,
      lastLogin: user.lastLogin ?? null,
      createdAt: user.createdAt ?? null,
      assignedBranches: serializeBranches(resolveBranches(user.assignedBranches ?? []))
    },
    businessAccounts: memberships.flatMap((membership) => {
      const account = accountById.get(String(membership.businessAccount));
      if (!account) return [];
      return [serializeAccount(
        account,
        membership.role,
        membership.joinedAt ?? null,
        resolveBranches(membership.assignedBranches ?? [])
      )];
    })
  };
}

export async function getProfile(request: Request, response: Response) {
  const userId = getUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });
  const profile = await loadProfile(userId);
  if (!profile) return response.status(404).json({ success: false, message: "Profile not found." });
  return response.status(200).json({ success: true, ...profile });
}

export async function updateProfileDetails(request: Request, response: Response) {
  const userId = getUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });
  const parsed = userDetailsSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, message: firstIssue(parsed.error) });

  const { firstName, lastName, phone } = parsed.data;
  const updated = await User.findByIdAndUpdate(
    userId,
    // `name` is the display name the portal chrome shows, so it tracks the parts.
    { $set: { firstName, lastName, phone, name: [firstName, lastName].filter(Boolean).join(" ") } },
    { returnDocument: "after", runValidators: true }
  ).exec();
  if (!updated) return response.status(404).json({ success: false, message: "Profile not found." });

  await AuditLog.create({
    action: "USER_PROFILE_UPDATED",
    entityType: "USER",
    entityId: userId,
    performedBy: userId,
    performedAt: new Date(),
    metadata: { fields: ["firstName", "lastName", "phone"] }
  });

  const profile = await loadProfile(userId);
  return response.status(200).json({ success: true, message: "Your details were updated.", ...profile });
}

export async function updateProfileBusinessAccount(request: Request, response: Response) {
  const userId = getUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });
  const accountId = typeof request.params.accountId === "string" ? request.params.accountId : "";
  if (!mongoose.Types.ObjectId.isValid(accountId)) {
    return response.status(404).json({ success: false, message: "Business account not found." });
  }
  const parsed = accountDetailsSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, message: firstIssue(parsed.error) });

  const membership = await BusinessAccountMember.findOne({
    user: userId,
    businessAccount: accountId,
    status: "active"
  }).select("role").lean().exec();
  if (!membership) return response.status(404).json({ success: false, message: "Business account not found." });
  if (!accountEditorRoles.has(membership.role)) {
    return response.status(403).json({
      success: false,
      message: "Only an account owner or account admin can update company details."
    });
  }

  const account = await BusinessAccount.findById(accountId).exec();
  if (!account) return response.status(404).json({ success: false, message: "Business account not found." });

  const { company, contact } = parsed.data;

  // The account creation form only demands the company block from accounts that
  // have a company, so an account registered without one keeps that freedom.
  if (!account.company.noCompany) {
    const requiredCompanyFields: Array<[keyof typeof company, string]> = [
      ["registeredAddress", "Registered address is required"],
      ["city", "City is required"],
      ["stateOrProvince", "State or province is required"],
      ["postalCode", "Postal code is required"],
      ["industry", "Company industry is required"],
      ["monthlyShipmentVolume", "Monthly shipment volume is required"]
    ];
    const missing = requiredCompanyFields.find(([field]) => !String(company[field] ?? "").trim());
    if (missing) return response.status(400).json({ success: false, message: `${missing[1]}.` });

    // The postal code format follows the account's registered country, which is
    // locked here, so it is read from the stored account rather than the body.
    const addressCountry = account.company.addressCountry?.trim() ?? "";
    if (addressCountry && !isValidPostalCodeForCountry(addressCountry, company.postalCode)) {
      return response.status(400).json({ success: false, message: getPostalCodeValidationMessage(addressCountry) });
    }
  }

  // Set field by field so the KYC-verified company fields are never touched,
  // whatever the request body contains.
  account.company.registeredAddress = company.registeredAddress;
  account.company.city = company.city;
  account.company.stateOrProvince = company.stateOrProvince;
  account.company.postalCode = company.postalCode;
  account.company.website = company.website;
  account.company.industry = company.industry;
  account.company.monthlyShipmentVolume = company.monthlyShipmentVolume;
  account.contact.title = contact.title;
  account.contact.firstName = contact.firstName;
  account.contact.lastName = contact.lastName;
  account.contact.email = contact.email;
  account.contact.countryCode = contact.countryCode;
  account.contact.mobileNumber = contact.mobileNumber;
  account.contact.jobTitle = contact.jobTitle;
  account.contact.department = contact.department;
  account.updatedBy = userId;
  await account.save();

  await AuditLog.create({
    action: "BUSINESS_ACCOUNT_PROFILE_UPDATED",
    entityType: "BUSINESS_ACCOUNT",
    entityId: account._id,
    performedBy: userId,
    performedAt: new Date(),
    metadata: { source: "PROFILE", accountId: account.accountId, membershipRole: membership.role }
  });

  const profile = await loadProfile(userId);
  return response.status(200).json({ success: true, message: "Company details were updated.", ...profile });
}

export async function changeProfilePassword(request: Request, response: Response) {
  const userId = getUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });
  const parsed = passwordSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, message: firstIssue(parsed.error) });

  const user = await User.findById(userId).select("passwordHash").exec();
  if (!user) return response.status(404).json({ success: false, message: "Profile not found." });
  if (!user.passwordHash || !await comparePassword(parsed.data.currentPassword, user.passwordHash)) {
    return response.status(400).json({ success: false, message: "Your current password is incorrect." });
  }
  if (await comparePassword(parsed.data.newPassword, user.passwordHash)) {
    return response.status(400).json({ success: false, message: "Choose a password you have not used before." });
  }

  user.passwordHash = await hashPassword(parsed.data.newPassword);
  await user.save();

  await AuditLog.create({
    action: "USER_PASSWORD_CHANGED",
    entityType: "USER",
    entityId: userId,
    performedBy: userId,
    performedAt: new Date(),
    metadata: {}
  });

  return response.status(200).json({ success: true, message: "Your password was updated." });
}
