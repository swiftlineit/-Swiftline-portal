import fs from "fs";
import path from "path";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import {
  type IStaffDocument,
  type IStaffProfile,
  type IUser,
  internalRoleValues,
  type StaffDocumentType,
  staffDocumentTypes,
  User
} from "../models/user.model.js";
import { normalizePortalRole } from "../utils/portalRole.js";
import { hashPassword } from "../services/auth.service.js";
import { validateAssignedBranches } from "../utils/assignedBranches.js";

// Must match the destination used by the staff-document upload middleware.
const staffDocumentRoot = path.resolve(process.cwd(), "private_uploads", "staff");

// Aadhaar numbers are 12 digits and never begin with 0 or 1.
const aadhaarPattern = /^[2-9][0-9]{11}$/;
const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const phonePattern = /^\+?[0-9][0-9\s\-()]{7,19}$/;
const postalCodePattern = /^[0-9]{6}$/;

const MIN_STAFF_AGE_YEARS = 18;
const MAX_STAFF_AGE_YEARS = 100;
const MAX_JOINING_DATE_MONTHS_AHEAD = 12;

// Multipart form fields arrive as strings, so a blank input reaches the schema as
// "" rather than being absent. Optional fields treat that as "not provided".
function blankToUndefined(value: unknown) {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function optionalText(max: number) {
  return z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
}

function yearsAgo(years: number) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date;
}

function monthsAhead(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return date;
}

const staffBodySchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(60),
  lastName: z.string().trim().min(1, "Last name is required.").max(60),
  email: z.string().trim().email("Enter a valid email address.").max(120),
  phone: z.string().trim().regex(phonePattern, "Enter a valid phone number."),
  role: z.enum(internalRoleValues),
  password: z.string().min(8, "Password must be at least 8 characters.").max(128),
  // Admins are not branch-scoped, so the branch requirement is applied in the
  // handler where the chosen role is known.
  assignedBranches: z.array(z.string()).default([]),
  dateOfJoining: z.coerce.date("Enter a valid date of joining.")
    .max(monthsAhead(MAX_JOINING_DATE_MONTHS_AHEAD), "Date of joining is too far in the future."),
  aadhaarNumber: z.preprocess(
    (value) => typeof value === "string" ? value.replace(/[\s-]/g, "") : value,
    z.string().regex(aadhaarPattern, "Enter a valid 12-digit Aadhaar number.")
  ),
  dateOfBirth: z.preprocess(
    blankToUndefined,
    z.coerce.date("Enter a valid date of birth.")
      .min(yearsAgo(MAX_STAFF_AGE_YEARS), "Enter a valid date of birth.")
      .max(yearsAgo(MIN_STAFF_AGE_YEARS), `Staff must be at least ${MIN_STAFF_AGE_YEARS} years old.`)
      .optional()
  ),
  panNumber: z.preprocess(
    (value) => typeof value === "string" ? value.trim().toUpperCase() : value,
    z.preprocess(blankToUndefined, z.string().regex(panPattern, "Enter a valid PAN, for example ABCDE1234F.").optional())
  ),
  employeeCode: optionalText(40),
  designation: optionalText(80),
  addressLine1: optionalText(160),
  addressCity: optionalText(80),
  addressState: optionalText(80),
  addressPostalCode: z.preprocess(
    blankToUndefined,
    z.string().trim().regex(postalCodePattern, "Enter a valid 6-digit PIN code.").optional()
  ),
  emergencyContactName: optionalText(80),
  emergencyContactPhone: z.preprocess(
    blankToUndefined,
    z.string().trim().regex(phonePattern, "Enter a valid emergency contact number.").optional()
  )
});

type StaffBody = z.infer<typeof staffBodySchema>;

// File-signature checks for the accepted formats. The client-supplied MIME type
// is not trusted; the first bytes on disk are inspected instead.
const documentSignatureTests: ((header: Buffer) => boolean)[] = [
  (header) => header.subarray(0, 4).toString("latin1") === "%PDF",
  (header) => header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff,
  (header) => header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
];

type UploadedStaffFiles = Partial<Record<StaffDocumentType, Express.Multer.File>>;

