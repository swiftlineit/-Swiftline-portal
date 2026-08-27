import { fetchWithAuth, requestJson } from "@/lib/shipmentsList";

export type DashboardBanner = {
  id: string;
  heading: string;
  description: string;
  order: number;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  imageName: string;
  updatedAt: string;
  visible: boolean;
};

export type DashboardBannerInput = {
  file?: File | null;
  heading: string;
  description: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
};

type BannerResponse = { success: true; banner: DashboardBanner };

function toFormData(input: DashboardBannerInput) {
  const formData = new FormData();
  if (input.file) formData.append("image", input.file);
  formData.append("heading", input.heading);
  formData.append("description", input.description);
  formData.append("startsAt", input.startsAt);
  formData.append("endsAt", input.endsAt);
  formData.append("active", String(input.active));
  return formData;
}

export async function getDashboardBanners() {
  return requestJson<{ success: true; banners: DashboardBanner[] }>("/api/v1/dashboard-banner");
}

export async function getDashboardBannerImage(id: string) {
  const response = await fetchWithAuth(`/api/v1/dashboard-banner/image/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error("Banner image could not be loaded.");
  return response.blob();
}

export async function createDashboardBanner(input: DashboardBannerInput) {
  return requestJson<BannerResponse>("/api/v1/dashboard-banner", {
    method: "POST",
    body: toFormData(input)
  });
}

export async function updateDashboardBanner(id: string, input: DashboardBannerInput) {
  return requestJson<BannerResponse>(`/api/v1/dashboard-banner/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: toFormData(input)
  });
}

export async function deleteDashboardBanner(id: string) {
  return requestJson<{ success: true; message: string }>(`/api/v1/dashboard-banner/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}
