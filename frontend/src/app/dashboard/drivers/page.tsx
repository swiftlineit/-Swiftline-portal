"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  FiChevronDown,
  FiCopy,
  FiPlus,
  FiUserCheck,
  FiUsers,
  FiX,
} from "react-icons/fi";
import { toast } from "react-toastify";
import { DashboardLoading } from "@/components/DashboardShell";
import {
  createDriver,
  createDriverInvitationLink,
  listDrivers,
  updateDriverStatus,
  type DeliverySubrole,
  type Driver,
  type DriverEngagementType,
} from "@/lib/drivers";
import { listManifestBranches } from "@/lib/operationsManifests";
import { OPERATIONS_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";
import { listPodPartners, type DeliveryPartner } from "@/lib/pods";

const emptyForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  engagementType: "DIRECT_CONTRACTOR" as DriverEngagementType,
  deliverySubrole: "DRIVER" as DeliverySubrole,
  deliveryPartnerId: "",
  licenceNumber: "",
  licenceExpiry: "",
  vehicleTypes: "",
  notes: "",
};

export default function DriversPage() {
  const { user, loading } = useAdminUser(OPERATIONS_AREA);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [branches, setBranches] = useState<
    Array<{ id: string; name: string; code: string }>
  >([]);
  const [partners, setPartners] = useState<DeliveryPartner[]>([]);
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [modalError, setModalError] = useState("");

  useEffect(() => {
    if (!user) return;
    let active = true;
    void Promise.all([
      listDrivers(),
      // Operations reaches this page, so read branches from the operations
      // endpoint: it is scoped to the member's assigned branches, unlike the
      // admin/HR-only list under /api/v1/users.
      listManifestBranches(),
      listPodPartners(),
    ])
      .then(([driverData, branchData, partnerData]) => {
        if (!active) return;
        setDrivers(driverData.drivers);
        setBranches(branchData.branches);
        setPartners(partnerData.partners);
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load pickup drivers.",
          );
      });
    return () => {
      active = false;
    };
  }, [user]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setModalError("");
    try {
      const result = await createDriver({
        ...form,
        assignedBranches: selectedBranches,
        licenceExpiry: form.licenceExpiry || null,
        approvedVehicleTypes: form.vehicleTypes
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      });
      setDrivers((current) => [result.driver, ...current]);
      setForm(emptyForm);
      setSelectedBranches([]);
      setShowCreate(false);
      toast.success(result.message);
    } catch (caught) {
      setModalError(
        caught instanceof Error ? caught.message : "Unable to create driver.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyInvitation(driver: Driver) {
    setBusy(true);
    try {
      const result = await createDriverInvitationLink(driver.id);
      await navigator.clipboard.writeText(result.activationUrl);
      toast.success(
        "Invitation link copied. Paste it into WhatsApp or email; it expires in 24 hours.",
      );
    } catch (caught) {
      toast.error(
        caught instanceof Error
          ? caught.message
          : "Unable to copy invitation link.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function activate(driver: Driver) {
    setBusy(true);
    try {
      const result = await updateDriverStatus(driver.id, "ACTIVE");
      setDrivers((current) =>
        current.map((item) => (item.id === driver.id ? result.driver : item)),
      );
      toast.success(result.message);
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "Unable to approve driver.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <DashboardLoading />;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
            Delivery Team
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            Manage pickup drivers, destination delivery personnel, and
            supervisors.
          </p>
        </div>
        <button
          onClick={() => {
            setModalError("");
            setShowCreate(true);
          }}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0D1282] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0A0E6B] focus:outline-none focus:ring-2 focus:ring-[#0D1282]/20"
        >
          <FiPlus className="h-4 w-4" /> Add driver
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {drivers.map((driver) => (
          <article
            key={driver.id}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3.5">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0D1282]/8 text-sm font-bold text-[#0D1282] ring-1 ring-inset ring-[#0D1282]/10">{`${driver.firstName[0] ?? ""}${driver.lastName[0] ?? ""}`}</span>
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-slate-950">
                      {driver.firstName} {driver.lastName}
                    </h2>
                    <p className="mt-0.5 truncate text-sm text-slate-500">
                      {driver.deliverySubrole.replace(/_/g, " ")}
                    </p>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${
                    driver.status === "ACTIVE"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : driver.status === "PENDING_APPROVAL"
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : driver.status === "INVITED"
                          ? "border-blue-200 bg-blue-50 text-blue-700"
                          : driver.status === "SUSPENDED"
                            ? "border-red-200 bg-red-50 text-red-700"
                            : driver.status === "DISABLED"
                              ? "border-slate-200 bg-slate-100 text-slate-600"
                              : "border-slate-200 bg-slate-50 text-slate-600"
                  }`}
                >
                  {driver.status.replace(/_/g, " ")}
                </span>
              </div>

              <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4">
                <div className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-3 text-sm">
                  <span className="text-slate-400">Engagement</span>
                  <span className="text-right font-medium text-slate-700">
                    {driver.engagementType.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-3 text-sm">
                  <span className="text-slate-400">Email</span>
                  <span className="break-all text-right text-slate-700">
                    {driver.email}
                  </span>
                </div>
                <div className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-3 text-sm">
                  <span className="text-slate-400">Phone</span>
                  <span className="text-right text-slate-700">
                    {driver.phone}
                  </span>
                </div>
                <div className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-3 text-sm">
                  <span className="text-slate-400">Branches</span>
                  <span className="text-right font-medium text-slate-700">
                    {driver.assignedBranches
                      .map((branch) => branch.code)
                      .join(", ") || "None"}
                  </span>
                </div>
              </div>
            </div>

            {["INVITED", "PENDING_APPROVAL"].includes(driver.status) ||
            driver.status === "PENDING_APPROVAL" ? (
              <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3.5">
                {["INVITED", "PENDING_APPROVAL"].includes(driver.status) ? (
                  <button
                    disabled={busy}
                    onClick={() => void copyInvitation(driver)}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#0D1282]/25 bg-white px-3 text-xs font-semibold text-[#0D1282] transition hover:border-[#0D1282]/40 hover:bg-[#0D1282]/3 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FiCopy className="h-3.5 w-3.5" /> Copy invitation link
                  </button>
                ) : null}
                {driver.status === "PENDING_APPROVAL" ? (
                  <button
                    disabled={busy}
                    onClick={() => void activate(driver)}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#0D1282] px-3 text-xs font-semibold text-white transition hover:bg-[#0A0E6B] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FiUserCheck className="h-3.5 w-3.5" /> Approve
                  </button>
                ) : null}
              </div>
            ) : null}
          </article>
        ))}

        {!drivers.length ? (
          <div className="flex min-h-55 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">
            <div>
              <FiUsers className="mx-auto mb-3 h-6 w-6 text-slate-400" />
              <p className="font-medium text-slate-600">
                No pickup drivers yet.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[1px] sm:items-center sm:p-5">
          <form
            onSubmit={submit}
            className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-5 sm:px-6">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-950">
                  Add pickup driver
                </h2>
                <p className="mt-1 text-sm leading-5 text-slate-500">
                  The driver activates access from an invitation link.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModalError("");
                  setShowCreate(false);
                }}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
              >
                <FiX className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-5 sm:px-6 sm:py-6">
              {modalError ? (
                <div
                  role="alert"
                  className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
                >
                  {modalError}
                </div>
              ) : null}

              <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
                {(
                  [
                    "firstName",
                    "lastName",
                    "email",
                    "phone",
                    "licenceNumber",
                  ] as const
                ).map((field) => (
                  <label
                    key={field}
                    className="block text-sm font-medium text-slate-700"
                  >
                    <span className="capitalize">
                      {field.replace(/([A-Z])/g, " $1")}
                    </span>
                    <input
                      type={
                        field === "email"
                          ? "email"
                          : field === "phone"
                            ? "tel"
                            : "text"
                      }
                      required={field !== "licenceNumber"}
                      placeholder={
                        field === "phone" ? "+91 98765 43210" : undefined
                      }
                      value={form[field]}
                      onChange={(event) => {
                        setModalError("");
                        setForm((current) => ({
                          ...current,
                          [field]: event.target.value,
                        }));
                      }}
                      className="mt-2 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal normal-case text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    />
                  </label>
                ))}

                <label className="block text-sm font-medium text-slate-700">
                  Engagement
                  <div className="relative mt-2">
                    <select
                      value={form.engagementType}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          engagementType: event.target
                            .value as typeof form.engagementType,
                          deliverySubrole:
                            event.target.value === "VENDOR"
                              ? "DELIVERY_PERSON"
                              : current.deliverySubrole,
                        }))
                      }
                      className="h-11 w-full appearance-none rounded-lg border border-slate-300 bg-white pl-3 pr-11 text-sm font-normal text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    >
                      <option value="INTERNAL">Internal company staff</option>
                      <option value="DIRECT_CONTRACTOR">
                        Direct contractor
                      </option>
                      <option value="VENDOR">Delivery-partner personnel</option>
                    </select>
                    <FiChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  </div>
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Delivery access
                  <div className="relative mt-2">
                    <select
                      value={form.deliverySubrole}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          deliverySubrole: event.target
                            .value as DeliverySubrole,
                        }))
                      }
                      className="h-11 w-full appearance-none rounded-lg border border-slate-300 bg-white pl-3 pr-11 text-sm font-normal text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    >
                      <option value="DRIVER">Pickup driver</option>
                      <option value="DELIVERY_PERSON">
                        International delivery person
                      </option>
                      <option value="SUPERVISOR">Delivery supervisor</option>
                    </select>
                    <FiChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  </div>
                </label>

                {form.engagementType === "VENDOR" ? (
                  <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                    Delivery partner
                    <div className="relative mt-2">
                      <select
                        required
                        value={form.deliveryPartnerId}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            deliveryPartnerId: event.target.value,
                          }))
                        }
                        className="h-11 w-full appearance-none rounded-lg border border-slate-300 bg-white pl-3 pr-11 text-sm font-normal text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                      >
                        <option value="">Select partner</option>
                        {partners.map((item) => (
                          <option key={item._id} value={item._id}>
                            {item.name} ({item.code})
                          </option>
                        ))}
                      </select>
                      <FiChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    </div>
                  </label>
                ) : null}

                <label className="block text-sm font-medium text-slate-700">
                  Licence expiry
                  <input
                    type="date"
                    value={form.licenceExpiry}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        licenceExpiry: event.target.value,
                      }))
                    }
                    className="mt-2 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  />
                </label>

                <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                  Vehicle types
                  <input
                    value={form.vehicleTypes}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        vehicleTypes: event.target.value,
                      }))
                    }
                    placeholder="Bike, Van"
                    className="mt-2 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal normal-case text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  />
                </label>

                <fieldset className="sm:col-span-2">
                  <legend className="text-sm font-medium text-slate-700">
                    Assigned branches
                  </legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {branches.map((branch) => (
                      <label
                        key={branch.id}
                        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={selectedBranches.includes(branch.id)}
                          onChange={(event) =>
                            setSelectedBranches((current) =>
                              event.target.checked
                                ? [...current, branch.id]
                                : current.filter((id) => id !== branch.id),
                            )
                          }
                          className="h-4 w-4 shrink-0 rounded border-slate-300 text-slate-900 focus:ring-slate-300"
                        />
                        <span className="min-w-0 leading-5">
                          {branch.name} ({branch.code})
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </div>

            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:px-6">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                disabled={busy || !selectedBranches.length}
                className="h-10 rounded-lg bg-[#0D1282] px-5 text-sm font-semibold text-white transition hover:bg-[#0A0E6B] disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {busy ? "Saving..." : "Create driver"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