function getUploadedFiles(request: Request): UploadedStaffFiles {
  const files = request.files as Partial<Record<StaffDocumentType, Express.Multer.File[]>> | undefined;

  return {
    aadhaar: files?.aadhaar?.[0],
    pan: files?.pan?.[0],
    other: files?.other?.[0]
  };
}

async function unlinkFiles(paths: string[]) {
  await Promise.all(paths.map((filePath) => fs.promises.unlink(filePath).catch(() => undefined)));
}

async function cleanupUploadedFiles(files: UploadedStaffFiles) {
  await unlinkFiles(
    Object.values(files)
      .filter((file): file is Express.Multer.File => Boolean(file))
      .map((file) => file.path)
  );
}

// Return the first uploaded document whose content is not a valid PDF/JPEG/PNG,
// or null when every uploaded file passes the signature check.
async function findInvalidDocumentSignature(files: UploadedStaffFiles): Promise<StaffDocumentType | null> {
  for (const [type, file] of Object.entries(files) as [StaffDocumentType, Express.Multer.File | undefined][]) {
    if (!file) continue;

    const header = Buffer.alloc(8);
    let handle: fs.promises.FileHandle | undefined;
    try {
      handle = await fs.promises.open(file.path, "r");
      await handle.read(header, 0, 8, 0);
    } finally {
      await handle?.close();
    }

    if (!documentSignatureTests.some((test) => test(header))) return type;
  }

  return null;
}

function toStaffDocument(type: StaffDocumentType, file: Express.Multer.File): IStaffDocument {
  return {
    type,
    originalName: file.originalname,
    storedName: file.filename,
    mimeType: file.mimetype,
    size: file.size,
    path: file.path,
    uploadedAt: new Date()
  };
}

// FormData sends one entry per selected branch, which Express surfaces as a
// string for a single value and an array for several.
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

export function maskAadhaarNumber(value?: string | null): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  return digits.length === 12 ? `XXXX XXXX ${digits.slice(-4)}` : "XXXX XXXX XXXX";
}

// Document metadata only. The stored path stays server-side; files are read
// through the document endpoint so access is always re-checked.
function serializeStaffDocument(document?: IStaffDocument | null) {
  if (!document) return null;

  return {
    type: document.type,
    originalName: document.originalName,
    mimeType: document.mimeType,
    size: document.size,
    uploadedAt: document.uploadedAt
  };
}

export function serializeStaffProfile(profile?: IStaffProfile | null) {
  if (!profile) return null;

  return {
    employeeCode: profile.employeeCode ?? "",
    designation: profile.designation ?? "",
    dateOfJoining: profile.dateOfJoining ?? null,
    dateOfBirth: profile.dateOfBirth ?? null,
    // Only the last four digits are ever sent back to the browser.
    aadhaarNumber: maskAadhaarNumber(profile.aadhaarNumber),
    panNumber: profile.panNumber ?? "",
    address: {
      line1: profile.address?.line1 ?? "",
      city: profile.address?.city ?? "",
      state: profile.address?.state ?? "",
      postalCode: profile.address?.postalCode ?? ""
    },
    emergencyContact: {
      name: profile.emergencyContact?.name ?? "",
      phone: profile.emergencyContact?.phone ?? ""
    },
    documents: {
      aadhaar: serializeStaffDocument(profile.documents?.aadhaar),
      pan: serializeStaffDocument(profile.documents?.pan),
      other: serializeStaffDocument(profile.documents?.other)
    }
  };
}

function buildStaffProfile(
  data: StaffBody,
  files: UploadedStaffFiles,
  createdBy: mongoose.Types.ObjectId | null
): IStaffProfile {
  const documents: Partial<Record<StaffDocumentType, IStaffDocument>> = {};
  for (const type of staffDocumentTypes) {
    const file = files[type];
    if (file) documents[type] = toStaffDocument(type, file);
  }

  return {
    employeeCode: data.employeeCode ?? "",
    designation: data.designation ?? "",
    dateOfJoining: data.dateOfJoining,
    dateOfBirth: data.dateOfBirth ?? null,
    aadhaarNumber: data.aadhaarNumber,
    panNumber: data.panNumber ?? "",
    address: {
      line1: data.addressLine1 ?? "",
      city: data.addressCity ?? "",
      state: data.addressState ?? "",
      postalCode: data.addressPostalCode ?? ""
    },
    emergencyContact: {
      name: data.emergencyContactName ?? "",
      phone: data.emergencyContactPhone ?? ""
    },
    documents,
    createdBy
  };
}

