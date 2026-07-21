"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { FiSave, FiShield } from "react-icons/fi";
import BusinessAccountsShell, { BusinessAccountsLoading } from "@/components/business-accounts/BusinessAccountsShell";
import { Branch, listBranches } from "@/lib/branches";
import {
  DpdConfiguration,
  DpdConfigurationInput,
  DpdEnvironment,
  DpdLabelSize,
  DpdPrintFormat,
  listDpdConfigurations,
  saveDpdConfiguration
} from "@/lib/dpdConfigurations";
import { useAdminUser } from "@/lib/useAdminUser";

type FormState = Omit<DpdConfigurationInput, "credentials"> & {
  username: string;
  password: string;
  apiToken: string;
  accountNumber: string;
};

const defaultForm: FormState = {
  branchId: "",
  environment: "TEST",
  businessUnitCode: "",
  customerId: "",
  senderAddressId: "",
  depotCode: "",
  defaultServiceCode: "",
  defaultLabelSize: "A6",
  defaultPrintFormat: "PDF",
  active: false,
  username: "",
  password: "",
  apiToken: "",
  accountNumber: ""
};

function getBranchName(branches: Branch[], branchId: string) {
  const branch = branches.find((item) => item._id === branchId);
  return branch ? `${branch.code} - ${branch.name}` : branchId;
}

