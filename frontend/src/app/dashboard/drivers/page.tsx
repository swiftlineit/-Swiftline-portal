"use client";

import { FormEvent, useEffect, useState } from "react";
import { FiCopy, FiPlus, FiUserCheck, FiUsers, FiX } from "react-icons/fi";
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
import { OPERATIONS_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";
import { listUserBranchOptions } from "@/lib/users";
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
      listUserBranchOptions(),
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">
            Delivery Team
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage pickup drivers, destination delivery personnel, and
            supervisors.
          </p>
        </div>
        <button
          onClick={() => {
            setModalError("");
            setShowCreate(true);
          }}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-[#0D1282] px-4 text-sm font-semibold text-white"
        >
          <FiPlus /> Add driver
        </button>
      </div>
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {drivers.map((driver) => (
          <article
            key={driver.id}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F0DE36] font-bold text-[#0D1282]">{`${driver.firstName[0] ?? ""}${driver.lastName[0] ?? ""}`}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                {driver.status.replace(/_/g, " ")}
              </span>
            </div>
            <h2 className="mt-3 font-semibold text-slate-950">
              {driver.firstName} {driver.lastName}
            </h2>
            <p className="text-sm text-slate-500">
              {driver.engagementType.replace(/_/g, " ")} ·{" "}
              {driver.deliverySubrole}
            </p>
            <p className="mt-2 break-all text-xs text-slate-600">
              {driver.email}
              <br />
              {driver.phone}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Branches:{" "}
              {driver.assignedBranches
                .map((branch) => branch.code)
                .join(", ") || "None"}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {["INVITED", "PENDING_APPROVAL"].includes(driver.status) ? (
                <button
                  disabled={busy}
                  onClick={() => void copyInvitation(driver)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#0D1282] px-3 text-xs font-semibold text-[#0D1282]"
                >
                  <FiCopy /> Copy invitation link
                </button>
              ) : null}
              {driver.status === "PENDING_APPROVAL" ? (
                <button
                  disabled={busy}
                  onClick={() => void activate(driver)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-600 px-3 text-xs font-semibold text-white"
                >
                  <FiUserCheck /> Approve
                </button>
              ) : null}
            </div>
          </article>
        ))}
        {!drivers.length ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            <FiUsers className="mx-auto mb-2 h-6 w-6" />
            No pickup drivers yet.
          </div>
        ) : null}
      </div>

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4">
          <form
            onSubmit={submit}
            className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl sm:p-6"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Add pickup driver</h2>
                <p className="text-sm text-slate-500">
                  The driver activates access from an invitation link.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModalError("");
                  setShowCreate(false);
                }}
                className="p-2"
              >
                <FiX />
              </button>
            </div>
            {modalError ? (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700"
              >
                {modalError}
              </div>
            ) : null}
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
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
                  className="text-xs font-semibold uppercase text-slate-500"
                >
                  {field.replace(/([A-Z])/g, " $1")}
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
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal normal-case"
                  />
                </label>
              ))}
              <label className="text-xs font-semibold uppercase text-slate-500">
                Engagement
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
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"
                >
                  <option value="INTERNAL">Internal company staff</option>
                  <option value="DIRECT_CONTRACTOR">Direct contractor</option>
                  <option value="VENDOR">Delivery-partner personnel</option>
                </select>
              </label>
              <label className="text-xs font-semibold uppercase text-slate-500">
                Delivery access
                <select
                  value={form.deliverySubrole}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      deliverySubrole: event.target.value as DeliverySubrole,
                    }))
                  }
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"
                >
                  <option value="DRIVER">Pickup driver</option>
                  <option value="DELIVERY_PERSON">
                    International delivery person
                  </option>
                  <option value="SUPERVISOR">Delivery supervisor</option>
                </select>
              </label>
              {form.engagementType === "VENDOR" ? (
                <label className="text-xs font-semibold uppercase text-slate-500 sm:col-span-2">
                  Delivery partner
                  <select
                    required
                    value={form.deliveryPartnerId}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        deliveryPartnerId: event.target.value,
                      }))
                    }
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"
                  >
                    <option value="">Select partner</option>
                    {partners.map((item) => (
                      <option key={item._id} value={item._id}>
                        {item.name} ({item.code})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="text-xs font-semibold uppercase text-slate-500">
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
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-slate-500 sm:col-span-2">
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
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal normal-case"
                />
              </label>
              <fieldset className="sm:col-span-2">
                <legend className="text-xs font-semibold uppercase text-slate-500">
                  Assigned branches
                </legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {branches.map((branch) => (
                    <label
                      key={branch.id}
                      className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm"
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
                      />
                      {branch.name} ({branch.code})
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="h-10 rounded-full border border-slate-300 px-4 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={busy || !selectedBranches.length}
                className="h-10 rounded-full bg-[#0D1282] px-5 text-sm font-semibold text-white disabled:bg-slate-400"
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