// One shape for create, read, and update responses so the staff pages never have
// to reconcile three slightly different user payloads.
export function serializeStaffUser(staffUser: IUser) {
  return {
    _id: staffUser._id,
    email: staffUser.email,
    name: staffUser.name,
    firstName: staffUser.firstName ?? "",
    lastName: staffUser.lastName ?? "",
    phone: staffUser.phone ?? "",
    role: normalizePortalRole(staffUser.role),
    isVerified: staffUser.isVerified,
    userStatus: staffUser.userStatus,
    hasSeenWelcome: staffUser.hasSeenWelcome,
    lockedUntil: staffUser.lockedUntil,
    lastLogin: staffUser.lastLogin ?? null,
    createdAt: (staffUser as IUser & { createdAt?: Date }).createdAt ?? null,
    assignedBranches: staffUser.assignedBranches,
    staffProfile: serializeStaffProfile(staffUser.staffProfile)
  };
}

function getAuthenticatedUserId(request: Request): mongoose.Types.ObjectId | null {
  const user = (request as Request & { user?: { _id?: unknown } }).user;
  const id = user?._id;

  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;

  return new mongoose.Types.ObjectId(String(id));
}

function getRequesterRole(request: Request): string {
  return (request as Request & { user?: { role?: string } }).user?.role ?? "";
}

/**
 * Creates an internal staff member: the login itself plus the employment record
 * and KYC documents captured by the Add Staff form.
 *
 * Multer has already written every uploaded file to disk by the time this runs,
 * so each rejection path removes them before responding.
 */
export async function createStaffUser(request: Request, response: Response): Promise<Response> {
  const files = getUploadedFiles(request);

  async function reject(status: number, message: string): Promise<Response> {
    await cleanupUploadedFiles(files);
    return response.status(status).json({ success: false, message });
  }

  const body = request.body as Record<string, unknown>;
  const parsed = staffBodySchema.safeParse({
    ...body,
    assignedBranches: toStringArray(body.assignedBranches)
  });

  if (!parsed.success) {
    await cleanupUploadedFiles(files);
    return response.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message || "Check the staff details and try again.",
      errors: z.treeifyError(parsed.error)
    });
  }

  const data = parsed.data;

  // HR may add staff but must never be able to grant admin, to itself or anyone
  // else. Only an existing admin can create another admin.
  if (data.role === "admin" && getRequesterRole(request) !== "admin") {
    return reject(403, "Only an administrator can create an administrator.");
  }

  if (!files.aadhaar) return reject(400, "Upload the Aadhaar document.");

  const invalidDocument = await findInvalidDocumentSignature(files);
  if (invalidDocument) {
    return reject(400, `The ${invalidDocument} document is not a valid PDF, JPG, or PNG file.`);
  }

  const email = data.email.toLowerCase();

  if (await User.exists({ email })) {
    return reject(409, "A user with this email already exists.");
  }

  // Catches the same person being onboarded twice under different emails.
  if (await User.exists({ "staffProfile.aadhaarNumber": data.aadhaarNumber })) {
    return reject(409, "A staff member with this Aadhaar number already exists.");
  }

  if (data.employeeCode && await User.exists({ "staffProfile.employeeCode": data.employeeCode })) {
    return reject(409, "A staff member with this employee code already exists.");
  }

  // Admins reach every branch, so they carry no branch assignment; every other
  // role must name at least one.
  const isAdmin = data.role === "admin";
  const branchIds = isAdmin ? [] : await validateAssignedBranches(data.assignedBranches);
  if (!branchIds) return reject(400, "Select valid active branches.");
  if (!isAdmin && !branchIds.length) return reject(400, "Assign at least one branch.");

  const createdBy = getAuthenticatedUserId(request);
  const passwordHash = await hashPassword(data.password);

  let staffUser;
  try {
    staffUser = await User.create({
      firstName: data.firstName,
      lastName: data.lastName,
      name: `${data.firstName} ${data.lastName}`.trim(),
      email,
      phone: data.phone,
      passwordHash,
      role: data.role,
      assignedBranches: branchIds,
      userStatus: "active",
      isVerified: true,
      emailVerifiedAt: new Date(),
      invitedBy: createdBy,
      staffProfile: buildStaffProfile(data, files, createdBy)
    });
  } catch (error) {
    // A concurrent create can still lose the unique-email race above.
    if ((error as { code?: number }).code === 11000) {
      return reject(409, "A user with this email already exists.");
    }
    await cleanupUploadedFiles(files);
    throw error;
  }

  await staffUser.populate("assignedBranches", "name code status");

  return response.status(201).json({
    success: true,
    message: "Staff member created.",
    user: serializeStaffUser(staffUser)
  });
}

