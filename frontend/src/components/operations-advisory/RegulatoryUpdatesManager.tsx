"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { FiEdit3, FiExternalLink, FiPlus, FiSave, FiSearch, FiTrash2 } from "react-icons/fi";
import {
  createRegulatoryUpdate,
  deleteRegulatoryUpdate,
  listRegulatoryUpdates,
  regulatoryShipmentDirectionLabels,
  regulatoryShipmentDirections,
  regulatoryShipmentTypeLabels,
  regulatoryShipmentTypes,
  regulatoryUpdateCategories,
  regulatoryUpdateCategoryLabels,
  updateRegulatoryUpdate,
  type RegulatoryShipmentDirection,
  type RegulatoryShipmentType,
  type RegulatoryUpdate,
  type RegulatoryUpdateCategory,
  type RegulatoryUpdateInput,
  type RegulatoryUpdateStatus
} from "@/lib/operationsAdvisory";
import { regulatoryBlocRegions, regulatoryRegionLabel, regulatoryRegions } from "@/lib/regulatoryRegions";

/**
 * The Customs & Regulatory Updates tab. Deliberately a sibling of the Holiday &
 * Cut-Off Calendar rather than a category inside it: a holiday is a date the
 * network is shut, while a rule change applies over a window and tells the
 * client what to do about it. One form, every country- so a UK de minimis
 * reform and an Indian ECCS alert never need separate modules.
 */

type FormState = {
  regions: string[];
  category: RegulatoryUpdateCategory;
  title: string;
  effectiveFrom: string;
  effectiveFromTbc: boolean;
  effectiveUntil: string;
  /** "" means the status follows the dates; anything else pins it. */
  statusOverride: "" | RegulatoryUpdateStatus;
  affectedShipments: RegulatoryShipmentDirection[];
  shipmentTypes: RegulatoryShipmentType[];
  valueThreshold: string;
  customerImpact: string;
  actionRequired: string;
  sourceUrl: string;
  active: boolean;
};

const blankForm: FormState = {
  regions: [],
  category: "CUSTOMS_RULE_CHANGE",
  title: "",
  effectiveFrom: "",
  effectiveFromTbc: false,
  effectiveUntil: "",
  statusOverride: "",
  affectedShipments: ["ALL"],
  shipmentTypes: ["ALL"],
  valueThreshold: "",
  customerImpact: "",
  actionRequired: "",
  sourceUrl: "",
  active: true
};

