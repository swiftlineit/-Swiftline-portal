import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog } from "../models/auditLog.model.js";
import { Branch } from "../models/branch.model.js";
import {
  DpdConfiguration,
  dpdEnvironmentValues,
  dpdLabelSizeValues,
  dpdPrintFormatValues
} from "../models/dpdConfiguration.model.js";
import { encryptSecret } from "../services/credentialEncryption.service.js";

const objectIdSchema = z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), {
  message: "Invalid identifier"
});

const dpdCredentialsSchema = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(500),
  apiToken: z.string().trim().max(1000).optional().or(z.literal("")),
  accountNumber: z.string().trim().max(100).optional().or(z.literal(""))
});

const dpdConfigurationPayloadSchema = z.object({
  branchId: objectIdSchema,
  environment: z.enum(dpdEnvironmentValues),
  businessUnitCode: z.string().trim().min(1).max(80),
  customerId: z.string().trim().min(1).max(80),
  senderAddressId: z.string().trim().min(1).max(80),
  depotCode: z.string().trim().max(40).optional().default(""),
  defaultServiceCode: z.string().trim().min(1).max(40),
  defaultLabelSize: z.enum(dpdLabelSizeValues).default("A6"),
  defaultPrintFormat: z.enum(dpdPrintFormatValues).default("PDF"),
  credentials: dpdCredentialsSchema.optional(),
  active: z.boolean().default(false)
});

type DpdConfigurationPayload = z.infer<typeof dpdConfigurationPayloadSchema>;

function getAuthenticatedUserId(request: Request): mongoose.Types.ObjectId | null {
  const user = (request as Request & { user?: { _id?: unknown } }).user;
  const id = user?._id;

  return id && mongoose.Types.ObjectId.isValid(String(id))
    ? new mongoose.Types.ObjectId(String(id))
    : null;
}

function serializeDpdConfiguration(configuration: {
  _id: unknown;
  branchId: unknown;
  environment: string;
  businessUnitCode: string;
  customerId: string;
  senderAddressId: string;
  depotCode?: string;
  defaultServiceCode: string;
  defaultLabelSize: string;
  defaultPrintFormat: string;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: configuration._id,
    branchId: configuration.branchId,
    environment: configuration.environment,
    businessUnitCode: configuration.businessUnitCode,
    customerId: configuration.customerId,
    senderAddressId: configuration.senderAddressId,
    depotCode: configuration.depotCode ?? "",
    defaultServiceCode: configuration.defaultServiceCode,
    defaultLabelSize: configuration.defaultLabelSize,
    defaultPrintFormat: configuration.defaultPrintFormat,
    active: configuration.active,
    credentialsConfigured: true,
    createdAt: configuration.createdAt,
    updatedAt: configuration.updatedAt
  };
}

async function writeDpdConfigurationAuditLog(
  action: "DPD_CONFIGURATION_CREATED" | "DPD_CONFIGURATION_UPDATED",
  configurationId: mongoose.Types.ObjectId,
  data: DpdConfigurationPayload,
  userId: mongoose.Types.ObjectId
) {
  await AuditLog.create({
    action,
    entityType: "DPD_CONFIGURATION",
    entityId: configurationId,
    performedBy: userId,
    performedAt: new Date(),
    metadata: {
      branchId: data.branchId,
      environment: data.environment,
      active: data.active,
      credentialsUpdated: Boolean(data.credentials)
    }
  });
}

export async function listDpdConfigurations(request: Request, response: Response): Promise<Response> {
  const branchId = typeof request.query.branchId === "string" ? request.query.branchId : "";
  const filters: Record<string, unknown> = {};

  if (branchId) {
    if (!mongoose.Types.ObjectId.isValid(branchId)) {
      return response.status(400).json({ success: false, message: "Invalid branch id" });
    }

    filters.branchId = new mongoose.Types.ObjectId(branchId);
  }

  const configurations = await DpdConfiguration.find(filters).sort({ updatedAt: -1 }).lean().exec();

  return response.status(200).json({
    success: true,
    configurations: configurations.map(serializeDpdConfiguration)
  });
}

export async function getBranchDpdStatus(request: Request, response: Response): Promise<Response> {
  const branchId = typeof request.params.branchId === "string" ? request.params.branchId : "";

  if (!branchId || !mongoose.Types.ObjectId.isValid(branchId)) {
    return response.status(404).json({ success: false, message: "Branch not found" });
  }

  const configurations = await DpdConfiguration.find({
    branchId: new mongoose.Types.ObjectId(branchId),
    active: true
  }).lean().exec();

  return response.status(200).json({
    success: true,
    configured: configurations.length > 0,
    environments: configurations.map((configuration) => ({
      environment: configuration.environment,
      defaultServiceCode: configuration.defaultServiceCode,
      defaultLabelSize: configuration.defaultLabelSize,
      defaultPrintFormat: configuration.defaultPrintFormat
    }))
  });
}

export async function upsertDpdConfiguration(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = dpdConfigurationPayloadSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, errors: parsed.error.format() });

  const branchId = new mongoose.Types.ObjectId(parsed.data.branchId);
  const branchExists = await Branch.exists({ _id: branchId });
  if (!branchExists) return response.status(404).json({ success: false, message: "Branch not found" });

  const existingConfiguration = await DpdConfiguration.findOne({
    branchId,
    environment: parsed.data.environment
  }).select("+encryptedCredentials").exec();

  if (!existingConfiguration && !parsed.data.credentials) {
    return response.status(400).json({
      success: false,
      message: "DPD credentials are required when creating a configuration"
    });
  }

  const credentials = parsed.data.credentials
    ? encryptSecret(parsed.data.credentials)
    : existingConfiguration?.encryptedCredentials;

  if (!credentials) {
    return response.status(400).json({ success: false, message: "DPD credentials are not configured" });
  }

  const payload = {
    branchId,
    environment: parsed.data.environment,
    businessUnitCode: parsed.data.businessUnitCode,
    customerId: parsed.data.customerId,
    senderAddressId: parsed.data.senderAddressId,
    depotCode: parsed.data.depotCode,
    defaultServiceCode: parsed.data.defaultServiceCode,
    defaultLabelSize: parsed.data.defaultLabelSize,
    defaultPrintFormat: parsed.data.defaultPrintFormat,
    encryptedCredentials: credentials,
    active: parsed.data.active,
    updatedBy: userId,
    ...(existingConfiguration ? {} : { createdBy: userId })
  };

  const configuration = await DpdConfiguration.findOneAndUpdate(
    { branchId, environment: parsed.data.environment },
    payload,
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).exec();

  if (!configuration) {
    return response.status(500).json({ success: false, message: "DPD configuration could not be saved" });
  }

  await writeDpdConfigurationAuditLog(
    existingConfiguration ? "DPD_CONFIGURATION_UPDATED" : "DPD_CONFIGURATION_CREATED",
    configuration._id as mongoose.Types.ObjectId,
    parsed.data,
    userId
  );

  return response.status(existingConfiguration ? 200 : 201).json({
    success: true,
    configuration: serializeDpdConfiguration(configuration)
  });
}