/** Full record for the staff detail page. Readable by admin and HR. */
export async function getStaffUser(request: Request, response: Response): Promise<Response> {
  const id = String(request.params.id ?? "");
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response.status(404).json({ success: false, message: "Staff member not found." });
  }

  const staffUser = await User.findById(id).populate("assignedBranches", "name code status").exec();
  if (!staffUser) return response.status(404).json({ success: false, message: "Staff member not found." });

  return response.status(200).json({ success: true, user: serializeStaffUser(staffUser) });
}

// "" clears an optional value; an absent key leaves it untouched. Only dates need
// the distinction spelled out, because an empty string is not a parseable date.
function blankToNull(value: unknown) {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

// Accepts an empty string (meaning "clear this") or a value matching the pattern.
function optionalPatterned(pattern: RegExp, message: string, normalize?: (value: string) => string) {
  return z.string().trim().max(120)
    .refine((value) => !value || pattern.test(normalize ? normalize(value) : value), message)
    .optional();
}

const staffUpdateSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(60).optional(),
  lastName: z.string().trim().min(1, "Last name is required.").max(60).optional(),
  phone: z.string().trim().regex(phonePattern, "Enter a valid phone number.").optional(),
  role: z.enum(internalRoleValues).optional(),
  userStatus: z.enum(["invited", "active", "suspended", "disabled"]).optional(),
  // Emptiness is checked against the resulting role, since admins hold none.
  assignedBranches: z.array(z.string()).optional(),
  designation: z.string().trim().max(80).optional(),
  employeeCode: z.string().trim().max(40).optional(),
  dateOfJoining: z.coerce.date("Enter a valid date of joining.")
    .max(monthsAhead(MAX_JOINING_DATE_MONTHS_AHEAD), "Date of joining is too far in the future.")
    .optional(),
  // `z.null()` has to come first: `z.coerce.date()` turns null into 1970-01-01
  // rather than rejecting it, so a cleared date would be stored as that instead.
  dateOfBirth: z.preprocess(
    blankToNull,
    z.union([
      z.null(),
      z.coerce.date("Enter a valid date of birth.")
        .min(yearsAgo(MAX_STAFF_AGE_YEARS), "Enter a valid date of birth.")
        .max(yearsAgo(MIN_STAFF_AGE_YEARS), `Staff must be at least ${MIN_STAFF_AGE_YEARS} years old.`)
    ])
  ).optional(),
  panNumber: optionalPatterned(panPattern, "Enter a valid PAN, for example ABCDE1234F.", (value) => value.toUpperCase()),
  addressLine1: z.string().trim().max(160).optional(),
  addressCity: z.string().trim().max(80).optional(),
  addressState: z.string().trim().max(80).optional(),
  addressPostalCode: optionalPatterned(postalCodePattern, "Enter a valid 6-digit PIN code."),
  emergencyContactName: z.string().trim().max(80).optional(),
  emergencyContactPhone: optionalPatterned(phonePattern, "Enter a valid emergency contact number.")
});

// Staff-record fields, as opposed to the login fields above. Used to tell an
// admin that a legacy user has no staff record to edit rather than silently
// dropping half of their changes.
const staffProfileFields = [
  "designation", "employeeCode", "dateOfJoining", "dateOfBirth", "panNumber",
  "addressLine1", "addressCity", "addressState", "addressPostalCode",
  "emergencyContactName", "emergencyContactPhone"
] as const;

