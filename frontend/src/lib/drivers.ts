import { apiUrl } from "@/lib/api";
import { getAccessToken, readJsonSafely, refreshAccessToken } from "@/lib/auth";

export type DriverStatus = "INVITED" | "PENDING_APPROVAL" | "ACTIVE" | "SUSPENDED" | "DISABLED";
export type DriverEngagementType = "INTERNAL" | "DIRECT_CONTRACTOR" | "VENDOR";
export type DeliverySubrole = "DRIVER" | "DELIVERY_PERSON" | "SUPERVISOR";
export type Driver = {
  id: string; userId: string; firstName: string; lastName: string; email: string; phone: string;
  userStatus: string; assignedBranches: Array<{ _id: string; name: string; code: string }>;
  deliverySubrole: DeliverySubrole; engagementType: DriverEngagementType; status: DriverStatus;
  licenceNumber: string; licenceExpiry: string | null; approvedVehicleTypes: string[]; notes: string; deliveryPartnerId?: string | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let token = getAccessToken() ?? await refreshAccessToken();
  if (!token) throw new Error("Your session has expired.");
  const send = () => fetch(apiUrl(path), { ...init, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers, Authorization: `Bearer ${token}` } });
  let response = await send();
  if (response.status === 401) { token = await refreshAccessToken(); if (!token) throw new Error("Your session has expired."); response = await send(); }
  const payload = await readJsonSafely(response) as { success?: boolean; message?: string };
  if (!response.ok || !payload.success) throw new Error(payload.message || "The driver request could not be completed.");
  return payload as T;
}

export function listDrivers() { return request<{ success: true; drivers: Driver[] }>("/api/v1/drivers"); }
export function createDriver(input: {
  firstName: string; lastName: string; email: string; phone: string; deliverySubrole: DeliverySubrole;
  engagementType: DriverEngagementType; assignedBranches: string[]; deliveryPartnerId?: string | null;
  licenceNumber?: string; licenceExpiry?: string | null; approvedVehicleTypes?: string[]; notes?: string;
}) { return request<{ success: true; message: string; driver: Driver }>("/api/v1/drivers", { method: "POST", body: JSON.stringify(input) }); }
export function createDriverInvitationLink(driverId: string) { return request<{ success: true; activationUrl: string; expiresInHours: number }>(`/api/v1/drivers/${driverId}/invitation-link`, { method: "POST" }); }
export function updateDriverStatus(driverId: string, status: DriverStatus) { return request<{ success: true; message: string; driver: Driver }>(`/api/v1/drivers/${driverId}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); }
export function getMyDriverProfile() { return request<{ success: true; driver: Driver }>("/api/v1/driver/profile"); }