/** Entries are stored at UTC midnight so the ISO date part never shifts a day. */
function fromDateInput(value: string) {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

function toDateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Mirrors `deriveRegulatoryUpdateStatus` on the server so the form can show the
 * status an entry will publish with before it is saved. The server value is
 * still the one every reader trusts; this is a preview, not a second source.
 */
function previewStatus(form: FormState): RegulatoryUpdateStatus {
  if (form.statusOverride) return form.statusOverride;

  const now = Date.now();
  const until = form.effectiveUntil ? new Date(`${form.effectiveUntil}T00:00:00.000Z`).getTime() : null;
  if (until !== null && until < now) return "EXPIRED";
  if (!form.effectiveFrom) return "UPCOMING";

  return new Date(`${form.effectiveFrom}T00:00:00.000Z`).getTime() <= now ? "ACTIVE" : "UPCOMING";
}

function regulatoryStatusTone(status: RegulatoryUpdateStatus) {
  if (status === "ACTIVE") return "bg-emerald-100 text-emerald-800";
  if (status === "UPCOMING") return "bg-amber-100 text-amber-800";
  return "bg-slate-200 text-slate-600";
}

/** "All" swallows the rest, matching how the server normalises the same field. */
function toggleMultiSelect<T extends string>(current: T[], value: T, fallback: T): T[] {
  if (value === fallback) return [fallback];

  const next = current.includes(value)
    ? current.filter((entry) => entry !== value && entry !== fallback)
    : [...current.filter((entry) => entry !== fallback), value];

  return next.length ? next : [fallback];
}

export default function RegulatoryUpdatesManager() {
  const [updates, setUpdates] = useState<RegulatoryUpdate[]>([]);
  const [form, setForm] = useState<FormState>(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [regionQuery, setRegionQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setError("");
      try {
        const data = await listRegulatoryUpdates();
        if (!active) return;
        setUpdates(data.updates);
      } catch (caughtError) {
        if (!active) return;
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load regulatory updates.");
      }
    }

    void load();
    return () => { active = false; };
  }, []);

  // Blocs stay pinned above the countries even while filtering, so "EU" is
  // always one keystroke away rather than buried in an alphabetical list.
  const visibleRegions = useMemo(() => {
    const query = regionQuery.trim().toLowerCase();
    if (!query) return regulatoryRegions;

    return regulatoryRegions.filter((region) =>
      region.label.toLowerCase().includes(query) || region.code.toLowerCase().includes(query)
    );
  }, [regionQuery]);

  const blocCodes = useMemo(() => new Set(regulatoryBlocRegions.map((region) => region.code)), []);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setMessage("");
  }

  function handleTextChange(field: keyof FormState) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      updateField(field, event.target.value as FormState[keyof FormState]);
    };
  }

  function toggleRegion(code: string) {
    setForm((current) => {
      const selected = new Set(current.regions);
      if (selected.has(code)) selected.delete(code);
      else selected.add(code);
      return { ...current, regions: [...selected] };
    });
    setMessage("");
  }

  function loadUpdate(update: RegulatoryUpdate) {
    setEditingId(update.id);
    setForm({
      regions: update.regions,
      category: update.category,
      title: update.title,
      effectiveFrom: toDateInput(update.effectiveFrom),
      effectiveFromTbc: update.effectiveFromTbc,
      effectiveUntil: toDateInput(update.effectiveUntil),
      statusOverride: update.statusOverride ?? "",
      affectedShipments: update.affectedShipments,
      shipmentTypes: update.shipmentTypes,
      valueThreshold: update.valueThreshold ?? "",
      customerImpact: update.customerImpact,
      actionRequired: update.actionRequired,
      sourceUrl: update.sourceUrl ?? "",
      active: update.active
    });
    setMessage("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setEditingId(null);
    setForm(blankForm);
    setRegionQuery("");
    setMessage("");
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Validated here as well as on the server: neither is expressible with a
    // `required` attribute, and a round trip to learn it would be needless.
    if (!form.regions.length) {
      setError("Choose at least one country or region.");
      return;
    }
    if (!form.effectiveFrom && !form.effectiveFromTbc) {
      setError("Give an effective date, or tick 'to be confirmed'.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    const payload: RegulatoryUpdateInput = {
      regions: form.regions,
      category: form.category,
      title: form.title.trim(),
      effectiveFrom: form.effectiveFromTbc ? null : fromDateInput(form.effectiveFrom),
      effectiveFromTbc: form.effectiveFromTbc,
      effectiveUntil: fromDateInput(form.effectiveUntil),
      statusOverride: form.statusOverride || null,
      affectedShipments: form.affectedShipments,
      shipmentTypes: form.shipmentTypes,
      valueThreshold: form.valueThreshold.trim() || null,
      customerImpact: form.customerImpact.trim(),
      actionRequired: form.actionRequired.trim(),
      sourceUrl: form.sourceUrl.trim() || null,
      active: form.active
    };

    try {
      if (editingId) {
        await updateRegulatoryUpdate(editingId, payload);
      } else {
        await createRegulatoryUpdate(payload);
      }

      const refreshed = await listRegulatoryUpdates();
      setUpdates(refreshed.updates);
      setMessage(editingId ? "Regulatory update saved." : "Regulatory update published.");
      resetForm();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "The update could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(update: RegulatoryUpdate) {
    if (!window.confirm(`Delete "${update.title}"? This cannot be undone.`)) return;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await deleteRegulatoryUpdate(update.id);
      const refreshed = await listRegulatoryUpdates();
      setUpdates(refreshed.updates);
      if (editingId === update.id) resetForm();
      setMessage("Regulatory update deleted.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "The update could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass = "mt-2 h-10 w-full border border-slate-300 bg-white rounded-xl px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100";
  const textareaClass = "mt-2 w-full border rounded-xl border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100";
  const labelClass = "text-xs font-semibold uppercase text-slate-500";
  const status = previewStatus(form);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
      <form onSubmit={handleSubmit} className="h-fit border border-slate-200 bg-white rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase text-slate-500">
            {editingId ? "Edit Regulatory Update" : "Add Regulatory Update"}
          </h2>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="text-xs font-semibold text-[#0D1282] hover:underline"
            >
              Cancel edit
            </button>
          ) : null}
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={labelClass}>Country / Region</span>
              <span className="text-xs text-slate-500">
                {form.regions.length ? `${form.regions.length} selected` : "None selected"}
              </span>
            </div>

            <div className="relative mt-2">
              <FiSearch aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={regionQuery}
                onChange={(event) => setRegionQuery(event.target.value)}
                placeholder="Filter countries and regions"
                aria-label="Filter countries and regions"
                className="h-10 w-full border border-slate-300 bg-white rounded-xl pl-9 pr-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div className="mt-2 grid max-h-48 grid-cols-1 gap-1 rounded overflow-y-auto border border-slate-200 p-2 sm:grid-cols-2">
              {visibleRegions.length === 0 ? (
                <p className="col-span-full p-2 text-xs text-slate-400">Nothing matches that filter.</p>
              ) : visibleRegions.map((region) => {
                const selected = form.regions.includes(region.code);
                return (
                  <label
                    key={region.code}
                    className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm transition ${
                      selected ? "bg-[#0D1282]/[0.08] text-slate-900" : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleRegion(region.code)}
                      className="h-4 w-4 accent-[#0D1282]"
                    />
                    <span className="truncate">
                      {region.label}
                      {blocCodes.has(region.code) ? (
                        <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Region</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <label className="block">
            <span className={labelClass}>Update category</span>
            <select value={form.category} onChange={handleTextChange("category")} className={inputClass}>
              {regulatoryUpdateCategories.map((category) => (
                <option key={category} value={category}>{regulatoryUpdateCategoryLabels[category]}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={labelClass}>Value threshold (optional)</span>
            <input
              maxLength={80}
              value={form.valueThreshold}
              onChange={handleTextChange("valueThreshold")}
              className={inputClass}
              placeholder="e.g. £135 and below"
            />
          </label>

          <label className="block md:col-span-2">
            <span className={labelClass}>Title</span>
            <input
              required
              maxLength={160}
              value={form.title}
              onChange={handleTextChange("title")}
              className={inputClass}
              placeholder="e.g. UK Low Value Import Customs Reform"
            />
          </label>

          <label className="block">
            <span className={labelClass}>Effective from</span>
            <input
              type="date"
              value={form.effectiveFrom}
              disabled={form.effectiveFromTbc}
              onChange={handleTextChange("effectiveFrom")}
              className={`${inputClass} disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400`}
            />
            <span className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-slate-600">
              <input
                type="checkbox"
                checked={form.effectiveFromTbc}
                onChange={(event) => {
                  const tbc = event.target.checked;
                  setForm((current) => ({
                    ...current,
                    effectiveFromTbc: tbc,
                    // A date and "to be confirmed" contradict each other, so
                    // ticking the box clears the date rather than 400-ing later.
                    effectiveFrom: tbc ? "" : current.effectiveFrom
                  }));
                  setMessage("");
                }}
                className="h-4 w-4 accent-[#0D1282]"
              />
              Date to be confirmed
            </span>
          </label>

          <label className="block">
            <span className={labelClass}>Effective until (optional)</span>
            <input
              type="date"
              value={form.effectiveUntil}
              onChange={handleTextChange("effectiveUntil")}
              className={inputClass}
            />
          </label>

          <div className="md:col-span-2">
            <span className={labelClass}>Status</span>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${regulatoryStatusTone(status)}`}>
                {status}
              </span>
              <select
                value={form.statusOverride}
                onChange={(event) => updateField("statusOverride", event.target.value as FormState["statusOverride"])}
                className="h-10 border border-slate-300 bg-white rounded-xl px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
              >
                <option value="">Automatic (from the dates)</option>
                <option value="UPCOMING">Pin as Upcoming</option>
                <option value="ACTIVE">Pin as Active</option>
                <option value="EXPIRED">Pin as Expired</option>
              </select>
              <p className="text-xs text-slate-500">
                Left automatic, an update turns Active on its effective date and Expired once it runs out.
              </p>
            </div>
          </div>

          <div className="block">
            <span className={labelClass}>Affected shipments</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {regulatoryShipmentDirections.map((direction) => {
                const selected = form.affectedShipments.includes(direction);
                return (
                  <label
                    key={direction}
                    className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      selected
                        ? "border-[#0D1282] bg-[#0D1282]/[0.08] text-[#0D1282]"
                        : "border-slate-300 text-slate-500 hover:border-slate-400"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => updateField("affectedShipments", toggleMultiSelect(form.affectedShipments, direction, "ALL"))}
                      className="sr-only"
                    />
                    {regulatoryShipmentDirectionLabels[direction]}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="block">
            <span className={labelClass}>Shipment type</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {regulatoryShipmentTypes.map((shipmentType) => {
                const selected = form.shipmentTypes.includes(shipmentType);
                return (
                  <label
                    key={shipmentType}
                    className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      selected
                        ? "border-[#0D1282] bg-[#0D1282]/[0.08] text-[#0D1282]"
                        : "border-slate-300 text-slate-500 hover:border-slate-400"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => updateField("shipmentTypes", toggleMultiSelect(form.shipmentTypes, shipmentType, "ALL"))}
                      className="sr-only"
                    />
                    {regulatoryShipmentTypeLabels[shipmentType]}
                  </label>
                );
              })}
            </div>
          </div>

          <label className="block md:col-span-2">
            <span className={labelClass}>Customer impact</span>
            <textarea
              required
              maxLength={800}
              rows={3}
              value={form.customerImpact}
              onChange={handleTextChange("customerImpact")}
              className={textareaClass}
              placeholder="What is changing, in plain terms"
            />
          </label>

          <label className="block md:col-span-2">
            <span className={labelClass}>Action required (optional)</span>
            <textarea
              maxLength={800}
              rows={2}
              value={form.actionRequired}
              onChange={handleTextChange("actionRequired")}
              className={textareaClass}
              placeholder="What the customer needs to do, or that no action is needed yet"
            />
          </label>

          <label className="block md:col-span-2">
            <span className={labelClass}>Official source link (optional)</span>
            <input
              type="url"
              maxLength={500}
              value={form.sourceUrl}
              onChange={handleTextChange("sourceUrl")}
              className={inputClass}
              placeholder="https://www.gov.uk/..."
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 p-4">
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => updateField("active", event.target.checked)}
              className="h-4 w-4 accent-[#0D1282]"
            />
            Publish to clients
          </label>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-10 items-center gap-2 bg-blue-900 rounded-4xl px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            <FiSave aria-hidden="true" className="h-4 w-4" />
            {busy ? "Saving..." : editingId ? "Save Update" : "Publish Update"}
          </button>
        </div>
      </form>

      <aside className="border border-slate-200 bg-white rounded-xl">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase text-slate-500">Regulatory Updates</h2>
        </div>

        <div className="divide-y divide-slate-100">
          {updates.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">No regulatory updates yet.</div>
          ) : updates.map((update) => (
            <div key={update.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-950">{update.title}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${regulatoryStatusTone(update.status)}`}>
                      {update.status}
                    </span>
                  </div>

                  <p className="mt-0.5 text-xs text-slate-500">{regulatoryUpdateCategoryLabels[update.category]}</p>

                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {update.regions.map((code) => (
                      <span key={code} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        {regulatoryRegionLabel(code)}
                      </span>
                    ))}
                  </div>

                  <p className="mt-1.5 text-xs leading-5 text-slate-600">{update.customerImpact}</p>

                  <p className="mt-1 text-[11px] font-medium text-slate-400">
                    {update.effectiveFromTbc ? "Effective date to be confirmed" : `From ${formatDate(update.effectiveFrom) ?? "-"}`}
                    {update.effectiveUntil ? ` → ${formatDate(update.effectiveUntil)}` : ""}
                    {update.valueThreshold ? ` · ${update.valueThreshold}` : ""}
                    {" · "}{update.active ? "Published" : "Unpublished"}
                  </p>

                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Last updated {formatDate(update.updatedAt ?? null) ?? "-"}
                    {update.sourceUrl ? (
                      <>
                        {" · "}
                        <a
                          href={update.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-[#0D1282] hover:underline"
                        >
                          Source
                          <FiExternalLink aria-hidden="true" className="h-3 w-3" />
                        </a>
                      </>
                    ) : null}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => loadUpdate(update)}
                    aria-label={`Edit ${update.title}`}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:border-[#0D1282] hover:text-[#0D1282]"
                  >
                    <FiEdit3 aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(update)}
                    aria-label={`Delete ${update.title}`}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:border-[#D71313] hover:text-[#D71313]"
                  >
                    <FiTrash2 aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => { resetForm(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          className="flex w-full items-center justify-center gap-2 border-t border-slate-200 px-4 py-3 text-sm font-semibold text-[#0D1282] hover:bg-[#0D1282]/5"
        >
          <FiPlus aria-hidden="true" className="h-4 w-4" />
          New regulatory update
        </button>
      </aside>

      {error ? <div className="xl:col-span-2 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
      {message ? <div className="xl:col-span-2 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</div> : null}
    </div>
  );
}