/**
 * Applies an edit from the staff detail page.
 *
 * Email and the Aadhaar number are deliberately not accepted: the first is the
 * login id, the second is the identity anchor the duplicate check relies on. The
 * Aadhaar *document* can still be replaced.
 *
 * Only keys present in the request are written, so a section can be saved on its
 * own without blanking the fields it does not show.
 */
export async function updateStaffUser(request: Request, response: Response): Promise<Response> {
  const files = getUploadedFiles(request);

  async function reject(status: number, message: string): Promise<Response> {
    await cleanupUploadedFiles(files);
    return response.status(status).json({ success: false, message });
  }

  const id = String(request.params.id ?? "");
  if (!mongoose.Types.ObjectId.isValid(id)) return reject(404, "Staff member not found.");

  const body = request.body as Record<string, unknown>;
  const payload: Record<string, unknown> = { ...body };
  if (body.assignedBranches !== undefined) payload.assignedBranches = toStringArray(body.assignedBranches);

  const parsed = staffUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return reject(400, parsed.error.issues[0]?.message || "Check the staff details and try again.");
  }

  const data = parsed.data;
  const staffUser = await User.findById(id).exec();
  if (!staffUser) return reject(404, "Staff member not found.");

  const touchesStaffProfile = staffProfileFields.some((field) => field in body) || Object.values(files).some(Boolean);
  if (touchesStaffProfile && !staffUser.staffProfile) {
    return reject(400, "This user does not have a staff record, so employment details cannot be edited.");
  }

  const invalidDocument = await findInvalidDocumentSignature(files);
  if (invalidDocument) {
    return reject(400, `The ${invalidDocument} document is not a valid PDF, JPG, or PNG file.`);
  }

  if (data.employeeCode) {
    const duplicate = await User.exists({
      _id: { $ne: staffUser._id },
      "staffProfile.employeeCode": data.employeeCode
    });
    if (duplicate) return reject(409, "A staff member with this employee code already exists.");
  }

  // An admin changing their own role or disabling their own login could lock the
  // portal's last administrator out, so those two are refused on your own record.
  const requesterId = getAuthenticatedUserId(request);
  const editingSelf = Boolean(requesterId) && String(requesterId) === String(staffUser._id);
  const currentRole = normalizePortalRole(staffUser.role);
  if (editingSelf && data.role && data.role !== currentRole) {
    return reject(400, "You cannot change your own role. Ask another administrator to do it.");
  }
  if (editingSelf && data.userStatus && data.userStatus !== staffUser.userStatus) {
    return reject(400, "You cannot change your own login status.");
  }

  // Branch rules only apply when the request actually touches access. Saving the
  // personal section of a client, or of an internal account that predates branch
  // assignment, must not fail on a branch requirement it never mentioned.
  const touchesAccess = data.role !== undefined || data.assignedBranches !== undefined;
  const nextRole = data.role ?? currentRole;
  if (touchesAccess) {
    if (nextRole === "admin") {
      // Admins are not branch-scoped; any assignment sent alongside is dropped.
      staffUser.assignedBranches = [];
    } else if (data.assignedBranches) {
      const branchIds = await validateAssignedBranches(data.assignedBranches);
      if (!branchIds) return reject(400, "Select valid active branches.");
      if (!branchIds.length) return reject(400, "Assign at least one branch.");
      staffUser.assignedBranches = branchIds;
    } else if (!staffUser.assignedBranches.length) {
      // Moving off admin without naming branches would leave no branch access.
      return reject(400, "Assign at least one branch.");
    }
  }

  if (data.firstName !== undefined) staffUser.firstName = data.firstName;
  if (data.lastName !== undefined) staffUser.lastName = data.lastName;
  if (data.firstName !== undefined || data.lastName !== undefined) {
    staffUser.name = [staffUser.firstName, staffUser.lastName].filter(Boolean).join(" ").trim();
  }
  if (data.phone !== undefined) staffUser.phone = data.phone;
  if (data.role !== undefined) staffUser.role = data.role;
  if (data.userStatus !== undefined) {
    staffUser.userStatus = data.userStatus;
    // Matches updateUserStatus: reactivating also clears a login lockout.
    if (data.userStatus === "active") {
      staffUser.lockedUntil = null;
      staffUser.failedLoginAttempts = 0;
    }
  }

  const profile = staffUser.staffProfile;
  if (profile) {
    if (data.designation !== undefined) profile.designation = data.designation;
    if (data.employeeCode !== undefined) profile.employeeCode = data.employeeCode;
    if (data.dateOfJoining !== undefined) profile.dateOfJoining = data.dateOfJoining;
    if (data.dateOfBirth !== undefined) profile.dateOfBirth = data.dateOfBirth;
    if (data.panNumber !== undefined) profile.panNumber = data.panNumber.toUpperCase();

    if (data.addressLine1 !== undefined || data.addressCity !== undefined
      || data.addressState !== undefined || data.addressPostalCode !== undefined) {
      profile.address = {
        line1: data.addressLine1 ?? profile.address?.line1 ?? "",
        city: data.addressCity ?? profile.address?.city ?? "",
        state: data.addressState ?? profile.address?.state ?? "",
        postalCode: data.addressPostalCode ?? profile.address?.postalCode ?? ""
      };
    }

    if (data.emergencyContactName !== undefined || data.emergencyContactPhone !== undefined) {
      profile.emergencyContact = {
        name: data.emergencyContactName ?? profile.emergencyContact?.name ?? "",
        phone: data.emergencyContactPhone ?? profile.emergencyContact?.phone ?? ""
      };
    }

    // Replacing a document swaps the record, then removes the file it replaced so
    // superseded copies do not accumulate on disk.
    const replacedPaths: string[] = [];
    if (!profile.documents) profile.documents = {};
    for (const type of staffDocumentTypes) {
      const file = files[type];
      if (!file) continue;

      const previous = profile.documents[type];
      if (previous?.path) replacedPaths.push(previous.path);
      profile.documents[type] = toStaffDocument(type, file);
    }

    staffUser.markModified("staffProfile");
    await staffUser.save();
    await unlinkFiles(replacedPaths);
  } else {
    await staffUser.save();
  }

  await staffUser.populate("assignedBranches", "name code status");

  return response.status(200).json({
    success: true,
    message: "Staff details updated.",
    user: serializeStaffUser(staffUser)
  });
}