export default function DpdConfigurationsPage() {
  const { user, loading } = useAdminUser();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [configurations, setConfigurations] = useState<DpdConfiguration[]>([]);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedConfiguration = useMemo(
    () => configurations.find((configuration) =>
      configuration.branchId === form.branchId && configuration.environment === form.environment
    ),
    [configurations, form.branchId, form.environment]
  );

  useEffect(() => {
    if (!user) return;

    async function loadData() {
      setError("");

      try {
        const [branchData, configData] = await Promise.all([
          listBranches("", "ACTIVE"),
          listDpdConfigurations()
        ]);

        setBranches(branchData.branches);
        setConfigurations(configData.configurations);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load DPD configuration.");
      }
    }

    void loadData();
  }, [user]);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setMessage("");
  }

  function handleTextChange(field: keyof FormState) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      updateField(field, event.target.value as FormState[keyof FormState]);
    };
  }

  function loadConfiguration(configuration: DpdConfiguration) {
    setForm({
      branchId: configuration.branchId,
      environment: configuration.environment,
      businessUnitCode: configuration.businessUnitCode,
      customerId: configuration.customerId,
      senderAddressId: configuration.senderAddressId,
      depotCode: configuration.depotCode,
      defaultServiceCode: configuration.defaultServiceCode,
      defaultLabelSize: configuration.defaultLabelSize,
      defaultPrintFormat: configuration.defaultPrintFormat,
      active: configuration.active,
      username: "",
      password: "",
      apiToken: "",
      accountNumber: ""
    });
    setMessage("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const credentials = form.username && form.password
        ? {
          username: form.username,
          password: form.password,
          apiToken: form.apiToken,
          accountNumber: form.accountNumber
        }
        : undefined;
      const payload: DpdConfigurationInput = {
        branchId: form.branchId,
        environment: form.environment,
        businessUnitCode: form.businessUnitCode,
        customerId: form.customerId,
        senderAddressId: form.senderAddressId,
        depotCode: form.depotCode,
        defaultServiceCode: form.defaultServiceCode,
        defaultLabelSize: form.defaultLabelSize,
        defaultPrintFormat: form.defaultPrintFormat,
        active: form.active,
        ...(credentials ? { credentials } : {})
      };
      const data = await saveDpdConfiguration(payload);
      const refreshed = await listDpdConfigurations();

      setConfigurations(refreshed.configurations);
      loadConfiguration(data.configuration);
      setMessage("DPD configuration saved.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "DPD configuration could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <BusinessAccountsLoading />;

  return (
    <BusinessAccountsShell user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-950">DPD Configuration</h1>
        <p className="mt-1 text-sm text-slate-500">Test and production shipment settings</p>
      </div>

      {error ? <div className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
      {message ? <div className="mb-4 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <form onSubmit={handleSubmit} className="border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase text-slate-500">Configuration Details</h2>
          </div>

          <div className="grid gap-4 p-4 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold uppercase text-slate-500">Branch</span>
              <select
                required
                value={form.branchId}
                onChange={handleTextChange("branchId")}
                className="mt-2 h-10 w-full border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
              >
                <option value="">Select branch</option>
                {branches.map((branch) => (
                  <option key={branch._id} value={branch._id}>{branch.code} - {branch.name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase text-slate-500">Environment</span>
              <select
                value={form.environment}
                onChange={(event) => updateField("environment", event.target.value as DpdEnvironment)}
                className="mt-2 h-10 w-full border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
              >
                <option value="TEST">Test</option>
                <option value="PRODUCTION">Production</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase text-slate-500">Business Unit Code</span>
              <input required value={form.businessUnitCode} onChange={handleTextChange("businessUnitCode")} className="mt-2 h-10 w-full border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100" />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase text-slate-500">Customer ID</span>
              <input required value={form.customerId} onChange={handleTextChange("customerId")} className="mt-2 h-10 w-full border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100" />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase text-slate-500">Sender Address ID</span>
              <input required value={form.senderAddressId} onChange={handleTextChange("senderAddressId")} className="mt-2 h-10 w-full border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100" />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase text-slate-500">Depot Code</span>
              <input value={form.depotCode} onChange={handleTextChange("depotCode")} className="mt-2 h-10 w-full border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100" />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase text-slate-500">Default Service Code</span>
              <input required value={form.defaultServiceCode} onChange={handleTextChange("defaultServiceCode")} className="mt-2 h-10 w-full border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100" />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-semibold uppercase text-slate-500">Label Size</span>
                <select value={form.defaultLabelSize} onChange={(event) => updateField("defaultLabelSize", event.target.value as DpdLabelSize)} className="mt-2 h-10 w-full border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100">
                  <option value="A6">A6</option>
                  <option value="A4">A4</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-slate-500">Format</span>
                <select value={form.defaultPrintFormat} onChange={(event) => updateField("defaultPrintFormat", event.target.value as DpdPrintFormat)} className="mt-2 h-10 w-full border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100">
                  <option value="PDF">PDF</option>
                  <option value="ZPL">ZPL</option>
                </select>
              </label>
            </div>
          </div>

          <div className="border-t border-slate-200 p-4">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <FiShield aria-hidden="true" className="h-4 w-4 text-blue-900" />
              Credentials are write-only.
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <input value={form.username} onChange={handleTextChange("username")} placeholder={selectedConfiguration?.credentialsConfigured ? "Username unchanged" : "Username"} className="h-10 border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100" />
              <input type="password" value={form.password} onChange={handleTextChange("password")} placeholder={selectedConfiguration?.credentialsConfigured ? "Password unchanged" : "Password"} className="h-10 border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100" />
              <input value={form.apiToken} onChange={handleTextChange("apiToken")} placeholder="API token" className="h-10 border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100" />
              <input value={form.accountNumber} onChange={handleTextChange("accountNumber")} placeholder="Account number" className="h-10 border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100" />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 p-4">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => updateField("active", event.target.checked)}
                className="h-4 w-4"
              />
              Active
            </label>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-10 items-center gap-2 bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              <FiSave aria-hidden="true" className="h-4 w-4" />
              {busy ? "Saving..." : "Save Configuration"}
            </button>
          </div>
        </form>

        <aside className="border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase text-slate-500">Configured Branches</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {configurations.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">No DPD configurations yet.</div>
            ) : configurations.map((configuration) => (
              <button
                key={configuration.id}
                type="button"
                onClick={() => loadConfiguration(configuration)}
                className="block w-full px-4 py-3 text-left hover:bg-blue-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-950">{getBranchName(branches, configuration.branchId)}</p>
                  <span className={`text-xs font-semibold ${configuration.active ? "text-emerald-700" : "text-slate-500"}`}>
                    {configuration.active ? "Active" : "Inactive"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{configuration.environment} · {configuration.defaultServiceCode} · {configuration.defaultLabelSize} {configuration.defaultPrintFormat}</p>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </BusinessAccountsShell>
  );
}