const documentTypeSchema = z.enum(staffDocumentTypes);

/**
 * Streams one staff document. `?download=1` sends it as an attachment; without
 * it the file renders inline in the detail page's preview.
 */
export async function viewStaffDocument(request: Request, response: Response): Promise<Response | void> {
  const parsedType = documentTypeSchema.safeParse(request.params.documentType);
  if (!parsedType.success) {
    return response.status(400).json({ success: false, message: "Invalid document type" });
  }

  const id = String(request.params.id ?? "");
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response.status(404).json({ success: false, message: "Staff member not found" });
  }

  const staffUser = await User.findById(id).select("staffProfile").lean().exec();
  if (!staffUser) return response.status(404).json({ success: false, message: "Staff member not found" });

  const document = staffUser.staffProfile?.documents?.[parsedType.data];
  if (!document) return response.status(404).json({ success: false, message: "Document not found" });

  // Guard against a stored path escaping the private upload directory before the
  // file is served (defense against tampered or legacy records).
  const absolutePath = path.resolve(document.path);
  if (absolutePath !== staffDocumentRoot && !absolutePath.startsWith(staffDocumentRoot + path.sep)) {
    return response.status(404).json({ success: false, message: "Document not found" });
  }

  // Confirm the file still exists before sending, so a missing file returns a
  // clean 404 instead of sendFile erroring after headers are committed.
  try {
    await fs.promises.access(absolutePath, fs.constants.R_OK);
  } catch {
    return response.status(404).json({ success: false, message: "Document file is no longer available" });
  }

  response.setHeader("Content-Type", document.mimeType);
  response.setHeader(
    "Content-Disposition",
    `${request.query.download === "1" ? "attachment" : "inline"}; filename="${encodeURIComponent(document.originalName)}"`
  );

  return response.sendFile(absolutePath);
}
